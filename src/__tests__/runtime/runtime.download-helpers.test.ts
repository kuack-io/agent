import { setupRuntimeTestEnvironment, createFetchResponse, token } from "./testUtils";
import { describe, it, expect } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime download helpers", () => {
  it("downloadFile fetches text content", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(
      createFetchResponse({
        text: () => Promise.resolve('{"main":"pkg/app.js"}'),
      }),
    );

    const content = await runtime.downloadFile("ghcr.io/kuack/app", "pkg/package.json", "arm64");

    expect(content).toBe('{"main":"pkg/app.js"}');
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("image")).toBe("ghcr.io/kuack/app");
    expect(requestedUrl.searchParams.get("path")).toBe("pkg/package.json");
    expect(requestedUrl.searchParams.get("token")).toBe(token);
    expect(requestedUrl.searchParams.get("variant")).toBe("arm64");
  });

  it("downloadFile surfaces HTTP error details", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(
      createFetchResponse({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("missing"),
      }),
    );

    await expect(runtime.downloadFile("img", "pkg/package.json")).rejects.toThrow(
      "Failed to download file pkg/package.json: 404 Not Found: missing",
    );
  });

  it("downloadWASM returns Uint8Array", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(
      createFetchResponse({ arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8]).buffer) }),
    );

    const bytes = await runtime.downloadWASM({
      name: "runner",
      image: "ghcr.io/kuack/wasm",
      wasm: { path: "pkg/mod_bg.wasm", variant: "amd64" },
    });

    expect(Array.from(bytes)).toEqual([7, 8]);
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("image")).toBe("ghcr.io/kuack/wasm");
    expect(requestedUrl.searchParams.get("path")).toBe("pkg/mod_bg.wasm");
    expect(requestedUrl.searchParams.get("variant")).toBe("amd64");
  });

  it("downloadWASM throws on HTTP failures", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(
      createFetchResponse({ ok: false, status: 500, statusText: "Server Error", text: () => Promise.resolve("boom") }),
    );

    await expect(runtime.downloadWASM({ name: "runner", image: "img" })).rejects.toThrow(
      "Failed to download WASM: 500 Server Error: boom",
    );
  });

  it("downloadJS derives JS path from WASM path", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(createFetchResponse({ text: () => Promise.resolve("console.log('ok');") }));

    const js = await runtime.downloadJS("pkg/sample_bg.wasm", "ghcr.io/kuack/js", "wasm32");

    expect(js).toBe("console.log('ok');");
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("path")).toBe("pkg/sample.js");
    expect(requestedUrl.searchParams.get("variant")).toBe("wasm32");
  });

  it("downloadJS throws when glue download fails", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(createFetchResponse({ ok: false, status: 502, statusText: "Bad Gateway" }));

    await expect(runtime.downloadJS("pkg/sample_bg.wasm", "img")).rejects.toThrow(
      "Failed to download JS: 502 Bad Gateway",
    );
  });
});
