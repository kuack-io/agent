import { Connection, type Message } from "../../connection";
import { setupConnectionTestEnvironment, WS_URL, wait, overrideProperty } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const TOKEN = "test-token";
const env = setupConnectionTestEnvironment();

describe("sendMessage", () => {
  it("sends messages when connected", async () => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);

    expect(env.getClientSocket()?.readyState).toBe(WebSocket.OPEN);

    const message: Message = {
      type: "test",
      timestamp: new Date().toISOString(),
      data: { test: "data" },
    };

    await connection.sendMessage(message);
    await wait(50);

    const messages = env.getSentMessages().get(WS_URL) || [];
    const parsed = messages.map((msg) => JSON.parse(msg));
    const sent = parsed.find((m: Message) => m.type === "test");
    expect(sent).toMatchObject({ type: "test", data: { test: "data" } });
    vi.useFakeTimers();
  });

  it("throws when socket is not connected", async () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const message: Message = {
      type: "test",
      timestamp: new Date().toISOString(),
      data: { test: "data" },
    };
    await expect(connection.sendMessage(message)).rejects.toThrow("Not connected");
  });
});

describe("onMessage", () => {
  const connectAndListen = async (callback: (message: Message) => void) => {
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    connection.onMessage(callback);
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    return { connection };
  };

  it("invokes callback for generic messages", async () => {
    const received = vi.fn();
    await connectAndListen(received);

    const payload: Message = {
      type: "test",
      timestamp: new Date().toISOString(),
      data: { hello: "world" },
    };

    env.getClientSocket()?.send(JSON.stringify(payload));
    await wait(50);
    expect(received).toHaveBeenCalledWith(payload);
    vi.useFakeTimers();
  });

  it("forwards registered events", async () => {
    const received = vi.fn();
    await connectAndListen(received);
    const payload: Message = {
      type: "registered",
      timestamp: new Date().toISOString(),
      data: { status: "ok" },
    };
    env.getClientSocket()?.send(JSON.stringify(payload));
    await wait(50);
    expect(received).toHaveBeenCalledWith(payload);
    vi.useFakeTimers();
  });

  it("forwards pod_spec events", async () => {
    const received = vi.fn();
    await connectAndListen(received);
    const payload: Message = {
      type: "pod_spec",
      timestamp: new Date().toISOString(),
      data: {
        metadata: { name: "test-pod", namespace: "default" },
        spec: { containers: [] },
      },
    };
    env.getClientSocket()?.send(JSON.stringify(payload));
    await wait(50);
    expect(received).toHaveBeenCalledWith(payload);
    vi.useFakeTimers();
  });

  it("forwards pod_delete events", async () => {
    const received = vi.fn();
    await connectAndListen(received);
    const payload: Message = {
      type: "pod_delete",
      timestamp: new Date().toISOString(),
      data: { namespace: "default", name: "test-pod" },
    };
    env.getClientSocket()?.send(JSON.stringify(payload));
    await wait(50);
    expect(received).toHaveBeenCalledWith(payload);
    vi.useFakeTimers();
  });
});

describe("heartbeat", () => {
  it("sends periodic heartbeat messages", async () => {
    const restoreHidden = overrideProperty(document as Document & { hidden?: boolean }, "hidden", false);
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 100));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);
    await wait(150);
    const messages = env.getSentMessages().get(WS_URL) || [];
    const heartbeat = messages.map((msg) => JSON.parse(msg)).find((m: Message) => m.type === "heartbeat");
    expect(heartbeat).toBeDefined();
    expect((heartbeat?.data as { isThrottled: boolean }).isThrottled).toBe(false);
    vi.useFakeTimers();
    restoreHidden();
  });

  it("marks throttled heartbeats when document is hidden", async () => {
    const restoreHidden = overrideProperty(document as Document & { hidden?: boolean }, "hidden", true);
    vi.useRealTimers();
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN, 100));
    const connectPromise = connection.connect();
    await wait(50);
    await connectPromise;
    await wait(200);
    await wait(150);
    const messages = env.getSentMessages().get(WS_URL) || [];
    const heartbeat = messages.map((msg) => JSON.parse(msg)).find((m: Message) => m.type === "heartbeat");
    expect(heartbeat).toBeDefined();
    expect((heartbeat?.data as { isThrottled: boolean }).isThrottled).toBe(true);
    vi.useFakeTimers();
    restoreHidden();
  });
});

describe("Unknown message handling", () => {
  it("logs a warning for unsupported types", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    const connectPromise = connection.connect();
    await vi.advanceTimersByTimeAsync(100);
    await connectPromise;

    env
      .getMockServer()
      .emit("message", JSON.stringify({ type: "unknown_type", timestamp: new Date().toISOString(), data: {} }));

    await vi.advanceTimersByTimeAsync(10);
    expect(consoleSpy).toHaveBeenCalledWith("[Agent] Unknown message type:", "unknown_type");
    consoleSpy.mockRestore();
    await connection.disconnect();
  });
});
