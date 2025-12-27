import { setupRuntimeTestEnvironment } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime deletePod", () => {
  it("aborts running pods and removes them from the registry", async () => {
    const runtime = env.getRuntime();
    const controller = new AbortController();
    const abortSpy = vi.spyOn(controller, "abort");
    env.getRunningPodsMap().set("default/test", controller);

    await runtime.deletePod("default", "test");

    expect(abortSpy).toHaveBeenCalled();
    expect(runtime.getRunningPodCount()).toBe(0);
  });
});
