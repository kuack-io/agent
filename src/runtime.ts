interface WasmBindgenModule {
  default: (config: { module_or_path: Uint8Array }) => Promise<void>;
  main?: () => Promise<unknown>;
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
  private registryProxyUrl: string;

  constructor(registryProxyUrl: string) {
    this.registryProxyUrl = registryProxyUrl;
  }

  async executePod(
    podSpec: PodSpec,
    onStatus: (status: PodStatus) => void,
    onLog: (log: string) => void,
  ): Promise<void> {
    const podKey = `${podSpec.metadata.namespace}/${podSpec.metadata.name}`;
    console.log(`[Runtime] Executing pod: ${podKey}`);

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

  private async downloadWASM(container: ContainerSpec): Promise<Uint8Array> {
    const url = this.buildRegistryUrl();
    const imageRef = container.wasm?.image ?? container.image;
    url.searchParams.set("image", imageRef);
    if (container.wasm?.path) {
      url.searchParams.set("path", container.wasm?.path);
    }
    if (container.wasm?.variant) {
      url.searchParams.set("variant", container.wasm.variant);
    }

    console.log(`[Runtime] Downloading WASM from ${url.toString()}`);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Failed to download WASM: ${response.status} ${response.statusText}`);
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
        const result = await module.main();
        onLog(`WASM execution completed with result: ${result}`);
      } else {
        onLog("WASM module initialized successfully (no main function found)");
      }

      console.log("[Runtime] WASM execution completed");
    } finally {
      // Clean up the blob URL
      URL.revokeObjectURL(blobUrl);
    }
  }

  getRunningPodCount(): number {
    return this.runningPods.size;
  }
}
