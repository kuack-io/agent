interface WasmBindgenModule {
  default: (config: { module_or_path: Uint8Array }) => Promise<void>;
  main?: (env?: Record<string, string>) => Promise<unknown>;
}

export interface WasmSpec {
  path?: string;
  variant?: string;
  image?: string;
}

export interface ContainerSpec {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  wasm?: WasmSpec;
}

export interface PodSpec {
  metadata: {
    name: string;
    namespace: string;
  };
  spec: {
    containers: ContainerSpec[];
  };
}

export interface PodStatus {
  phase: "Pending" | "Running" | "Succeeded" | "Failed";
  message: string;
}

export class Runtime {
  private runningPods: Map<string, AbortController> = new Map();
  private executedPodCount: number = 0;
  private registryProxyUrl: string;
  private token: string;

  constructor(registryProxyUrl: string, token: string) {
    this.registryProxyUrl = registryProxyUrl;
    this.token = token;
  }

  getExecutedPodCount(): number {
    return this.executedPodCount;
  }

  async executePod(
    podSpec: PodSpec,
    onStatus: (status: PodStatus) => void,
    onLog: (log: string) => void,
  ): Promise<void> {
    const podKey = `${podSpec.metadata.namespace}/${podSpec.metadata.name}`;
    console.log(`[Runtime] Executing pod: ${podKey}`);
    this.executedPodCount++;

    // Update status to Pending
    onStatus({
      phase: "Pending",
      message: "Downloading WASM module",
    });

    try {
      // For now, only support single container
      const container = podSpec.spec.containers[0];
      if (!container) {
        throw new Error("No containers specified");
      }

      // Auto-discovery of WASM path
      // We always attempt to discover the path from package.json as it's the standard for wasm-pack
      try {
        const imageRef = container.wasm?.image ?? container.image;
        console.log(`[Runtime] Discovering WASM path from pkg/package.json for ${imageRef}`);

        const pkgJsonStr = await this.downloadFile(imageRef, "pkg/package.json", container.wasm?.variant);
        const pkgJson = JSON.parse(pkgJsonStr);

        if (pkgJson.main && typeof pkgJson.main === "string") {
          const mainJs = pkgJson.main;
          const wasmFilename = mainJs.replace(/\.js$/, "_bg.wasm");
          const wasmPath = `pkg/${wasmFilename}`;

          console.log(`[Runtime] Discovered WASM path: ${wasmPath}`);

          if (!container.wasm) container.wasm = {};
          container.wasm.path = wasmPath;
        }
      } catch (err) {
        console.warn(`[Runtime] Failed to discover WASM path: ${err}`);

        // Fallback: If discovery fails, try to construct a path based on the image name
        // This helps if package.json is missing or inaccessible but the structure is standard.
        if (!container.wasm?.path) {
          const imageRef = container.wasm?.image ?? container.image;
          // Extract name from image ref (e.g. ghcr.io/kuack-io/checker:latest -> checker)
          const match = imageRef.match(/\/([^/:]+)(?::.+)?$/);
          if (match && match[1]) {
            const name = match[1]; // e.g. "checker" or "kuack-checker"
            // Convert dashes to underscores for rust/wasm conventions
            const snakeName = name.replace(/-/g, "_");
            // Try the most likely path
            const fallbackPath = `pkg/${snakeName}_bg.wasm`;
            console.log(`[Runtime] Using fallback WASM path derived from image name: ${fallbackPath}`);

            if (!container.wasm) container.wasm = {};
            container.wasm.path = fallbackPath;
          }
        }
      }

      // Download WASM module from registry proxy
      const wasmBytes = await this.downloadWASM(container);

      // Download JS glue code for wasm-bindgen modules
      const imageRef = container.wasm?.image ?? container.image;
      const wasmPath = container.wasm?.path || "";
      const jsCode = await this.downloadJS(wasmPath, imageRef, container.wasm?.variant);

      onStatus({
        phase: "Running",
        message: "Executing WASM module",
      });

      // Create abort controller for this pod
      const abortController = new AbortController();
      this.runningPods.set(podKey, abortController);

      // Execute WASM
      await this.executeWASM(
        wasmBytes,
        jsCode,
        container.command || [],
        container.args || [],
        container.env || [],
        onLog,
        abortController.signal,
      );

      // Completed successfully
      onStatus({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    } catch (error) {
      console.error(`[Runtime] Pod execution failed:`, error);
      onStatus({
        phase: "Failed",
        message: `Execution error: ${error}`,
      });
    } finally {
      this.runningPods.delete(podKey);
    }
  }

  async deletePod(namespace: string, name: string): Promise<void> {
    const podKey = `${namespace}/${name}`;
    const controller = this.runningPods.get(podKey);

    if (controller) {
      console.log(`[Runtime] Terminating pod: ${podKey}`);
      controller.abort();
      this.runningPods.delete(podKey);
    }
  }

  private async downloadFile(imageRef: string, path: string, variant?: string): Promise<string> {
    const url = this.buildRegistryUrl();
    url.searchParams.set("image", imageRef);
    url.searchParams.set("path", path);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    if (variant) {
      url.searchParams.set("variant", variant);
    }

    console.log(`[Runtime] Downloading file ${path} from ${url.toString()}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      // Try to read error text if available
      let errorText = response.statusText;
      try {
        const text = await response.text();
        if (text) errorText = `${response.statusText}: ${text}`;
      } catch {
        // ignore
      }
      throw new Error(`Failed to download file ${path}: ${response.status} ${errorText}`);
    }

    return await response.text();
  }

  private async downloadWASM(container: ContainerSpec): Promise<Uint8Array> {
    const url = this.buildRegistryUrl();
    const imageRef = container.wasm?.image ?? container.image;
    url.searchParams.set("image", imageRef);
    if (container.wasm?.path) {
      url.searchParams.set("path", container.wasm?.path);
    }
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    if (container.wasm?.variant) {
      url.searchParams.set("variant", container.wasm.variant);
    }

    console.log(`[Runtime] Downloading WASM from ${url.toString()}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      // Try to read error text if available
      let errorText = response.statusText;
      try {
        const text = await response.text();
        if (text) errorText = `${response.statusText}: ${text}`;
      } catch {
        // ignore
      }
      throw new Error(`Failed to download WASM: ${response.status} ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  private async downloadJS(wasmPath: string, imageRef: string, variant?: string): Promise<string> {
    // Derive JS path from WASM path (e.g., /pkg/module_bg.wasm -> /pkg/module.js)
    const jsPath = wasmPath.replace(/_bg\.wasm$/, ".js");

    const url = this.buildRegistryUrl();
    url.searchParams.set("image", imageRef);
    url.searchParams.set("path", jsPath);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    if (variant) {
      url.searchParams.set("variant", variant);
    }

    console.log(`[Runtime] Downloading JS glue code from ${url.toString()}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Failed to download JS: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  }

  private buildRegistryUrl(): URL {
    try {
      return new URL(this.registryProxyUrl);
    } catch (err) {
      if (typeof window !== "undefined" && window.location) {
        return new URL(this.registryProxyUrl, window.location.origin);
      }
      throw err;
    }
  }

  // Helper method to make dynamic import testable
  private async importWasmBindgenModule(blobUrl: string): Promise<WasmBindgenModule> {
    return await import(/* @vite-ignore */ blobUrl);
  }

  private async executeWASM(
    wasmBytes: Uint8Array,
    jsCode: string,
    command: string[],
    args: string[],
    env: Array<{ name: string; value: string }>,
    onLog: (log: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    // Capture original console methods
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;

    let inLog = false;
    const interceptLog = (method: (...methodArgs: unknown[]) => void, ...methodArgs: unknown[]) => {
      method.apply(console, methodArgs as unknown[]);

      if (inLog) return;
      inLog = true;

      try {
        const logMessage = methodArgs
          .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
          .join(" ");

        // Avoid capturing the error log from reportPodLog itself to prevent loops
        if (logMessage.includes("[Agent] Failed to report pod status")) {
          return;
        }

        onLog(logMessage);
      } catch {
        // Ignore errors in logging to prevent infinite loops
      } finally {
        inLog = false;
      }
    };

    // Override console methods
    console.log = (...args) => interceptLog(originalConsoleLog, ...args);
    console.error = (...args) => interceptLog(originalConsoleError, ...args);
    console.warn = (...args) => interceptLog(originalConsoleWarn, ...args);
    console.info = (...args) => interceptLog(originalConsoleInfo, ...args);

    console.log("[Runtime] Loading wasm-bindgen JS module...");

    // Create a blob URL from the JS code
    const blob = new Blob([jsCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    try {
      // Check for abort signal
      if (signal.aborted) {
        throw new Error("Execution aborted");
      }

      // Dynamically import the JS module
      const module = await this.importWasmBindgenModule(blobUrl);

      console.log("[Runtime] Initializing wasm-bindgen module...");

      // Call the init function with the WASM bytes
      // wasm-bindgen modules export a default init function
      // Use the new API that expects an object with 'module_or_path' key
      await module.default({ module_or_path: wasmBytes });

      console.log("[Runtime] Running WASM module...");

      // Check for abort signal
      if (signal.aborted) {
        throw new Error("Execution aborted");
      }

      // Call the main function if it exists
      if (typeof module.main === "function") {
        // Convert env array to object
        const envObj: Record<string, string> = {};
        for (const e of env) {
          envObj[e.name] = e.value;
        }

        const result = await module.main(envObj);
        if (result !== undefined) {
          onLog(`WASM execution completed with result: ${result}`);
        }
      } else {
        onLog("WASM module initialized successfully (no main function found)");
      }

      console.log("[Runtime] WASM execution completed");
    } finally {
      // Restore original console methods
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;

      // Clean up the blob URL
      URL.revokeObjectURL(blobUrl);
    }
  }

  getRunningPodCount(): number {
    return this.runningPods.size;
  }
}
