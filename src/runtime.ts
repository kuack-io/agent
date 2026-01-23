import { WASI, File as WasiFile, OpenFile, PreopenDirectory, ConsoleStdout } from "@bjorn3/browser_wasi_shim";

interface WasmBindgenModule {
  default: (config: { module_or_path: Uint8Array }) => Promise<void>;
  main?: (env?: Record<string, string>) => Promise<unknown>;
}

export interface WasmSpec {
  path?: string;
  variant?: string;
  image?: string;
  type?: string;
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
  // Note: We no longer limit env vars. We pass all env vars to WASI and rely on patching
  // fd_write for runtime calls. If WASI initialization fails due to iovec limit, we provide
  // a clear error message. This is a limitation of browser_wasi_shim that we cannot work around
  // without truncating env vars (which we don't want to do).
  private runningPods: Map<string, AbortController> = new Map();
  private executedPodCount: number = 0;
  private registryProxyUrl: string;
  private token: string;

  constructor(registryProxyUrl: string, token: string) {
    this.registryProxyUrl = registryProxyUrl;
    this.token = token;
  }

  private log(message: string) {
    console.log(`[Runtime] ${message}`);
  }

  private logWarn(message: string) {
    console.warn(`[Runtime] ${message}`);
  }

  private logError(message: string) {
    console.error(`[Runtime] ${message}`);
  }

  /**
   * Sanitizes a URL by replacing the token parameter with "***" for logging purposes.
   */
  private sanitizeUrlForLogging(url: URL): string {
    const sanitizedUrl = new URL(url.toString());
    if (sanitizedUrl.searchParams.has("token")) {
      sanitizedUrl.searchParams.set("token", "***");
    }
    return sanitizedUrl.toString();
  }

  private isNotFoundError(err: unknown): err is Error {
    return err instanceof Error && err.message === "HTTP 404: Not Found";
  }

  private normalizeEnv(env: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
    // Normalize env vars: deduplicate and filter out invalid entries.
    // We do NOT truncate env vars - we pass all of them to WASI.
    // If WASI initialization fails due to iovec limit, we provide a clear error message.
    const filtered: Array<{ name: string; value: string }> = [];
    const deduped = new Set<string>();

    for (const entry of env) {
      if (!entry.name) {
        continue;
      }
      if (deduped.has(entry.name)) {
        continue;
      }
      deduped.add(entry.name);
      filtered.push({ name: entry.name, value: entry.value ?? "" });
    }

    return filtered;
  }

  getRunningPodCount(): number {
    return this.runningPods.size;
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
    this.log(`Executing pod: ${podKey}`);
    this.executedPodCount++;

    onStatus({
      phase: "Pending",
      message: "Downloading WASM module",
    });

    try {
      const container = podSpec.spec.containers[0];
      if (!container) {
        throw new Error("No containers specified");
      }

      if (!container.wasm || !container.wasm.path) {
        throw new Error("Missing WASM configuration (path) in PodSpec. Node should have resolved this.");
      }

      const wasmType = container.wasm.type || "wasi";
      const isWasi = wasmType === "wasi";
      const wasmPath = container.wasm.path;

      this.log(`Configuration: Type=${wasmType}, Path=${wasmPath}`);
      this.log(`Command: ${JSON.stringify(container.command || [])}`);
      this.log(`Args: ${JSON.stringify(container.args || [])}`);
      onLog(
        `[Runtime] Executing pod ${podKey} with command: ${JSON.stringify(container.command || [])}, args: ${JSON.stringify(container.args || [])}`,
      );

      const wasmBytes = await this.downloadWASM(container);

      let jsCode = "";
      if (!isWasi) {
        try {
          const imageRef = container.wasm?.image ?? container.image;
          jsCode = await this.downloadJS(wasmPath, imageRef, container.wasm?.variant);
        } catch (err) {
          this.logError(`Failed to download JS glue for bindgen module: ${err}`);
          throw new Error(`Failed to download JS glue for bindgen module: ${err}`);
        }
      }

      onStatus({
        phase: "Running",
        message: isWasi ? "Executing WASI module" : "Executing WASM module (bindgen)",
      });

      const abortController = new AbortController();
      this.runningPods.set(podKey, abortController);

      if (isWasi) {
        // For WASI modules, the provider sets command to the WASM path (e.g., ["/out.wasm"]).
        // This is the WASM module itself, not a command to execute. We should ignore it and only use args.
        // The actual command to run inside the container is in args.
        let command = container.command || [];
        const args = container.args || [];

        // If command is the WASM path (common pattern: ["/out.wasm"] or ["/output.wasm"]), ignore it
        if (
          command.length === 1 &&
          (command[0] === "/out.wasm" || command[0] === "/output.wasm" || command[0].endsWith(".wasm"))
        ) {
          this.log(`Ignoring WASM path in command: ${command[0]}, using only args`);
          command = [];
        }

        this.log(`Executing WASI with command: ${JSON.stringify(command)}, args: ${JSON.stringify(args)}`);
        onLog(`[Runtime] Executing WASI: command=${JSON.stringify(command)}, args=${JSON.stringify(args)}`);
        await this.executeWASI(wasmBytes, command, args, container.env || [], onLog, abortController.signal);
      } else {
        const command = container.command || [];
        const args = container.args || [];
        this.log(`Executing WASM with command: ${JSON.stringify(command)}, args: ${JSON.stringify(args)}`);
        onLog(`[Runtime] Executing WASM: command=${JSON.stringify(command)}, args=${JSON.stringify(args)}`);
        await this.executeWASM(wasmBytes, jsCode, command, args, container.env || [], onLog, abortController.signal);
      }

      onStatus({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    } catch (error) {
      this.logError(`Pod execution failed: ${error}`);
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
      this.log(`Terminating pod: ${podKey}`);
      controller.abort();
      this.runningPods.delete(podKey);
    }
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 3,
    backoff = 1000,
    timeoutMs = 30000,
  ): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return response;
        }

        if (response.status === 404) {
          throw new Error(`HTTP 404: Not Found`);
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (err) {
        const isLastAttempt = i === retries - 1;
        this.logWarn(
          `Fetch failed for ${this.sanitizeUrlForLogging(new URL(url))} (attempt ${i + 1}/${retries}): ${err}`,
        );

        if (isLastAttempt) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, backoff * Math.pow(2, i)));
      }
    }
    throw new Error("Unreachable");
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

    this.log(`Downloading WASM from ${this.sanitizeUrlForLogging(url)}`);

    let response: Response;
    try {
      response = await this.fetchWithRetry(url.toString(), {}, 3, 1000, 120000);
    } catch (err: unknown) {
      // Fallback strategies for 404s
      if (this.isNotFoundError(err)) {
        // Strategy 1: If path was not "out.wasm", try "out.wasm" (common c2w default)
        const currentPath = url.searchParams.get("path");
        if (currentPath !== "/out.wasm" && currentPath !== "out.wasm") {
          this.logWarn(`WASM download 404 for ${currentPath}, trying fallback: out.wasm`);
          url.searchParams.set("path", "out.wasm");
          try {
            response = await this.fetchWithRetry(url.toString(), {}, 3, 1000, 120000);
          } catch {
            // If fallback fails, throw original error (or maybe the new one?)
            // Throwing the original error is often less confusing if the fallback was just a guess.
            // But if the fallback 404s too, throwing that is fine.
            throw err;
          }
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async downloadFile(imageRef: string, path: string, variant?: string): Promise<string> {
    const url = this.buildRegistryUrl();
    url.searchParams.set("image", imageRef);
    url.searchParams.set("path", path);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    if (variant) {
      url.searchParams.set("variant", variant);
    }

    this.log(`Downloading file from ${this.sanitizeUrlForLogging(url)}`);

    const response = await this.fetchWithRetry(url.toString());
    return await response.text();
  }

  private async downloadJS(wasmPath: string, imageRef: string, variant?: string): Promise<string> {
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

    this.log(`Downloading JS glue code from ${this.sanitizeUrlForLogging(url)}`);

    const response = await this.fetchWithRetry(url.toString());
    return await response.text();
  }

  // Helper method to make dynamic import testable
  private async importWasmBindgenModule(blobUrl: string): Promise<WasmBindgenModule> {
    return await import(/* @vite-ignore */ blobUrl);
  }

  private async executeWASI(
    wasmBytes: Uint8Array,
    command: string[],
    args: string[],
    env: Array<{ name: string; value: string }>,
    onLog: (log: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    this.log("Initializing WASI...");
    // WASI/c2w convention: argv[0] is the program name, argv[1:] are the actual arguments.
    // c2w-generated WASM binaries parse argv[1:] for their own options (like --entrypoint),
    // then treat the first non-option argument as the COMMAND to run inside the container.
    // We must prepend a program name placeholder so that the user's command starts at argv[1].
    const programName = "/wasm";
    const argsList = [programName, ...command, ...args];
    this.log(`WASI argsList: ${JSON.stringify(argsList)}`);
    onLog(`[Runtime] WASI argsList: ${JSON.stringify(argsList)}`);

    const normalizedEnv = this.normalizeEnv(env);
    this.log(`Environment variables: ${normalizedEnv.length} (from ${env.length} original)`);

    // Log the exact list of environment variables for debugging
    const envObj: string[] = normalizedEnv.map((e) => `${e.name}=${e.value}`);

    // Create WASI instance with all env vars. The WASI constructor writes env vars during
    // initialization, which can hit the iovec limit (1024). Unfortunately, we can't patch
    // fd_write before the constructor runs because the WASI library creates its own wasiImport
    // object internally during construction.
    //
    // We pass all env vars and let the WASI library handle them. If it hits the iovec limit
    // during initialization, it will fail with a clear error that we catch and report.
    // The patching we do after creation helps with runtime fd_write calls from within WASM.
    const wasi = new WASI(argsList, envObj, [
      new OpenFile(new WasiFile(new Uint8Array([]))), // stdin
      ConsoleStdout.lineBuffered((line) => {
        onLog(line);
      }),
      ConsoleStdout.lineBuffered((line) => {
        onLog(line);
      }),
      new PreopenDirectory("/", new Map()),
    ]);

    // Patch fd_write and other syscalls to handle iovec limits for runtime calls
    this.patchWasiImports(wasi);

    try {
      if (signal.aborted) throw new Error("Execution aborted");

      const instance = await WebAssembly.instantiate(wasmBytes, {
        wasi_snapshot_preview1: wasi.wasiImport,
      });

      this.log("Running WASI module...");

      if (signal.aborted) throw new Error("Execution aborted");

      let wasmInstance: WebAssembly.Instance;
      if ("instance" in instance) {
        wasmInstance = (instance as unknown as WebAssembly.WebAssemblyInstantiatedSource).instance;
      } else {
        wasmInstance = instance as WebAssembly.Instance;
      }

      const exitCode = wasi.start(
        wasmInstance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
      );

      // Log exit code if non-zero
      if (exitCode !== 0) {
        onLog(`WASI execution completed with exit code: ${exitCode}`);
        // Check if this might be the iovec limit error (exit code 1 with "too many write" in logs)
        // The WASI library logs "too many write (1025 > 1024)failed to prepare env info" to stderr
        // during initialization, then exits with code 1. We detect this pattern.
        const errorMsg = `Process exited with code ${exitCode}`;
        // Note: The actual "too many write" message is in stderr logs, not in the error object.
        // We'll provide helpful error message for exit code 1 which often indicates this issue.
        if (exitCode === 1) {
          const envCount = envObj.length;
          this.logError(
            `[Runtime] WASI execution failed with exit code 1. This often indicates the iovec limit was exceeded during initialization.`,
          );
          this.logError(
            `[Runtime] You have ${envCount} environment variables. Check logs above for "too many write (1025 > 1024)" message.`,
          );
          onLog(`[Runtime] WASI execution failed: exit code 1 (likely iovec limit exceeded with ${envCount} env vars)`);
          throw new Error(
            `WASI execution failed: Process exited with code 1. This often indicates the iovec limit (1024) was exceeded during initialization. ` +
              `You have ${envCount} environment variables. This is a limitation of browser_wasi_shim. ` +
              `Solution: reduce env var count/size in image`,
          );
        }
        throw new Error(errorMsg);
      } else {
        this.log(`WASI execution completed successfully`);
        onLog(`WASI execution completed successfully`);
      }
    } catch (err) {
      this.logError(`WASI execution failed: ${err}`);
      onLog(`[Runtime] WASI execution failed: ${err}`);
      if (err instanceof Error && err.stack) {
        onLog(`Stack: ${err.stack}`);
      }

      // Check if error is related to iovec limit and provide helpful message
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (
        errorMsg.includes("too many write") ||
        errorMsg.includes("1024") ||
        errorMsg.includes("1025") ||
        errorMsg.includes("failed to prepare env info")
      ) {
        const envCount = envObj.length;
        this.logError(`[Runtime] WASI initialization failed: iovec limit exceeded (likely 1025 > 1024)`);
        this.logError(
          `[Runtime] The browser_wasi_shim has a limit of ~1024 iovec structures (env var parts) during initialization.`,
        );
        this.logError(
          `[Runtime] You have ${envCount} env vars. Provider filtering helps, but you may have too many or too long env vars`,
        );
        this.logError(`[Runtime] Solution: Reduce env vars in image, use shorter values`);

        onLog(`[Runtime] WASI initialization failed: iovec limit exceeded (1025 > 1024) with ${envCount} env vars`);

        throw new Error(
          `WASI execution failed: iovec limit exceeded (1025 > 1024) with ${envCount} env vars. ` +
            `Browser shim limitation. Solution: Reduce env vars in image, use shorter values`,
        );
      }

      if (signal.aborted) {
        throw new Error("Execution aborted");
      }
      throw err;
    }
  }

  // Exposed for testing
  private patchWasiImports(wasi: WASI): void {
    // Monkey-patch fd_write to workaround IOV_MAX limit (1024) in browser_wasi_shim
    const originalFdWrite = wasi.wasiImport.fd_write as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      nwritten_ptr: number,
    ) => number;

    wasi.wasiImport.fd_write = (fd: number, iovs_ptr: number, iovs_len: number, nwritten_ptr: number): number => {
      if (iovs_len <= 1024) {
        return originalFdWrite(fd, iovs_ptr, iovs_len, nwritten_ptr);
      }

      let totalWritten = 0;
      let currentIovsPtr = iovs_ptr;
      let remainingIovs = iovs_len;
      // WASM32 iovec is 8 bytes (4 ptr + 4 len)
      const iovecSize = 8;

      while (remainingIovs > 0) {
        const batchSize = Math.min(remainingIovs, 1024);
        const ret = originalFdWrite(fd, currentIovsPtr, batchSize, nwritten_ptr);

        if (ret !== 0) {
          return ret;
        }

        // Read how many bytes were written in this batch
        const mem = wasi.inst.exports.memory as WebAssembly.Memory;
        const view = new DataView(mem.buffer);
        const writtenInBatch = view.getUint32(nwritten_ptr, true);
        totalWritten += writtenInBatch;

        remainingIovs -= batchSize;
        currentIovsPtr += batchSize * iovecSize;
      }

      // Write total bytes written back to memory
      const mem = wasi.inst.exports.memory as WebAssembly.Memory;
      const view = new DataView(mem.buffer);
      view.setUint32(nwritten_ptr, totalWritten, true);

      return 0; // ERRNO_SUCCESS
    };

    // Patch fd_pwrite
    const originalFdPwrite = wasi.wasiImport.fd_pwrite as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      offset: bigint,
      nwritten_ptr: number,
    ) => number;

    wasi.wasiImport.fd_pwrite = (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      offset: bigint,
      nwritten_ptr: number,
    ): number => {
      if (iovs_len <= 1024) {
        return originalFdPwrite(fd, iovs_ptr, iovs_len, offset, nwritten_ptr);
      }

      let totalWritten = 0;
      let currentIovsPtr = iovs_ptr;
      let remainingIovs = iovs_len;
      const iovecSize = 8;
      let currentOffset = offset;

      while (remainingIovs > 0) {
        const batchSize = Math.min(remainingIovs, 1024);
        const ret = originalFdPwrite(fd, currentIovsPtr, batchSize, currentOffset, nwritten_ptr);

        if (ret !== 0) {
          return ret;
        }

        const mem = wasi.inst.exports.memory as WebAssembly.Memory;
        const view = new DataView(mem.buffer);
        const writtenInBatch = view.getUint32(nwritten_ptr, true);
        totalWritten += writtenInBatch;
        currentOffset += BigInt(writtenInBatch);

        remainingIovs -= batchSize;
        currentIovsPtr += batchSize * iovecSize;
      }

      const mem = wasi.inst.exports.memory as WebAssembly.Memory;
      const view = new DataView(mem.buffer);
      view.setUint32(nwritten_ptr, totalWritten, true);

      return 0;
    };

    // Patch fd_read
    const originalFdRead = wasi.wasiImport.fd_read as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      nread_ptr: number,
    ) => number;

    wasi.wasiImport.fd_read = (fd: number, iovs_ptr: number, iovs_len: number, nread_ptr: number): number => {
      if (iovs_len <= 1024) {
        return originalFdRead(fd, iovs_ptr, iovs_len, nread_ptr);
      }

      let totalRead = 0;
      let currentIovsPtr = iovs_ptr;
      let remainingIovs = iovs_len;
      const iovecSize = 8;

      while (remainingIovs > 0) {
        const batchSize = Math.min(remainingIovs, 1024);
        const ret = originalFdRead(fd, currentIovsPtr, batchSize, nread_ptr);

        if (ret !== 0) {
          return ret;
        }

        const mem = wasi.inst.exports.memory as WebAssembly.Memory;
        const view = new DataView(mem.buffer);
        const readInBatch = view.getUint32(nread_ptr, true);
        totalRead += readInBatch;

        if (readInBatch === 0) {
          break; // EOF or no more data
        }

        remainingIovs -= batchSize;
        currentIovsPtr += batchSize * iovecSize;
      }

      const mem = wasi.inst.exports.memory as WebAssembly.Memory;
      const view = new DataView(mem.buffer);
      view.setUint32(nread_ptr, totalRead, true);

      return 0;
    };

    // Patch fd_pread
    const originalFdPread = wasi.wasiImport.fd_pread as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      offset: bigint,
      nread_ptr: number,
    ) => number;

    wasi.wasiImport.fd_pread = (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      offset: bigint,
      nread_ptr: number,
    ): number => {
      if (iovs_len <= 1024) {
        return originalFdPread(fd, iovs_ptr, iovs_len, offset, nread_ptr);
      }

      let totalRead = 0;
      let currentIovsPtr = iovs_ptr;
      let remainingIovs = iovs_len;
      const iovecSize = 8;
      let currentOffset = offset;

      while (remainingIovs > 0) {
        const batchSize = Math.min(remainingIovs, 1024);
        const ret = originalFdPread(fd, currentIovsPtr, batchSize, currentOffset, nread_ptr);

        if (ret !== 0) {
          return ret;
        }

        const mem = wasi.inst.exports.memory as WebAssembly.Memory;
        const view = new DataView(mem.buffer);
        const readInBatch = view.getUint32(nread_ptr, true);
        totalRead += readInBatch;
        currentOffset += BigInt(readInBatch);

        if (readInBatch === 0) {
          break; // EOF
        }

        remainingIovs -= batchSize;
        currentIovsPtr += batchSize * iovecSize;
      }

      const mem = wasi.inst.exports.memory as WebAssembly.Memory;
      const view = new DataView(mem.buffer);
      view.setUint32(nread_ptr, totalRead, true);

      return 0;
    };
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
        if (!logMessage.includes("[Agent] Failed to report pod status")) {
          onLog(logMessage);
        }
      } catch {
        // Ignore logging errors to prevent infinite loops
      } finally {
        inLog = false;
      }
    };

    console.log = (...args) => interceptLog(originalConsoleLog, ...args);
    console.error = (...args) => interceptLog(originalConsoleError, ...args);
    console.warn = (...args) => interceptLog(originalConsoleWarn, ...args);
    console.info = (...args) => interceptLog(originalConsoleInfo, ...args);

    this.log("Loading wasm-bindgen JS module...");

    const blob = new Blob([jsCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    try {
      if (signal.aborted) throw new Error("Execution aborted");

      const module = await this.importWasmBindgenModule(blobUrl);

      this.log("Initializing wasm-bindgen module...");

      await module.default({ module_or_path: wasmBytes });

      this.log("Running WASM module...");

      if (signal.aborted) throw new Error("Execution aborted");

      if (typeof module.main === "function") {
        const envObj: Record<string, string> = {};
        const normalizedEnv = this.normalizeEnv(env);
        for (const e of normalizedEnv) {
          envObj[e.name] = e.value;
        }
        await module.main(envObj);
      } else {
        this.log("WASM module initialized successfully (no main function found)");
        onLog("WASM module initialized successfully (no main function found)");
      }

      this.log("WASM execution completed");
    } finally {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
      URL.revokeObjectURL(blobUrl);
    }
  }
}
