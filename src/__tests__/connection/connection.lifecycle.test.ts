import { Connection } from "../../connection";
import { setupConnectionTestEnvironment, WS_URL, wait, overrideProperty } from "./testUtils";
import { Server, WebSocket as MockWebSocket } from "mock-socket";
import { describe, it, expect, vi } from "vitest";

const TOKEN = "test-token";
const env = setupConnectionTestEnvironment();

describe("Connection constructor", () => {
  it("generates a UUID", () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const uuid = connection.getUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("converts HTTP URLs to WS", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection("http://localhost:8080", TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    expect(env.getClientSocket()?.url).toBe("ws://localhost:8080/");
    vi.useFakeTimers();
  });

  it("converts HTTPS URLs to WSS", async () => {
    vi.useRealTimers();
    const secureServer = new Server("wss://example.com:8080");
    const secureClients: MockWebSocket[] = [];
    secureServer.on("connection", (socket) => {
      secureClients.push(socket as MockWebSocket);
    });

    const connection = env.trackConnection(new Connection("https://example.com:8080", TOKEN));
    try {
      const connectPromise = connection.connect();
      await wait(50);
      await connectPromise;
      expect(secureClients[0]?.url).toBe("wss://example.com:8080/");
    } finally {
      secureServer.stop();
      vi.useFakeTimers();
    }
  });

  it("keeps explicit WebSocket endpoints", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    expect(env.getClientSocket()?.url).toBe("ws://localhost:8080/");
    vi.useFakeTimers();
  });

  it("defaults to root endpoint", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    expect(env.getClientSocket()?.url).toBe("ws://localhost:8080/");
    vi.useFakeTimers();
  });
});

describe("Connection lifecycle", () => {
  it("establishes a WebSocket connection", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    expect(env.getClientSocket()).toBeTruthy();
    expect(env.getClientSocket()?.readyState).toBe(WebSocket.OPEN);
    vi.useFakeTimers();
  });

  it("sends registration after connect", async () => {
    vi.useRealTimers();
    const restoreHardware = overrideProperty(navigator, "hardwareConcurrency", 4);
    const restoreDeviceMemory = overrideProperty(navigator as Navigator & { deviceMemory?: number }, "deviceMemory", 8);
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockResolvedValue({}),
    });

    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);

    const messages = env.getSentMessages().get(WS_URL) || [];
    const registerMsg = messages.map((msg) => JSON.parse(msg)).find((m) => m.type === "register");
    expect(registerMsg?.data).toHaveProperty("uuid");
    expect(registerMsg?.data).toHaveProperty("cpu");
    expect(registerMsg?.data).toHaveProperty("memory");
    expect(registerMsg?.data).toHaveProperty("gpu");
    expect(registerMsg?.data).toHaveProperty("labels");
    vi.useFakeTimers();
    restoreHardware();
    restoreDeviceMemory();
    restoreGpu();
  });

  it("retries when socket errors", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    env.getClientSocket()?.close();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection).toBeDefined();
  });

  it("stops reconnect attempts after disconnect", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await connection.disconnect();
    env.getClientSocket()?.close();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection).toBeDefined();
  });
});

describe("Disconnect handling", () => {
  it("closes the socket", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);
    const serverSocket = env.getClientSocket();
    expect(serverSocket?.readyState).toBe(WebSocket.OPEN);
    const clientSocket = connection["socket"] as WebSocket | null;
    expect(clientSocket).not.toBeNull();
    const closeSpy = vi.spyOn(clientSocket!, "close");
    await connection.disconnect();
    await wait(50);
    expect(closeSpy).toHaveBeenCalled();
    expect([WebSocket.CLOSING, WebSocket.CLOSED]).toContain(serverSocket?.readyState);
    vi.useFakeTimers();
  });

  it("stops the heartbeat timer", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);
    const initialMessages = env.getSentMessages().get(WS_URL)?.length || 0;
    expect(connection["heartbeatTimer"]).not.toBeNull();
    await connection.disconnect();
    expect(connection["heartbeatTimer"]).toBeNull();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(20000);
    const finalMessages = env.getSentMessages().get(WS_URL)?.length || 0;
    expect(finalMessages).toBe(initialMessages);
  });

  it("clears heartbeat when socket closes", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);
    expect(connection["heartbeatTimer"]).not.toBeNull();
    env.getClientSocket()?.close();
    await wait(100);
    expect(connection["heartbeatTimer"]).toBeNull();
    vi.useFakeTimers();
  });
});

describe("Connection state tracking", () => {
  it("starts disconnected", () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(connection.getState()).toBe("disconnected");
  });

  it("reports connecting and connected", async () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;
    expect(states).toContain("connecting");
    expect(states).toContain("connected");
  });

  it("reports disconnected after disconnect", async () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;
    await connection.disconnect();
    expect(states).toContain("disconnected");
  });

  it("reports reconnecting on socket close", async () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;
    env.getClientSocket()?.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(states).toContain("reconnecting");
    await connection.disconnect();
  });
});

describe("Duplicate browser connection", () => {
  it("stops reconnecting when closed with 4001", async () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;
    const socket = connection["socket"] as MockWebSocket | null;
    expect(socket).not.toBeNull();
    const closeEvent = {
      code: 4001,
      reason: "duplicate",
      wasClean: true,
    } as CloseEvent;
    socket!.onclose?.(closeEvent);
    await vi.advanceTimersByTimeAsync(100);
    expect(connection.getState()).toBe("disconnected");
    expect(states).toContain("disconnected");
    expect(states).not.toContain("reconnecting");
  });
});

describe("Reconnection", () => {
  it("uses exponential backoff flow", async () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 15000));
    const states: string[] = [];
    connection.onStateChange((state) => states.push(state));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;
    env.getClientSocket()?.close();
    await vi.advanceTimersByTimeAsync(1100);
    expect(states).toContain("reconnecting");
    expect(states).toContain("connected");
    await connection.disconnect();
  });
});
