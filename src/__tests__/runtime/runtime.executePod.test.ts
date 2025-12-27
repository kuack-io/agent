import type { PodSpec } from "../../runtime";
import { setupRuntimeTestEnvironment } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime executePod", () => {
  it("discovers WASM path from package.json and executes module", async () => {
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
          },
        ],
      },
    };

    const onStatus = vi.fn();
    const onLog = vi.fn();

    const downloadFile = vi
      .spyOn(runtimeInternals, "downloadFile")
      .mockResolvedValue(JSON.stringify({ main: "pkg/module.js" }));
    const wasmBytes = new Uint8Array([1, 2, 3]);
    const downloadWASM = vi.spyOn(runtimeInternals, "downloadWASM").mockResolvedValue(wasmBytes);
    const downloadJS = vi.spyOn(runtimeInternals, "downloadJS").mockResolvedValue("export const setup = () => {};");
    const executeWASM = vi.spyOn(runtimeInternals, "executeWASM").mockResolvedValue(undefined);

    await runtime.executePod(podSpec, onStatus, onLog);

    expect(downloadFile).toHaveBeenCalledWith("test-image:latest", "pkg/package.json", undefined);
    expect(downloadWASM).toHaveBeenCalled();
    expect(downloadWASM.mock.calls[0][0].wasm?.path).toBe("pkg/pkg/module_bg.wasm");
    expect(downloadJS).toHaveBeenCalledWith("pkg/pkg/module_bg.wasm", "test-image:latest", undefined);
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
      message: "Executing WASM module",
    });
    expect(onStatus).toHaveBeenNthCalledWith(3, {
      phase: "Succeeded",
      message: "WASM execution completed",
    });
    expect(runtime.getExecutedPodCount()).toBe(1);
    expect(runtime.getRunningPodCount()).toBe(0);
  });

  it("falls back to derived WASM path when auto-discovery fails", async () => {
    const runtime = env.getRuntime();
    const runtimeInternals = env.getRuntimeInternals();
    const podSpec: PodSpec = {
      metadata: { name: "fallback-pod", namespace: "jobs" },
      spec: {
        containers: [
          {
            name: "runner",
            image: "ghcr.io/kuack-io/super-checker:1.2.3",
          },
        ],
      },
    };

    vi.spyOn(runtimeInternals, "downloadFile").mockRejectedValue(new Error("missing pkg"));
    const downloadWASM = vi.spyOn(runtimeInternals, "downloadWASM").mockResolvedValue(new Uint8Array([9]));
    const downloadJS = vi.spyOn(runtimeInternals, "downloadJS").mockResolvedValue("console.log('fallback');");
    vi.spyOn(runtimeInternals, "executeWASM").mockResolvedValue(undefined);

    await runtime.executePod(podSpec, vi.fn(), vi.fn());

    expect(downloadWASM.mock.calls[0][0].wasm?.path).toBe("pkg/super_checker_bg.wasm");
    expect(downloadJS).toHaveBeenCalledWith(
      "pkg/super_checker_bg.wasm",
      "ghcr.io/kuack-io/super-checker:1.2.3",
      undefined,
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
