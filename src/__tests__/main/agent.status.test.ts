import { createAgentHarness, type AgentHarness } from "./testUtils";
import { describe, it, expect, beforeEach, vi } from "vitest";

let harness: AgentHarness;

beforeEach(() => {
  harness = createAgentHarness();
});

describe("Agent status", () => {
  it("returns the default status snapshot", () => {
    expect(harness.agent.getStatus()).toEqual({
      uuid: "test-uuid-123",
      runningPods: 0,
      executedPods: 0,
      state: "disconnected",
      cpu: null,
      memory: null,
      gpu: null,
    });
  });

  it("reflects the running pod count", () => {
    harness.mockRuntime.getRunningPodCount.mockReturnValue(3);
    expect(harness.agent.getStatus().runningPods).toBe(3);
  });

  it("reports detected resources when available", () => {
    harness.mockConnection.getDetectedResources.mockReturnValue({
      cpu: "4000m",
      memory: "2.1Gi",
      gpu: false,
    });

    const status = harness.agent.getStatus();
    expect(status.cpu).toBe("4000m");
    expect(status.memory).toBe("2.1Gi");
    expect(status.gpu).toBe(false);
  });
});

describe("Agent state change subscription", () => {
  it("forwards connection state changes", () => {
    const callback = vi.fn();
    harness.agent.onStateChange(callback);

    const stateChange = harness.mockConnection.onStateChange.mock.calls[0]?.[0];
    expect(stateChange).toBeDefined();
    stateChange?.("connected");

    expect(callback).toHaveBeenCalledWith("connected");
  });
});
