import { Connection } from "../../connection";
import { setupConnectionTestEnvironment, WS_URL, overrideProperty } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const TOKEN = "test-token";
const env = setupConnectionTestEnvironment();

describe("getDetectedResources", () => {
  it("returns null before connecting", () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(connection.getDetectedResources()).toBeNull();
  });

  it("captures resources after registration", async () => {
    vi.useFakeTimers();
    const perfDescriptor = overrideProperty(global.performance as Performance & { memory?: unknown }, "memory", {
      jsHeapSizeLimit: 2147483648,
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const resources = connection.getDetectedResources();
    expect(resources).not.toBeNull();
    expect(resources?.cpu).toBeTruthy();
    expect(resources?.memory).toBeTruthy();
    expect(typeof resources?.gpu).toBe("boolean");

    perfDescriptor();
    await connection.disconnect();
  });
});

describe("heartbeat error handling", () => {
  it("logs resource detection failures", async () => {
    vi.useFakeTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 100));
    const perfDescriptor = overrideProperty(global.performance as Performance & { memory?: unknown }, "memory", {
      jsHeapSizeLimit: 2147483648,
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
    });

    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const originalDetect = connection["detectResources"].bind(connection);
    connection["detectResources"] = vi.fn().mockRejectedValue(new Error("Resource detection failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await vi.advanceTimersByTimeAsync(150);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Agent] Failed to detect resources for heartbeat:"),
      expect.any(Error),
    );

    connection["detectResources"] = originalDetect;
    consoleSpy.mockRestore();
    perfDescriptor();
    await connection.disconnect();
  });

  it("logs heartbeat send failures", async () => {
    vi.useFakeTimers();
    const perfDescriptor = overrideProperty(global.performance as Performance & { memory?: unknown }, "memory", {
      jsHeapSizeLimit: 2147483648,
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
    });
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 100));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const originalSend = connection["sendMessage"].bind(connection);
    connection["sendMessage"] = vi.fn().mockRejectedValue(new Error("Send failed"));

    await vi.advanceTimersByTimeAsync(150);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Agent] Failed to send heartbeat:"),
      expect.any(Error),
    );

    connection["sendMessage"] = originalSend;
    consoleSpy.mockRestore();
    perfDescriptor();
    await connection.disconnect();
  });
});

describe("WebGPU detection", () => {
  const ensureMemory = () =>
    overrideProperty(global.performance as Performance & { memory?: unknown }, "memory", {
      jsHeapSizeLimit: 2147483648,
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
    });

  it("captures adapter info with vendor details", async () => {
    vi.useFakeTimers();
    const restoreMemory = ensureMemory();
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockResolvedValue({
        requestAdapterInfo: vi.fn().mockResolvedValue({
          vendor: "test-vendor",
          architecture: "test-arch",
          device: "test-device",
        }),
      }),
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 15000));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const resources = connection.getDetectedResources();
    expect(resources?.gpu).toBe(true);

    restoreGpu();
    restoreMemory();
    await connection.disconnect();
  });

  it("handles adapter info without vendor fields", async () => {
    vi.useFakeTimers();
    const restoreMemory = ensureMemory();
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockResolvedValue({
        requestAdapterInfo: vi.fn().mockResolvedValue({}),
      }),
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 15000));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    expect(connection.getDetectedResources()?.gpu).toBe(true);

    restoreGpu();
    restoreMemory();
    await connection.disconnect();
  });
});

describe("WebGPU detection errors", () => {
  const ensureMemory = () =>
    overrideProperty(global.performance as Performance & { memory?: unknown }, "memory", {
      jsHeapSizeLimit: 2147483648,
      usedJSHeapSize: 1000000,
      totalJSHeapSize: 2000000,
    });

  it("handles requestAdapter failures", async () => {
    vi.useFakeTimers();
    const restoreMemory = ensureMemory();
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockRejectedValue(new Error("Adapter error")),
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 15000));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const resources = connection.getDetectedResources();
    expect(resources?.gpu).toBe(false);
    expect(resources?.labels.gpuAdapter).toBe("unknown");

    restoreGpu();
    restoreMemory();
    await connection.disconnect();
  });

  it("handles requestAdapterInfo errors", async () => {
    vi.useFakeTimers();
    const restoreMemory = ensureMemory();
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockResolvedValue({
        requestAdapterInfo: vi.fn().mockRejectedValue(new Error("Info error")),
      }),
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 15000));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const resources = connection.getDetectedResources();
    expect(resources?.gpu).toBe(true);
    expect(resources?.labels.gpuAdapter).toBe("available");

    restoreGpu();
    restoreMemory();
    await connection.disconnect();
  });

  it("handles adapters missing requestAdapterInfo", async () => {
    vi.useFakeTimers();
    const restoreMemory = ensureMemory();
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockResolvedValue({}),
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 15000));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    const resources = connection.getDetectedResources();
    expect(resources?.gpu).toBe(true);
    expect(resources?.labels.gpuAdapter).toBe("available");

    restoreGpu();
    restoreMemory();
    await connection.disconnect();
  });
});

describe("Resource detection edge cases", () => {
  it("throws when CPU cores cannot be detected", async () => {
    const restoreHardware = overrideProperty(
      navigator as Navigator & { hardwareConcurrency?: number },
      "hardwareConcurrency",
      undefined,
    );
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    await expect(connection.detectResources()).rejects.toThrow("Unable to detect CPU cores");
    restoreHardware();
  });

  it("uses deviceMemory for tiny devices", async () => {
    const restoreHardware = overrideProperty(
      navigator as Navigator & { hardwareConcurrency?: number },
      "hardwareConcurrency",
      4,
    );
    const restoreMemory = overrideProperty(
      global.performance as Performance & { memory?: unknown },
      "memory",
      undefined,
    );
    const restoreDeviceMemory = overrideProperty(
      navigator as Navigator & { deviceMemory?: number },
      "deviceMemory",
      0.5,
    );
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const resources = await connection.detectResources(true);
    expect(resources.memory).toBe("0.5Gi");
    restoreHardware();
    restoreMemory();
    restoreDeviceMemory();
  });

  it("caps medium device memory", async () => {
    const restoreHardware = overrideProperty(
      navigator as Navigator & { hardwareConcurrency?: number },
      "hardwareConcurrency",
      4,
    );
    const restoreMemory = overrideProperty(
      global.performance as Performance & { memory?: unknown },
      "memory",
      undefined,
    );
    const restoreDeviceMemory = overrideProperty(navigator as Navigator & { deviceMemory?: number }, "deviceMemory", 6);
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const resources = await connection.detectResources(true);
    expect(resources.memory).toBe("3Gi");
    restoreHardware();
    restoreMemory();
    restoreDeviceMemory();
  });
});
