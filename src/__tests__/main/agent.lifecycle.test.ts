import {
  createAgentHarness,
  ConnectionConstructorMock,
  SERVER_URL,
  REGISTRY_URL,
  TOKEN,
  type AgentHarness,
} from "./testUtils";
import { describe, it, expect, beforeEach } from "vitest";

let harness: AgentHarness;

beforeEach(() => {
  harness = createAgentHarness();
});

describe("Agent constructor", () => {
  it("creates connection and runtime dependencies", () => {
    expect(ConnectionConstructorMock).toHaveBeenCalledWith(SERVER_URL, TOKEN);
    expect(ConnectionConstructorMock).toHaveBeenCalledWith(SERVER_URL, TOKEN);
    expect(harness.mockWorker.postMessage).toHaveBeenCalledWith({
      type: "init",
      payload: { registryProxyUrl: REGISTRY_URL, token: TOKEN },
    });
    expect(harness.mockWorker.onmessage).toBeDefined();
  });
});

describe("Agent lifecycle", () => {
  it("connects to the server on start", async () => {
    await harness.agent.start();
    expect(harness.mockConnection.connect).toHaveBeenCalled();
  });

  it("disconnects from the server on stop", async () => {
    await harness.agent.stop();
    expect(harness.mockConnection.disconnect).toHaveBeenCalled();
  });
});
