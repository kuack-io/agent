import { setupRuntimeTestEnvironment } from "./testUtils";
import { describe, it, expect } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime importWasmBindgenModule", () => {
  it("performs dynamic imports for data URLs", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const module = await runtimeInternals.importWasmBindgenModule(
      "data:text/javascript,export default()=>({ready:true});export const main=()=>42;",
    );

    expect(typeof module.default).toBe("function");
    expect((module as Record<string, unknown>).main).toBeDefined();
  });
});
