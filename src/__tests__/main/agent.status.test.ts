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
    harness.dispatchWorkerMessage({
      type: "status_update",
      payload: {
        runningPods: 3,
        executedPods: 0,
      },
    });
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
describe("Agent internal logic coverage", () => {
  it("logs when worker is initialized", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    harness.dispatchWorkerMessage({ type: "initialized" });
    expect(consoleSpy).toHaveBeenCalledWith("[Agent] Worker initialized");
    consoleSpy.mockRestore();
  });

  it("handles resource detection failures silently", async () => {
    vi.useFakeTimers();
    harness.mockConnection.detectResources.mockRejectedValue(new Error("Detection failed"));

    // Start agent to trigger interval
    await harness.agent.start();

    // Advance time to trigger interval
    await vi.advanceTimersByTimeAsync(5000);

    // Should have called detectResources
    expect(harness.mockConnection.detectResources).toHaveBeenCalled();

    // Clean up
    await harness.agent.stop();
    vi.useRealTimers();
  });

  it("clears resource interval on stop", async () => {
    vi.useFakeTimers();
    await harness.agent.start();

    // Stop should clear interval
    await harness.agent.stop();

    // Advance time - detectResources should NOT be called again
    harness.mockConnection.detectResources.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.mockConnection.detectResources).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
