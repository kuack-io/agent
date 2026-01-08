import type { PodSpec } from "../../runtime";
import { setupRuntimeTestEnvironment } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime executePod", () => {
  it("executes bindgen WASM module when explicitly configured", async () => {
    const runtime = env.getRuntime();
    const runtimeInternals = env.getRuntimeInternals();
    const podSpec: PodSpec = {
      metadata: { name: "test-pod", namespace: "default" },
      spec: {
        containers: [
          {
            name: "runner",
            image: "test-image:latest",
            command: ["/bin/check"],
            args: ["--flag"],
            env: [{ name: "KEY", value: "VALUE" }],
            wasm: {
              type: "wasm-bindgen",
              path: "pkg/module_bg.wasm",
            },
          },
        ],
      },
    };

    const onStatus = vi.fn();
    const onLog = vi.fn();

    const wasmBytes = new Uint8Array([1, 2, 3]);
    const downloadWASM = vi.spyOn(runtimeInternals, "downloadWASM").mockResolvedValue(wasmBytes);
    const downloadJS = vi.spyOn(runtimeInternals, "downloadJS").mockResolvedValue("export const setup = () => {};");
    const executeWASM = vi.spyOn(runtimeInternals, "executeWASM").mockResolvedValue(undefined);

    await runtime.executePod(podSpec, onStatus, onLog);

    expect(downloadWASM).toHaveBeenCalled();
    expect(downloadWASM.mock.calls[0][0].wasm?.path).toBe("pkg/module_bg.wasm");
    expect(downloadJS).toHaveBeenCalledWith("pkg/module_bg.wasm", "test-image:latest", undefined);
    expect(executeWASM).toHaveBeenCalledWith(
      wasmBytes,
      "export const setup = () => {};",
      ["/bin/check"],
      ["--flag"],
      [{ name: "KEY", value: "VALUE" }],
      onLog,
      expect.any(AbortSignal),
    );
    expect(onStatus).toHaveBeenNthCalledWith(1, {
      phase: "Pending",
      message: "Downloading WASM module",
    });
    expect(onStatus).toHaveBeenNthCalledWith(2, {
      phase: "Running",
      message: "Executing WASM module (bindgen)",
    });
    expect(onStatus).toHaveBeenNthCalledWith(3, {
      phase: "Succeeded",
      message: "WASM execution completed",
    });
    expect(runtime.getExecutedPodCount()).toBe(1);
    expect(runtime.getRunningPodCount()).toBe(0);
  });

  it("fails if bindgen glue code download fails", async () => {
    const runtime = env.getRuntime();
    const runtimeInternals = env.getRuntimeInternals();
    const podSpec: PodSpec = {
      metadata: { name: "fail-pod", namespace: "default" },
      spec: {
        containers: [
          {
            name: "runner",
            image: "test-image:latest",
            wasm: { type: "wasm-bindgen", path: "pkg/fail.wasm" },
          },
        ],
      },
    };

    const onStatus = vi.fn();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.spyOn(runtimeInternals, "downloadWASM").mockResolvedValue(new Uint8Array([]));
    vi.spyOn(runtimeInternals, "downloadJS").mockRejectedValue(new Error("Network error"));

    await runtime.executePod(podSpec, onStatus, vi.fn());

    expect(onStatus).toHaveBeenLastCalledWith({
      phase: "Failed",
      message: expect.stringContaining("Failed to download JS glue for bindgen module: Error: Network error"),
    });

    errorLog.mockRestore();
  });

  it("executes WASI module when explicitly configured", async () => {
    const runtime = env.getRuntime();
    const runtimeInternals = env.getRuntimeInternals();
    const podSpec: PodSpec = {
      metadata: { name: "wasi-pod", namespace: "default" },
      spec: {
        containers: [
          {
            name: "runner",
            image: "test-image:latest",
            wasm: {
              type: "wasi",
              path: "app.wasm",
            },
          },
        ],
      },
    };

    const wasmBytes = new Uint8Array([9]);
    const downloadWASM = vi.spyOn(runtimeInternals, "downloadWASM").mockResolvedValue(wasmBytes);
    // WASI execution doesn't download JS
    const downloadJS = vi.spyOn(runtimeInternals, "downloadJS");
    const executeWASI = vi.spyOn(runtimeInternals, "executeWASI").mockResolvedValue(undefined);

    await runtime.executePod(podSpec, vi.fn(), vi.fn());

    expect(downloadWASM.mock.calls[0][0].wasm?.path).toBe("app.wasm");
    expect(downloadJS).not.toHaveBeenCalled();
    expect(executeWASI).toHaveBeenCalledWith(
      wasmBytes,
      podSpec.spec.containers[0].command || [],
      podSpec.spec.containers[0].args || [],
      podSpec.spec.containers[0].env || [],
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it("reports failure when no containers are provided", async () => {
    const runtime = env.getRuntime();
    const podSpec: PodSpec = {
      metadata: { name: "empty", namespace: "default" },
      spec: { containers: [] },
    };

    const onStatus = vi.fn();

    await runtime.executePod(podSpec, onStatus, vi.fn());

    expect(onStatus).toHaveBeenNthCalledWith(1, {
      phase: "Pending",
      message: "Downloading WASM module",
    });
    expect(onStatus).toHaveBeenNthCalledWith(2, {
      phase: "Failed",
      message: expect.stringContaining("No containers specified"),
    });
    expect(runtime.getExecutedPodCount()).toBe(1);
  });
});
