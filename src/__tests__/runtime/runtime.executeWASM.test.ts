import { setupRuntimeTestEnvironment, setupBlobUrlMocks } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime executeWASM", () => {
  it("runs wasm module, forwards env, and restores console", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const { createSpy, revokeSpy, restore } = setupBlobUrlMocks();
    const wasmBytes = new Uint8Array([0, 1]);
    const jsCode = "export default {}";
    const onLog = vi.fn();
    const controller = new AbortController();

    const module = {
      default: vi.fn().mockResolvedValue(undefined),
      main: vi.fn().mockResolvedValue("OK"),
    };

    const importSpy = vi.spyOn(runtimeInternals, "importWasmBindgenModule").mockResolvedValue(module);

    const originalConsoleLog = console.log;

    await runtimeInternals.executeWASM(
      wasmBytes,
      jsCode,
      ["/app"],
      ["--inspect"],
      [{ name: "ENV", value: "VALUE" }],
      onLog,
      controller.signal,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(importSpy).toHaveBeenCalledWith("blob:mock-url");
    expect(module.default).toHaveBeenCalledWith({ module_or_path: wasmBytes });
    expect(module.main).toHaveBeenCalledWith({ ENV: "VALUE" });
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining("Loading wasm-bindgen JS module"));
    expect(onLog).toHaveBeenCalledWith("WASM execution completed with result: OK");
    expect(revokeSpy).toHaveBeenCalledWith("blob:mock-url");
    expect(console.log).toBe(originalConsoleLog);
    restore();
  });

  it("aborts execution when signal is already triggered", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const { restore } = setupBlobUrlMocks();
    const controller = new AbortController();
    controller.abort();

    const importSpy = vi.spyOn(runtimeInternals, "importWasmBindgenModule");

    await expect(
      runtimeInternals.executeWASM(new Uint8Array([1]), "export default {}", [], [], [], vi.fn(), controller.signal),
    ).rejects.toThrow("Execution aborted");

    expect(importSpy).not.toHaveBeenCalled();
    restore();
  });

  it("ignores agent status error logs and does not duplicate them", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const { restore } = setupBlobUrlMocks();
    const controller = new AbortController();
    const onLog = vi.fn();

    const module = {
      default: vi.fn().mockResolvedValue(undefined),
      main: vi.fn().mockImplementation(async () => {
        console.error("[Agent] Failed to report pod status: timeout");
        return undefined;
      }),
    };

    vi.spyOn(runtimeInternals, "importWasmBindgenModule").mockResolvedValue(module);

    await runtimeInternals.executeWASM(new Uint8Array([2]), "export default {}", [], [], [], onLog, controller.signal);

    expect(onLog).not.toHaveBeenCalledWith(expect.stringContaining("[Agent] Failed to report pod status"));
    restore();
  });

  it("logs initialization message when main is unavailable", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const { restore } = setupBlobUrlMocks();
    const controller = new AbortController();
    const onLog = vi.fn();

    const module = {
      default: vi.fn().mockResolvedValue(undefined),
    } as { default: () => Promise<void>; main?: undefined };

    vi.spyOn(runtimeInternals, "importWasmBindgenModule").mockResolvedValue(module);

    await runtimeInternals.executeWASM(new Uint8Array([3]), "export default {}", [], [], [], onLog, controller.signal);

    expect(onLog).toHaveBeenCalledWith("WASM module initialized successfully (no main function found)");
    restore();
  });

  it("aborts after initialization if the signal flips to aborted", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const { restore } = setupBlobUrlMocks();
    const controller = new AbortController();

    const module = {
      default: vi.fn().mockImplementation(async () => {
        controller.abort();
      }),
      main: vi.fn(),
    };

    vi.spyOn(runtimeInternals, "importWasmBindgenModule").mockResolvedValue(module);

    await expect(
      runtimeInternals.executeWASM(new Uint8Array([4]), "export default {}", [], [], [], vi.fn(), controller.signal),
    ).rejects.toThrow("Execution aborted");

    expect(module.main).not.toHaveBeenCalled();
    restore();
  });
});
