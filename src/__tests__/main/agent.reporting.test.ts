import { createAgentHarness, type AgentHarness } from "./testUtils";
import { describe, it, expect, beforeEach, vi } from "vitest";

let harness: AgentHarness;

beforeEach(() => {
  harness = createAgentHarness();
});

describe("Agent pod status reporting", () => {
  it("sends pod status when runtime reports", async () => {
    const status = {
      phase: "Running" as const,
      message: "Pod is running",
    };

    harness.dispatchWorkerMessage({
      type: "pod_status",
      payload: {
        namespace: "default",
        name: "test-pod",
        status,
      },
    });

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
    harness.mockConnection.sendMessage.mockRejectedValueOnce(new Error("Connection error"));

    harness.dispatchWorkerMessage({
      type: "pod_status",
      payload: {
        namespace: "default",
        name: "test-pod",
        status: { phase: "Running", message: "running" },
      },
    });

    // Wait for async handler
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
    harness.dispatchWorkerMessage({
      type: "pod_log",
      payload: {
        namespace: "default",
        name: "test-pod",
        log: "test log line",
      },
    });

    expect(harness.mockConnection.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pod_logs",
        data: expect.objectContaining({ log: "test log line" }),
      }),
    );
  });

  it("logs when reporting pod logs fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    harness.mockConnection.sendMessage.mockRejectedValueOnce(new Error("Connection error"));

    harness.dispatchWorkerMessage({
      type: "pod_log",
      payload: {
        namespace: "default",
        name: "test-pod",
        log: "test log line",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Agent] Failed to report pod log:"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
