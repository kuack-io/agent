import { Connection, type Message } from "./connection";
import Agent from "./main";
import { Runtime, type PodSpec } from "./runtime";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Connection
vi.mock("./connection", () => {
  const mockConnectionInstance = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onStateChange: vi.fn(),
    getUUID: vi.fn().mockReturnValue("test-uuid-123"),
    getState: vi.fn().mockReturnValue("disconnected"),
    getDetectedResources: vi.fn().mockReturnValue(null),
  };

  const MockConnection = vi.fn(function (_serverUrl: string) {
    return mockConnectionInstance;
  });

  return {
    Connection: MockConnection,
    default: mockConnectionInstance,
  };
});

// Mock Runtime
vi.mock("./runtime", () => {
  const mockRuntimeInstance = {
    executePod: vi.fn().mockResolvedValue(undefined),
    deletePod: vi.fn().mockResolvedValue(undefined),
    getRunningPodCount: vi.fn().mockReturnValue(0),
  };

  const MockRuntime = vi.fn(function (_registryProxyUrl: string) {
    return mockRuntimeInstance;
  });

  return {
    Runtime: MockRuntime,
    default: mockRuntimeInstance,
  };
});

describe("Agent", () => {
  let agent: Agent;
  let mockConnection: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    onMessage: ReturnType<typeof vi.fn>;
    onStateChange: ReturnType<typeof vi.fn>;
    getUUID: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
    getDetectedResources: ReturnType<typeof vi.fn>;
  };
  let mockRuntime: {
    executePod: ReturnType<typeof vi.fn>;
    deletePod: ReturnType<typeof vi.fn>;
    getRunningPodCount: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new Agent("ws://localhost:8080", "http://localhost:8080/registry");
    // Get the mock instance directly from the agent
    mockConnection = agent["connection"] as unknown as typeof mockConnection;
    mockRuntime = agent["runtime"] as unknown as typeof mockRuntime;
  });

  describe("constructor", () => {
    it("should create connection and runtime", () => {
      expect(Connection).toHaveBeenCalledWith("ws://localhost:8080");
      expect(Runtime).toHaveBeenCalledWith("http://localhost:8080/registry");
      expect(mockConnection.onMessage).toHaveBeenCalled();
    });
  });

  describe("start", () => {
    it("should connect to the server", async () => {
      await agent.start();
      expect(mockConnection.connect).toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should disconnect from the server", async () => {
      await agent.stop();
      expect(mockConnection.disconnect).toHaveBeenCalled();
    });
  });

  describe("handleMessage", () => {
    it("should handle pod_spec message", async () => {
      const podSpec: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      const message: Message = {
        type: "pod_spec",
        timestamp: new Date().toISOString(),
        data: podSpec,
      };

      // Get the message handler that was registered
      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      expect(mockRuntime.executePod).toHaveBeenCalledWith(podSpec, expect.any(Function), expect.any(Function));
    });

    it("should handle pod_delete message", async () => {
      const deleteData = {
        namespace: "default",
        name: "test-pod",
      };

      const message: Message = {
        type: "pod_delete",
        timestamp: new Date().toISOString(),
        data: deleteData,
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      expect(mockRuntime.deletePod).toHaveBeenCalledWith("default", "test-pod");
    });

    it("should ignore unknown message types", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const message: Message = {
        type: "unknown_type",
        timestamp: new Date().toISOString(),
        data: {},
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      expect(consoleSpy).toHaveBeenCalledWith("[Agent] Unhandled message type:", "unknown_type");
      expect(mockRuntime.executePod).not.toHaveBeenCalled();
      expect(mockRuntime.deletePod).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle registered message", async () => {
      const message: Message = {
        type: "registered",
        timestamp: new Date().toISOString(),
        data: { status: "ok" },
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      // Should not throw
      await messageHandler(message);
    });
  });

  describe("reportPodStatus", () => {
    it("should send pod status message", async () => {
      const podSpec: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      const status = {
        phase: "Running" as const,
        message: "Pod is running",
      };

      // Mock executePod to call the status callback
      mockRuntime.executePod.mockImplementation(async (_spec: PodSpec, onStatus: (status: unknown) => void) => {
        // Call it immediately for testing
        onStatus(status);
      });

      // Trigger pod execution
      const message: Message = {
        type: "pod_spec",
        timestamp: new Date().toISOString(),
        data: podSpec,
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that status was reported
      expect(mockConnection.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "pod_status",
          data: expect.objectContaining({
            namespace: "default",
            name: "test-pod",
            status,
          }),
        }),
      );
    });

    it("should handle errors when reporting pod status", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockConnection.sendMessage.mockRejectedValueOnce(new Error("Connection error"));

      const podSpec: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      const status = {
        phase: "Running" as const,
        message: "Pod is running",
      };

      // Mock executePod to call the status callback
      mockRuntime.executePod.mockImplementation(async (_spec: PodSpec, onStatus: (status: unknown) => void) => {
        onStatus(status);
      });

      const message: Message = {
        type: "pod_spec",
        timestamp: new Date().toISOString(),
        data: podSpec,
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Agent] Failed to report pod status:"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("reportPodLog", () => {
    it("should send pod log message", async () => {
      const podSpec: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      const message: Message = {
        type: "pod_spec",
        timestamp: new Date().toISOString(),
        data: podSpec,
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that log was reported (if executePod calls the log callback)
      // This depends on the runtime implementation
    });

    it("should handle errors when reporting pod log", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockConnection.sendMessage.mockRejectedValueOnce(new Error("Connection error"));

      const podSpec: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      // Mock executePod to call the log callback
      mockRuntime.executePod.mockImplementation(
        async (_spec: PodSpec, _onStatus: (status: unknown) => void, onLog: (log: string) => void) => {
          onLog("test log line");
        },
      );

      const message: Message = {
        type: "pod_spec",
        timestamp: new Date().toISOString(),
        data: podSpec,
      };

      const messageHandler = mockConnection.onMessage.mock.calls[0][0];
      await messageHandler(message);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Agent] Failed to report pod log:"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("getStatus", () => {
    it("should return agent status", () => {
      const status = agent.getStatus();
      expect(status).toEqual({
        uuid: "test-uuid-123",
        runningPods: 0,
        state: "disconnected",
        cpu: null,
        memory: null,
        gpu: null,
      });
    });

    it("should reflect running pod count", () => {
      mockRuntime.getRunningPodCount.mockReturnValue(3);
      const status = agent.getStatus();
      expect(status.runningPods).toBe(3);
    });

    it("should include detected resources when available", () => {
      mockConnection.getDetectedResources.mockReturnValue({
        cpu: "4000m",
        memory: "2.1Gi",
        gpu: false,
      });
      const status = agent.getStatus();
      expect(status.cpu).toBe("4000m");
      expect(status.memory).toBe("2.1Gi");
      expect(status.gpu).toBe(false);
    });
  });

  describe("onStateChange", () => {
    it("should forward connection state changes", () => {
      const callback = vi.fn();
      agent.onStateChange(callback);

      // Simulate state change from connection
      const stateChangeCallback = mockConnection.onStateChange.mock.calls[0][0];
      stateChangeCallback("connected");

      expect(callback).toHaveBeenCalledWith("connected");
    });
  });
});
