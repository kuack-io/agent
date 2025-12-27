import {
  createAgentHarness,
  ConnectionConstructorMock,
  RuntimeConstructorMock,
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
    expect(RuntimeConstructorMock).toHaveBeenCalledWith(REGISTRY_URL, TOKEN);
    expect(harness.mockConnection.onMessage).toHaveBeenCalled();
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
