import type { Connection } from "../../connection";
import { Server, WebSocket as MockWebSocket } from "mock-socket";
import { beforeEach, afterEach, vi } from "vitest";

export const WS_URL = "ws://localhost:8080";
const sentMessageKey = WS_URL;
const restoreFns: Array<() => void> = [];

export interface ConnectionTestEnvironment {
  trackConnection<T extends Connection>(connection: T): T;
  getMockServer(): Server;
  getClientSocket(): MockWebSocket | null;
  getSentMessages(): Map<string, string[]>;
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function overrideProperty<T extends object, K extends keyof T>(target: T, prop: K, value: T[K] | undefined) {
  const descriptor = Object.getOwnPropertyDescriptor(target, prop as unknown as PropertyKey);
  Object.defineProperty(target, prop as unknown as PropertyKey, {
    value,
    configurable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(target, prop as unknown as PropertyKey, descriptor);
    } else {
      delete (target as Record<PropertyKey, unknown>)[prop as unknown as PropertyKey];
    }
  };
}

export function setupConnectionTestEnvironment(): ConnectionTestEnvironment {
  const sentMessages = new Map<string, string[]>();
  let mockServer: Server;
  let clientSocket: MockWebSocket | null = null;
  const connections = new Set<Connection>();

  beforeEach(() => {
    vi.useFakeTimers();
    clientSocket = null;
    sentMessages.clear();

    const restoreHardware = overrideProperty(navigator, "hardwareConcurrency", 4);
    const restoreDeviceMemory = overrideProperty(navigator as Navigator & { deviceMemory?: number }, "deviceMemory", 8);
    const restoreHidden = overrideProperty(document as Document & { hidden?: boolean }, "hidden", false);
    const restoreGpu = overrideProperty(navigator as Navigator & { gpu?: unknown }, "gpu", {
      requestAdapter: vi.fn().mockResolvedValue({
        requestAdapterInfo: vi.fn().mockResolvedValue(null),
      }),
    });
    restoreFns.push(restoreHardware, restoreDeviceMemory, restoreHidden, restoreGpu);

    mockServer = new Server(WS_URL);
    mockServer.on("connection", (socket) => {
      clientSocket = socket as MockWebSocket;
      socket.on("message", (data) => {
        if (!sentMessages.has(sentMessageKey)) {
          sentMessages.set(sentMessageKey, []);
        }
        sentMessages.get(sentMessageKey)!.push(data as string);
      });
    });

    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllTimers();

    while (restoreFns.length) {
      const restore = restoreFns.pop();
      restore?.();
    }

    for (const connection of connections) {
      await connection.disconnect().catch(() => {
        // Ignore disconnect errors in cleanup
      });
    }
    connections.clear();

    if (mockServer) {
      mockServer.stop();
    }
    clientSocket = null;
    sentMessages.clear();
  });

  return {
    trackConnection: <T extends Connection>(connection: T): T => {
      connections.add(connection);
      return connection;
    },
    getMockServer: () => mockServer,
    getClientSocket: () => clientSocket,
    getSentMessages: () => sentMessages,
  };
}
