import { createAgentHarness, createAgentMessage, createPodSpec, type AgentHarness } from "./testUtils";
import { describe, it, expect, beforeEach, vi } from "vitest";

let harness: AgentHarness;

beforeEach(() => {
  harness = createAgentHarness();
});

describe("Agent message handling", () => {
  it("executes pod specs", async () => {
    const { mockWorker, dispatchMessage } = createAgentHarness();
    const podSpec = createPodSpec();
    const message = createAgentMessage("pod_spec", podSpec);

    await dispatchMessage(message);

    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: "execute_pod",
      payload: podSpec,
    });
  });

  it("deletes pods", async () => {
    const { mockWorker, dispatchMessage } = createAgentHarness();
    const payload = { namespace: "default", name: "test-pod" };
    const message = createAgentMessage("pod_delete", payload);

    await dispatchMessage(message);

    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: "delete_pod",
      payload,
    });
  });

  it("ignores unknown message types", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await harness.dispatchMessage(
      createAgentMessage("unknown_type", {
        foo: "bar",
      } as unknown),
    );

    expect(consoleSpy).toHaveBeenCalledWith("[Agent] Unhandled message type:", "unknown_type");
    expect(harness.mockWorker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "execute_pod" }));
    expect(harness.mockWorker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "delete_pod" }));

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
