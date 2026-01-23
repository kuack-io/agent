import { setupRuntimeTestEnvironment, createFetchResponse, token } from "./testUtils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime download helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("downloadFile fetches text content", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(
      createFetchResponse({
        text: () => Promise.resolve('{"main":"pkg/app.js"}'),
      }),
    );

    const contentPromise = runtime.downloadFile("ghcr.io/kuack/app", "pkg/package.json", "arm64");

    // Fast-forward any potential setTimeouts
    await vi.runAllTimersAsync();

    const content = await contentPromise;

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
    fetchMock.mockImplementation(async () => {
      // We need to advance timers here if the code waits, but for single failure it might just return.
      // However, fetchWithRetry creates a timeout controller.
      return createFetchResponse({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve("missing"),
      });
    });

    const promise = runtime.downloadFile("img", "pkg/package.json");
    const assertion = expect(promise).rejects.toThrow("HTTP 404: Not Found");

    // Since fetchWithRetry has retries, we need to advance time for each retry
    // The implementation waits 1000 * 2^i
    // We can just advance a lot of time
    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
  });

  it("downloadWASM returns Uint8Array", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(
      createFetchResponse({ arrayBuffer: () => Promise.resolve(new Uint8Array([7, 8]).buffer) }),
    );

    const p = runtime.downloadWASM({
      name: "runner",
      image: "ghcr.io/kuack/wasm",
      wasm: { path: "pkg/mod_bg.wasm", variant: "amd64" },
    });

    await vi.runAllTimersAsync();
    const bytes = await p;

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

    const p = runtime.downloadWASM({ name: "runner", image: "img" });
    const assertion = expect(p).rejects.toThrow("HTTP 500: Server Error");

    // Advance enough for 3 retries (1s + 2s + 4s = 7s)
    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
  });

  it("downloadWASM retries with out.wasm on 404", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();

    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      // First 3 calls (retries) return 404
      if (callCount <= 3) {
        return Promise.resolve(createFetchResponse({ ok: false, status: 404, statusText: "Not Found" }));
      }
      // 4th call (fallback) returns 200
      return Promise.resolve(
        createFetchResponse({ arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer) }),
      );
    });

    const p = runtime.downloadWASM({
      name: "runner",
      image: "ghcr.io/kuack/wasm",
      wasm: { path: "pkg/custom.wasm", variant: "amd64" },
    });

    // Advance time for retries
    // 3 retries for first URL (3s delay total) + 0 retries for success
    await vi.advanceTimersByTimeAsync(10000);

    const bytes = await p;

    expect(Array.from(bytes)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstCall = new URL(fetchMock.mock.calls[0][0]);
    expect(firstCall.searchParams.get("path")).toBe("pkg/custom.wasm");

    const fallbackCall = new URL(fetchMock.mock.calls[3][0]);
    expect(fallbackCall.searchParams.get("path")).toBe("out.wasm");
  });

  it("downloadJS derives JS path from WASM path", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(createFetchResponse({ text: () => Promise.resolve("console.log('ok');") }));

    const p = runtime.downloadJS("pkg/sample_bg.wasm", "ghcr.io/kuack/js", "wasm32");
    await vi.runAllTimersAsync();
    const js = await p;

    expect(js).toBe("console.log('ok');");
    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("path")).toBe("pkg/sample.js");
    expect(requestedUrl.searchParams.get("variant")).toBe("wasm32");
  });

  it("downloadJS throws when glue download fails", async () => {
    const runtime = env.getRuntimeInternals();
    const fetchMock = env.getFetchMock();
    fetchMock.mockResolvedValue(createFetchResponse({ ok: false, status: 502, statusText: "Bad Gateway" }));

    const p = runtime.downloadJS("pkg/sample_bg.wasm", "img");
    const assertion = expect(p).rejects.toThrow("HTTP 502: Bad Gateway");

    await vi.advanceTimersByTimeAsync(10000);

    await assertion;
  });
});
