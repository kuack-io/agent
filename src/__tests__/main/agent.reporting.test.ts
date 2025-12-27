import { createAgentHarness, createAgentMessage, createPodSpec, type AgentHarness } from "./testUtils";
import { describe, it, expect, beforeEach, vi } from "vitest";

let harness: AgentHarness;

beforeEach(() => {
  harness = createAgentHarness();
});

describe("Agent pod status reporting", () => {
  it("sends pod status when runtime reports", async () => {
    const podSpec = createPodSpec();
    const status = {
      phase: "Running" as const,
      message: "Pod is running",
    };

    harness.mockRuntime.executePod.mockImplementation(async (_spec, onStatus) => {
      onStatus(status);
    });

    await harness.dispatchMessage(createAgentMessage("pod_spec", podSpec));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(harness.mockConnection.sendMessage).toHaveBeenCalledWith(
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

  it("logs when pod status reporting fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const podSpec = createPodSpec();
    harness.mockConnection.sendMessage.mockRejectedValueOnce(new Error("Connection error"));

    harness.mockRuntime.executePod.mockImplementation(async (_spec, onStatus) => {
      onStatus({
        phase: "Running" as const,
        message: "Pod is running",
      });
    });

    await harness.dispatchMessage(createAgentMessage("pod_spec", podSpec));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Agent] Failed to report pod status:"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});

describe("Agent pod log reporting", () => {
  it("forwards pod logs when available", async () => {
    const podSpec = createPodSpec();

    harness.mockRuntime.executePod.mockImplementation(async (_spec, _onStatus, onLog) => {
      onLog("test log line");
    });

    await harness.dispatchMessage(createAgentMessage("pod_spec", podSpec));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(harness.mockRuntime.executePod).toHaveBeenCalled();
  });

  it("logs when reporting pod logs fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const podSpec = createPodSpec();

    harness.mockConnection.sendMessage.mockRejectedValueOnce(new Error("Connection error"));
    harness.mockRuntime.executePod.mockImplementation(async (_spec, _onStatus, onLog) => {
      onLog("test log line");
    });

    await harness.dispatchMessage(createAgentMessage("pod_spec", podSpec));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Agent] Failed to report pod log:"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
