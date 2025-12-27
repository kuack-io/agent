import { Runtime } from "../../runtime";
import { setupRuntimeTestEnvironment, registryUrl, token } from "./testUtils";
import { describe, it, expect } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime buildRegistryUrl", () => {
  it("returns absolute URL as-is", () => {
    const runtime = env.getRuntime();
    const url = (runtime as unknown as Record<string, () => URL>).buildRegistryUrl();
    expect(url.toString()).toBe(registryUrl);
  });

  it("resolves relative URL using window origin", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { origin: "https://kuack.io" },
    } as Window;
    const relativeRuntime = new Runtime("/registry", token);

    const url = (relativeRuntime as unknown as Record<string, () => URL>).buildRegistryUrl();
    expect(url.toString()).toBe("https://kuack.io/registry");
  });

  it("throws when relative URL cannot be resolved without window", () => {
    delete (globalThis as Record<string, unknown>).window;
    const relativeRuntime = new Runtime("/registry", token);
    expect(() => (relativeRuntime as unknown as Record<string, () => URL>).buildRegistryUrl()).toThrow();
  });
});
