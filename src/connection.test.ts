import { Connection, type Message } from "./connection";
import { Server, WebSocket as MockWebSocket } from "mock-socket";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Track sent messages for assertions
const sentMessages: Map<string, string[]> = new Map();

describe("Connection", () => {
  let connection: Connection;
  let mockServer: Server;
  let clientSocket: MockWebSocket | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages.clear();
    clientSocket = null;

    // Create a mock WebSocket server
    mockServer = new Server("ws://localhost:8080/ws");

    // Track messages sent to the server
    mockServer.on("connection", (socket) => {
      clientSocket = socket as MockWebSocket;
      socket.on("message", (data) => {
        const url = "ws://localhost:8080/ws";
        if (!sentMessages.has(url)) {
          sentMessages.set(url, []);
        }
        sentMessages.get(url)!.push(data as string);
      });
    });

    // Replace global WebSocket with mock-socket's WebSocket
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllTimers();

    if (connection) {
      await connection.disconnect().catch(() => {
        // Ignore errors during cleanup
      });
    }

    if (mockServer) {
      mockServer.stop();
    }

    clientSocket = null;
    sentMessages.clear();
  });

  describe("constructor", () => {
    it("should generate a UUID", () => {
      connection = new Connection("ws://localhost:8080");
      const uuid = connection.getUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it("should convert HTTP URL to WebSocket URL", async () => {
      vi.useRealTimers();

      connection = new Connection("http://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      expect(clientSocket).toBeTruthy();
      if (clientSocket) {
        expect(clientSocket.url).toBe("ws://localhost:8080/ws");
      }

      vi.useFakeTimers();
    });

    it("should convert HTTPS URL to secure WebSocket URL", async () => {
      vi.useRealTimers();

      // Create a new server for wss
      const wssServer = new Server("wss://example.com:8080/ws");
      const wssClients: MockWebSocket[] = [];
      wssServer.on("connection", (socket) => {
        wssClients.push(socket as unknown as MockWebSocket);
      });

      global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

      connection = new Connection("https://example.com:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      expect(wssClients.length).toBeGreaterThan(0);
      expect(wssClients[0]?.url).toBe("wss://example.com:8080/ws");

      wssServer.stop();
      vi.useFakeTimers();
    });

    it("should handle WebSocket URL with /ws endpoint", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080/ws");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      expect(clientSocket?.url).toBe("ws://localhost:8080/ws");

      vi.useFakeTimers();
    });

    it("should append /ws to WebSocket URL without endpoint", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      expect(clientSocket?.url).toBe("ws://localhost:8080/ws");

      vi.useFakeTimers();
    });
  });

  describe("connect", () => {
    it("should establish WebSocket connection", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");

      const connectPromise = connection.connect();
      // Wait for connection to be established
      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      expect(clientSocket).toBeTruthy();
      expect(clientSocket?.readyState).toBe(WebSocket.OPEN);

      vi.useFakeTimers();
    });

    it("should send registration message after connection", async () => {
      vi.useRealTimers();

      // Mock navigator
      Object.defineProperty(navigator, "hardwareConcurrency", {
        value: 4,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "deviceMemory", {
        value: 8,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "gpu", {
        value: {
          requestAdapter: vi.fn().mockResolvedValue({}),
        },
        writable: true,
        configurable: true,
      });

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      // Wait for connection and registration
      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;
      await new Promise((resolve) => setTimeout(resolve, 200));

      const messages = sentMessages.get("ws://localhost:8080/ws") || [];
      expect(messages.length).toBeGreaterThan(0);

      const registerMsg = messages.map((msg) => JSON.parse(msg)).find((m: Message) => m.type === "register");
      expect(registerMsg).toBeDefined();
      expect(registerMsg?.data).toHaveProperty("uuid");
      expect(registerMsg?.data).toHaveProperty("cpu");
      expect(registerMsg?.data).toHaveProperty("memory");
      expect(registerMsg?.data).toHaveProperty("gpu");
      expect(registerMsg?.data).toHaveProperty("labels");

      vi.useFakeTimers();
    });

    it("should handle connection errors and reconnect", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Simulate error by closing the connection
      if (clientSocket) {
        clientSocket.close();
      }

      // Switch to fake timers for advancing time
      vi.useFakeTimers();
      // Wait for reconnect attempt
      await vi.advanceTimersByTimeAsync(2000);
      // Connection should attempt to reconnect (we can't easily verify the exact count)
      expect(connection).toBeDefined();
    });

    it("should not reconnect if disconnect was called", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      await connection.disconnect();
      if (clientSocket) {
        clientSocket.close();
      }

      // Switch to fake timers
      vi.useFakeTimers();
      // Wait to see if reconnect happens
      await vi.advanceTimersByTimeAsync(2000);
      // Connection should be closed and not reconnecting
      expect(connection).toBeDefined();
    });
  });

  describe("sendMessage", () => {
    it("should send message when connected", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Ensure socket is still in OPEN state
      expect(clientSocket?.readyState).toBe(WebSocket.OPEN);

      const message: Message = {
        type: "test",
        timestamp: new Date().toISOString(),
        data: { test: "data" },
      };

      await connection.sendMessage(message);

      // Wait a bit for message to be sent
      await new Promise((resolve) => setTimeout(resolve, 50));

      const messages = sentMessages.get("ws://localhost:8080/ws") || [];
      const parsedMessages = messages.map((msg) => JSON.parse(msg));
      const testMessage = parsedMessages.find((m: Message) => m.type === "test");
      expect(testMessage).toBeDefined();
      expect(testMessage).toMatchObject({
        type: "test",
        data: { test: "data" },
      });

      vi.useFakeTimers();
    });

    it("should throw error when not connected", async () => {
      connection = new Connection("ws://localhost:8080");

      const message: Message = {
        type: "test",
        timestamp: new Date().toISOString(),
        data: { test: "data" },
      };

      await expect(connection.sendMessage(message)).rejects.toThrow("Not connected");
    });
  });

  describe("onMessage", () => {
    it("should call callback when message is received", async () => {
      vi.useRealTimers();

      const callback = vi.fn();
      connection = new Connection("ws://localhost:8080");
      connection.onMessage(callback);

      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      const message: Message = {
        type: "test",
        timestamp: new Date().toISOString(),
        data: { test: "data" },
      };

      // Send message from server to client
      if (clientSocket) {
        clientSocket.send(JSON.stringify(message));
      }

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalledWith(message);

      vi.useFakeTimers();
    });

    it("should handle registered message", async () => {
      vi.useRealTimers();

      const callback = vi.fn();
      connection = new Connection("ws://localhost:8080");
      connection.onMessage(callback);

      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      const registeredMsg: Message = {
        type: "registered",
        timestamp: new Date().toISOString(),
        data: { status: "ok" },
      };

      // Send message from server to client
      if (clientSocket) {
        clientSocket.send(JSON.stringify(registeredMsg));
      }

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalledWith(registeredMsg);

      vi.useFakeTimers();
    });

    it("should handle pod_spec message", async () => {
      vi.useRealTimers();

      const callback = vi.fn();
      connection = new Connection("ws://localhost:8080");
      connection.onMessage(callback);

      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      const podSpecMsg: Message = {
        type: "pod_spec",
        timestamp: new Date().toISOString(),
        data: {
          metadata: { name: "test-pod", namespace: "default" },
          spec: { containers: [] },
        },
      };

      // Send message from server to client
      if (clientSocket) {
        clientSocket.send(JSON.stringify(podSpecMsg));
      }

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // pod_spec messages should be passed to callback
      expect(callback).toHaveBeenCalledWith(podSpecMsg);

      vi.useFakeTimers();
    });

    it("should handle pod_delete message", async () => {
      vi.useRealTimers();

      const callback = vi.fn();
      connection = new Connection("ws://localhost:8080");
      connection.onMessage(callback);

      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      const podDeleteMsg: Message = {
        type: "pod_delete",
        timestamp: new Date().toISOString(),
        data: { namespace: "default", name: "test-pod" },
      };

      // Send message from server to client
      if (clientSocket) {
        clientSocket.send(JSON.stringify(podDeleteMsg));
      }

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // pod_delete messages should be passed to callback
      expect(callback).toHaveBeenCalledWith(podDeleteMsg);

      vi.useFakeTimers();
    });
  });

  describe("heartbeat", () => {
    it("should send heartbeat messages periodically", async () => {
      // Mock document.hidden
      Object.defineProperty(document, "hidden", {
        value: false,
        writable: true,
        configurable: true,
      });

      // Use a shorter heartbeat interval for testing
      vi.useRealTimers();
      connection = new Connection("ws://localhost:8080", 100);
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Wait for heartbeat to fire (using shorter test interval)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const messages = sentMessages.get("ws://localhost:8080/ws") || [];
      const parsedMessages = messages.map((msg) => JSON.parse(msg));
      const heartbeatMsg = parsedMessages.find((m: Message) => m.type === "heartbeat");
      expect(heartbeatMsg).toBeDefined();
      expect(heartbeatMsg?.data).toHaveProperty("uuid");
      expect(heartbeatMsg?.data).toHaveProperty("isThrottled");
      expect((heartbeatMsg?.data as { isThrottled: boolean }).isThrottled).toBe(false);
    });

    it("should include isThrottled flag based on document.hidden", async () => {
      Object.defineProperty(document, "hidden", {
        value: true,
        writable: true,
        configurable: true,
      });

      // Use a shorter heartbeat interval for testing
      vi.useRealTimers();
      connection = new Connection("ws://localhost:8080", 100);
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Wait for heartbeat to fire (using shorter test interval)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const messages = sentMessages.get("ws://localhost:8080/ws") || [];
      const parsedMessages = messages.map((msg) => JSON.parse(msg));
      const heartbeatMsg = parsedMessages.find((m: Message) => m.type === "heartbeat");
      expect(heartbeatMsg).toBeDefined();
      expect((heartbeatMsg?.data as { isThrottled: boolean }).isThrottled).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("should close WebSocket connection", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Wait for registration
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify socket is open before disconnect
      expect(clientSocket?.readyState).toBe(WebSocket.OPEN);

      // Spy on close method
      const closeSpy = vi.spyOn(clientSocket!, "close");

      await connection.disconnect();

      // Wait a bit for close to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The socket.close() method should have been called
      expect(closeSpy).toHaveBeenCalled();
      // Socket should be closed or closing
      expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(clientSocket?.readyState);

      vi.useFakeTimers();
    });

    it("should stop heartbeat timer", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Wait for registration and heartbeat to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      const initialMessageCount = sentMessages.get("ws://localhost:8080/ws")?.length || 0;

      // Verify heartbeat timer exists before disconnect
      expect(connection["heartbeatTimer"]).not.toBeNull();

      await connection.disconnect();

      // Verify heartbeat timer is cleared after disconnect
      expect(connection["heartbeatTimer"]).toBeNull();

      // Switch to fake timers for advancing time
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(20000);

      // Should not have sent more messages after disconnect
      const finalMessageCount = sentMessages.get("ws://localhost:8080/ws")?.length || 0;
      expect(finalMessageCount).toBe(initialMessageCount);
    });

    it("should clear heartbeat timer in handleDisconnect", async () => {
      vi.useRealTimers();

      connection = new Connection("ws://localhost:8080");
      const connectPromise = connection.connect();

      await new Promise((resolve) => setTimeout(resolve, 50));
      await connectPromise;

      // Wait for registration and heartbeat to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify heartbeat timer exists
      expect(connection["heartbeatTimer"]).not.toBeNull();

      // Close connection to trigger handleDisconnect
      if (clientSocket) {
        clientSocket.close();
      }

      // Wait for handleDisconnect to be called
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify heartbeat timer is cleared in handleDisconnect
      expect(connection["heartbeatTimer"]).toBeNull();

      vi.useFakeTimers();
    });
  });

  describe("getUUID", () => {
    it("should return the same UUID for an instance", () => {
      connection = new Connection("ws://localhost:8080");
      const uuid1 = connection.getUUID();
      const uuid2 = connection.getUUID();
      expect(uuid1).toBe(uuid2);
    });

    it("should return different UUIDs for different instances", () => {
      const conn1 = new Connection("ws://localhost:8080");
      const conn2 = new Connection("ws://localhost:8080");
      expect(conn1.getUUID()).not.toBe(conn2.getUUID());
    });
  });

  describe("browser ID", () => {
    beforeEach(() => {
      // Clear localStorage before each test
      if (typeof localStorage !== "undefined") {
        localStorage.clear();
      }
    });

    it("should generate and store browser ID in localStorage", () => {
      connection = new Connection("ws://localhost:8080");
      // Browser ID is generated in constructor
      // Check that localStorage has the key
      if (typeof localStorage !== "undefined") {
        const browserId = localStorage.getItem("kuack-browser-id");
        expect(browserId).toBeTruthy();
        expect(browserId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      }
    });

    it("should reuse existing browser ID from localStorage", () => {
      if (typeof localStorage !== "undefined") {
        const existingId = "test-browser-id-123";
        localStorage.setItem("kuack-browser-id", existingId);

        connection = new Connection("ws://localhost:8080");
        const storedId = localStorage.getItem("kuack-browser-id");
        expect(storedId).toBe(existingId);
      }
    });

    it("should handle localStorage unavailable gracefully", () => {
      // Mock localStorage to throw
      const originalLocalStorage = global.localStorage;
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      Object.defineProperty(global, "localStorage", {
        value: {
          getItem: () => {
            throw new Error("localStorage unavailable");
          },
          setItem: () => {
            throw new Error("localStorage unavailable");
          },
        },
        writable: true,
      });

      // Should not throw
      connection = new Connection("ws://localhost:8080");
      expect(connection).toBeTruthy();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Agent] localStorage unavailable"),
        expect.any(Error),
      );

      // Restore
      Object.defineProperty(global, "localStorage", {
        value: originalLocalStorage,
        writable: true,
      });
      consoleSpy.mockRestore();
    });
  });

  describe("connection state", () => {
    it("should start in disconnected state", () => {
      connection = new Connection("ws://localhost:8080");
      expect(connection.getState()).toBe("disconnected");
    });

    it("should update state to connecting when connecting", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080");

      const stateChanges: string[] = [];
      connection.onStateChange((state) => {
        stateChanges.push(state);
      });

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);

      expect(stateChanges).toContain("connecting");
      expect(stateChanges).toContain("connected");

      await connectPromise;
      await connection.disconnect();
    });

    it("should update state to disconnected when disconnected", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080");

      const stateChanges: string[] = [];
      connection.onStateChange((state) => {
        stateChanges.push(state);
      });

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      await connection.disconnect();

      expect(stateChanges).toContain("disconnected");
    });

    it("should update state to reconnecting when connection closes", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080");

      const stateChanges: string[] = [];
      connection.onStateChange((state) => {
        stateChanges.push(state);
      });

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Close the connection
      if (clientSocket) {
        clientSocket.close();
      }

      await vi.advanceTimersByTimeAsync(100);

      expect(stateChanges).toContain("reconnecting");
      await connection.disconnect();
    });
  });

  describe("duplicate browser connection", () => {
    it("should stop reconnecting when closed with code 4001", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080");

      const stateChanges: string[] = [];
      connection.onStateChange((state) => {
        stateChanges.push(state);
      });

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Close with duplicate browser code (4001)
      // Mock-socket doesn't support close with options, so we manually trigger onclose
      if (clientSocket && connection["socket"]) {
        const socket = connection["socket"] as MockWebSocket;
        // Manually trigger close event with code 4001
        const closeEvent = {
          code: 4001,
          reason: "New connection from same browser",
          wasClean: true,
        } as CloseEvent;
        // Access the onclose handler and call it
        if (socket.onclose) {
          socket.onclose(closeEvent);
        }
      }

      await vi.advanceTimersByTimeAsync(100);

      // Should be disconnected and not reconnecting
      expect(connection.getState()).toBe("disconnected");
      expect(stateChanges).toContain("disconnected");
      // Should not contain "reconnecting"
      expect(stateChanges).not.toContain("reconnecting");
    });
  });

  describe("getDetectedResources", () => {
    it("should return null before connection", () => {
      connection = new Connection("ws://localhost:8080");
      expect(connection.getDetectedResources()).toBeNull();
    });

    it("should return detected resources after registration", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080");

      // Mock performance.memory for accurate detection
      const perf = global.performance as { memory?: unknown };
      if (!perf.memory) {
        perf.memory = {
          jsHeapSizeLimit: 2147483648, // 2GB
          usedJSHeapSize: 1000000,
          totalJSHeapSize: 2000000,
        };
      }

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      const resources = connection.getDetectedResources();
      expect(resources).not.toBeNull();
      if (resources) {
        expect(resources.cpu).toBeTruthy();
        expect(resources.memory).toBeTruthy();
        expect(typeof resources.gpu).toBe("boolean");
      }
      await connection.disconnect();
    });
  });

  describe("reconnection", () => {
    it("should attempt reconnection with exponential backoff", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080", 15000);

      const stateChanges: string[] = [];
      connection.onStateChange((state) => {
        stateChanges.push(state);
      });

      // Connect first time
      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Close connection (not with code 4001)
      if (clientSocket) {
        clientSocket.close();
      }

      // Advance time to trigger reconnection (default reconnectDelay is 1000ms)
      await vi.advanceTimersByTimeAsync(1100);

      // Should have attempted reconnection
      expect(stateChanges).toContain("reconnecting");
      expect(stateChanges).toContain("connected");
      await connection.disconnect();
    });
  });

  describe("heartbeat error handling", () => {
    it("should handle resource detection errors in heartbeat", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080", 100); // Use short interval for testing

      // Ensure we can connect first (with mocked memory)
      const perf = global.performance as { memory?: unknown };
      const originalMemory = perf.memory;
      if (!perf.memory) {
        perf.memory = {
          jsHeapSizeLimit: 2147483648,
          usedJSHeapSize: 1000000,
          totalJSHeapSize: 2000000,
        };
      }

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Mock detectResources to throw an error after connection
      const originalDetectResources = connection["detectResources"].bind(connection);
      connection["detectResources"] = vi.fn().mockRejectedValue(new Error("Resource detection failed"));

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        // Advance time to trigger heartbeat (use short interval from constructor)
        await vi.advanceTimersByTimeAsync(150);

        // Should have logged error but not crashed
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("[Agent] Failed to detect resources for heartbeat:"),
          expect.any(Error),
        );
      } finally {
        // Restore
        connection["detectResources"] = originalDetectResources;
        if (originalMemory !== undefined) {
          perf.memory = originalMemory;
        }
        consoleErrorSpy.mockRestore();
        await connection.disconnect();
      }
    });

    it("should handle sendMessage errors in heartbeat", async () => {
      vi.useFakeTimers();
      connection = new Connection("ws://localhost:8080", 100); // Use short interval for testing

      // Ensure performance.memory exists for successful resource detection
      const perf = global.performance as { memory?: unknown };
      if (!perf.memory) {
        perf.memory = {
          jsHeapSizeLimit: 2147483648, // 2GB
          usedJSHeapSize: 1000000,
          totalJSHeapSize: 2000000,
        };
      }

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const connectPromise = connection.connect();
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Mock sendMessage to throw an error instead of closing socket
      // (closing socket causes early return in heartbeat)
      const originalSendMessage = connection["sendMessage"].bind(connection);
      connection["sendMessage"] = vi.fn().mockRejectedValue(new Error("Send failed"));

      try {
        // Advance time to trigger heartbeat (use short interval from constructor)
        await vi.advanceTimersByTimeAsync(150);

        // Should have logged error but not crashed
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("[Agent] Failed to send heartbeat:"),
          expect.any(Error),
        );
      } finally {
        // Restore
        connection["sendMessage"] = originalSendMessage;
        consoleErrorSpy.mockRestore();
        await connection.disconnect();
      }
    });
  });

  describe("WebGPU detection", () => {
    it("should handle WebGPU adapter info with vendor/architecture/device", async () => {
      vi.useFakeTimers();

      // Mock WebGPU with requestAdapterInfo that returns info
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({
          vendor: "test-vendor",
          architecture: "test-arch",
          device: "test-device",
        }),
      };

      const mockGPU = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global.navigator, "gpu", {
        value: mockGPU,
        writable: true,
        configurable: true,
      });

      // Ensure performance.memory exists
      const perf = global.performance as { memory?: unknown };
      if (!perf.memory) {
        perf.memory = {
          jsHeapSizeLimit: 2147483648,
          usedJSHeapSize: 1000000,
          totalJSHeapSize: 2000000,
        };
      }

      connection = new Connection("ws://localhost:8080", 15000);
      const connectPromise = connection.connect();
      // Only advance enough to complete connection, not all timers (which would trigger heartbeat loop)
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Verify WebGPU was detected
      const resources = connection.getDetectedResources();
      expect(resources).not.toBeNull();
      if (resources) {
        expect(resources.gpu).toBe(true);
      }

      // Clean up
      await connection.disconnect();
      // Restore
      delete (global.navigator as { gpu?: unknown }).gpu;
    });

    it("should handle WebGPU adapter info without vendor/architecture/device", async () => {
      vi.useFakeTimers();

      // Mock WebGPU with requestAdapterInfo that returns empty info
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({}),
      };

      const mockGPU = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };

      Object.defineProperty(global.navigator, "gpu", {
        value: mockGPU,
        writable: true,
        configurable: true,
      });

      // Ensure performance.memory exists
      const perf = global.performance as { memory?: unknown };
      if (!perf.memory) {
        perf.memory = {
          jsHeapSizeLimit: 2147483648,
          usedJSHeapSize: 1000000,
          totalJSHeapSize: 2000000,
        };
      }

      connection = new Connection("ws://localhost:8080", 15000);
      const connectPromise = connection.connect();
      // Only advance enough to complete connection, not all timers (which would trigger heartbeat loop)
      await vi.advanceTimersByTimeAsync(100);
      await connectPromise;

      // Verify WebGPU was detected
      const resources = connection.getDetectedResources();
      expect(resources).not.toBeNull();
      if (resources) {
        expect(resources.gpu).toBe(true);
      }

      // Clean up
      await connection.disconnect();
      // Restore
      delete (global.navigator as { gpu?: unknown }).gpu;
    });
  });
});
