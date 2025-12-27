import { createAgentHarness, createAgentMessage, createPodSpec, type AgentHarness } from "./testUtils";
import { describe, it, expect, beforeEach, vi } from "vitest";

let harness: AgentHarness;

beforeEach(() => {
  harness = createAgentHarness();
});

describe("Agent message handling", () => {
  it("executes pod specs", async () => {
    const podSpec = createPodSpec();

    await harness.dispatchMessage(createAgentMessage("pod_spec", podSpec));

    expect(harness.mockRuntime.executePod).toHaveBeenCalledWith(podSpec, expect.any(Function), expect.any(Function));
  });

  it("deletes pods", async () => {
    await harness.dispatchMessage(
      createAgentMessage("pod_delete", {
        namespace: "default",
        name: "test-pod",
      }),
    );

    expect(harness.mockRuntime.deletePod).toHaveBeenCalledWith("default", "test-pod");
  });

  it("ignores unknown message types", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await harness.dispatchMessage(
      createAgentMessage("unknown_type", {
        foo: "bar",
      } as unknown),
    );

    expect(consoleSpy).toHaveBeenCalledWith("[Agent] Unhandled message type:", "unknown_type");
    expect(harness.mockRuntime.executePod).not.toHaveBeenCalled();
    expect(harness.mockRuntime.deletePod).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("handles registration acknowledgement", async () => {
    await harness.dispatchMessage(
      createAgentMessage("registered", {
        status: "ok",
      }),
    );
  });
});
