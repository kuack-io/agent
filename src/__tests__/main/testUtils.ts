import type { Message } from "../../connection";
import Agent from "../../main";
import type { PodSpec } from "../../runtime";
import { vi } from "vitest";

export const SERVER_URL = "ws://localhost:8080";
export const REGISTRY_URL = "http://localhost:8080/registry";
export const TOKEN = "test-token";

type MockFn = ReturnType<typeof vi.fn>;

export type MockConnection = {
  connect: MockFn;
  disconnect: MockFn;
  sendMessage: MockFn;
  onMessage: MockFn;
  onStateChange: MockFn;
  getUUID: MockFn;
  getState: MockFn;
  getDetectedResources: MockFn;
  detectResources: MockFn;
};

export type MockRuntime = {
  executePod: MockFn;
  deletePod: MockFn;
  getRunningPodCount: MockFn;
  getExecutedPodCount: MockFn;
};

function createMockConnection(): MockConnection {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    onStateChange: vi.fn(),
    getUUID: vi.fn().mockReturnValue("test-uuid-123"),
    getState: vi.fn().mockReturnValue("disconnected"),
    getDetectedResources: vi.fn().mockReturnValue(null),
    detectResources: vi.fn().mockResolvedValue(undefined), // Defaults to resolving
  };
}

function createMockRuntime(): MockRuntime {
  return {
    executePod: vi.fn().mockResolvedValue(undefined),
    deletePod: vi.fn().mockResolvedValue(undefined),
    getRunningPodCount: vi.fn().mockReturnValue(0),
    getExecutedPodCount: vi.fn().mockReturnValue(0),
  };
}

const { connectionConstructorMock, runtimeConstructorMock } = vi.hoisted(() => ({
  connectionConstructorMock: vi.fn(function mockConnectionConstructor() {
    return createMockConnection();
  }),
  runtimeConstructorMock: vi.fn(function mockRuntimeConstructor() {
    return createMockRuntime();
  }),
}));

vi.mock("../../connection", () => ({
  Connection: connectionConstructorMock,
  default: connectionConstructorMock,
}));

vi.mock("../../runtime", () => ({
  Runtime: runtimeConstructorMock,
  default: runtimeConstructorMock,
}));

export const ConnectionConstructorMock = connectionConstructorMock;
export const RuntimeConstructorMock = runtimeConstructorMock;

export type AgentHarness = {
  agent: Agent;
  mockConnection: MockConnection;
  mockWorker: {
    postMessage: MockFn;
    terminate: MockFn;
    onmessage: ((e: MessageEvent) => void) | null;
  };
  dispatchMessage: (message: Message) => Promise<void>;
  dispatchWorkerMessage: (data: unknown) => void;
};

export const createAgentHarness = (): AgentHarness => {
  vi.clearAllMocks();

  // Mock Worker
  const mockWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  global.Worker = vi.fn(function () {
    return mockWorker;
  }) as unknown as typeof Worker;

  const agent = new Agent(SERVER_URL, TOKEN, REGISTRY_URL);
  const mockConnection = agent["connection"] as unknown as MockConnection;

  const dispatchMessage = async (message: Message) => {
    const handler = mockConnection.onMessage.mock.calls[0]?.[0];
    if (!handler) {
      throw new Error("Message handler not registered");
    }
    await handler(message);
  };

  const dispatchWorkerMessage = (data: unknown) => {
    if (mockWorker.onmessage) {
      mockWorker.onmessage({ data } as MessageEvent);
    }
  };

  return {
    agent,
    mockConnection,
    mockWorker,
    dispatchMessage,
    dispatchWorkerMessage,
  };
};

export const createPodSpec = (overrides?: Partial<PodSpec>): PodSpec => ({
  metadata: {
    name: "test-pod",
    namespace: "default",
    ...(overrides?.metadata ?? {}),
  },
  spec: {
    containers: overrides?.spec?.containers ?? [
      {
        name: "test-container",
        image: "test-image:latest",
      },
    ],
    ...(overrides?.spec ?? {}),
  },
});

export const createAgentMessage = <T extends Message["data"]>(type: Message["type"], data: T): Message => ({
  type,
  timestamp: new Date().toISOString(),
  data,
});
