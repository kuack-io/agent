import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// Mock Runtime class
const mockRuntimeInstance = {
  executePod: vi.fn().mockResolvedValue(undefined),
  deletePod: vi.fn().mockResolvedValue(undefined),
  getRunningPodCount: vi.fn(),
  getExecutedPodCount: vi.fn(),
};

const MockRuntime = vi.fn(function () {
  return mockRuntimeInstance;
});

vi.mock("../../runtime", () => ({
  Runtime: MockRuntime,
}));

describe("Worker", () => {
  let originalSelf: unknown;
  let mockPostMessage: Mock;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules(); // Reset modules to ensure fresh import of worker.ts

    // Setup mock self
    mockPostMessage = vi.fn();
    originalSelf = global.self;

    // We need to augment global scope to simulated WorkerGlobalScope
    // @ts-expect-error - simulating worker scope
    global.self = {
      onmessage: null,
      postMessage: mockPostMessage,
    };

    // Import worker to verify side effects (setting onmessage)
    await import("../../worker");
  });

  afterEach(() => {
    global.self = originalSelf as Window & typeof globalThis;
  });

  const dispatchMessage = async (data: unknown) => {
    if (self.onmessage) {
      await self.onmessage({ data } as MessageEvent);
    }
  };

  it("initializes Runtime on init message", async () => {
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    expect(MockRuntime).toHaveBeenCalledWith("http://registry", "token");
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "initialized" });
  });

  it("handles get_status when runtime is not initialized", async () => {
    // Since modules are reset, runtime is null by default
    await dispatchMessage({ type: "get_status" });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "status_update",
      payload: { runningPods: 0, executedPods: 0 },
    });
  });

  it("handles execute_pod when runtime is not initialized", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const podSpec = { metadata: { name: "test-pod", namespace: "default" } };

    await dispatchMessage({
      type: "execute_pod",
      payload: podSpec,
    });

    expect(consoleSpy).toHaveBeenCalledWith("[Worker] Error handling message:", expect.any(Error));
    expect(consoleSpy.mock.calls[0][1].message).toBe("Runtime not initialized");
    consoleSpy.mockRestore();
  });

  it("handles delete_pod when runtime is not initialized", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchMessage({
      type: "delete_pod",
      payload: { namespace: "default", name: "test-pod" },
    });

    expect(consoleSpy).toHaveBeenCalledWith("[Worker] Error handling message:", expect.any(Error));
    expect(consoleSpy.mock.calls[0][1].message).toBe("Runtime not initialized");
    consoleSpy.mockRestore();
  });

  it("handles unknown message types", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await dispatchMessage({
      type: "unknown_type",
      payload: {},
    });

    expect(consoleSpy).toHaveBeenCalledWith("[Worker] Unknown message type:", "unknown_type");
    consoleSpy.mockRestore();
  });

  it("executes pod on execute_pod message", async () => {
    // Initialize first
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    const podSpec = { metadata: { name: "test-pod", namespace: "default" } };
    await dispatchMessage({
      type: "execute_pod",
      payload: podSpec,
    });

    expect(mockRuntimeInstance.executePod).toHaveBeenCalledWith(podSpec, expect.any(Function), expect.any(Function));
  });

  it("reports pod status updates", async () => {
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    const podSpec = { metadata: { name: "test-pod", namespace: "default" } };

    mockRuntimeInstance.executePod.mockImplementation((spec, onStatus, _onLog) => {
      onStatus({ phase: "Running", message: "Running" });
    });

    await dispatchMessage({
      type: "execute_pod",
      payload: podSpec,
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "pod_status",
      payload: {
        namespace: "default",
        name: "test-pod",
        status: { phase: "Running", message: "Running" },
      },
    });
  });

  it("reports pod log updates", async () => {
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    const podSpec = { metadata: { name: "test-pod", namespace: "default" } };

    mockRuntimeInstance.executePod.mockImplementation((spec, onStatus, onLog) => {
      onLog("log line");
    });

    await dispatchMessage({
      type: "execute_pod",
      payload: podSpec,
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "pod_log",
      payload: {
        namespace: "default",
        name: "test-pod",
        log: "log line",
      },
    });
  });

  it("handles pod execution errors", async () => {
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    const podSpec = { metadata: { name: "test-pod", namespace: "default" } };

    mockRuntimeInstance.executePod.mockRejectedValue(new Error("Execution failed"));

    await dispatchMessage({
      type: "execute_pod",
      payload: podSpec,
    });

    // Wait for promise rejection handling
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "pod_status",
      payload: {
        namespace: "default",
        name: "test-pod",
        status: { phase: "Failed", message: "Internal Worker Error: Error: Execution failed" },
      },
    });
  });

  it("deletes pod on delete_pod message", async () => {
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    await dispatchMessage({
      type: "delete_pod",
      payload: { namespace: "default", name: "test-pod" },
    });

    expect(mockRuntimeInstance.deletePod).toHaveBeenCalledWith("default", "test-pod");
  });

  it("reports status on get_status message", async () => {
    await dispatchMessage({
      type: "init",
      payload: { registryProxyUrl: "http://registry", token: "token" },
    });

    mockRuntimeInstance.getRunningPodCount.mockReturnValue(5);
    mockRuntimeInstance.getExecutedPodCount.mockReturnValue(10);

    await dispatchMessage({ type: "get_status" });

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "status_update",
      payload: { runningPods: 5, executedPods: 10 },
    });
  });
});
