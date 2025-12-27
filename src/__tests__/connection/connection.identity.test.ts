import { Connection } from "../../connection";
import { setupConnectionTestEnvironment, WS_URL, overrideProperty } from "./testUtils";
import { describe, it, expect, beforeEach, vi } from "vitest";

const TOKEN = "test-token";
const env = setupConnectionTestEnvironment();

type BrowserDetectionInternals = {
  getBrowserName(): string;
};

const readBrowserName = (connection: Connection) =>
  (connection as unknown as BrowserDetectionInternals).getBrowserName();

describe("getUUID", () => {
  it("returns the same UUID for an instance", () => {
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(connection.getUUID()).toBe(connection.getUUID());
  });

  it("generates different UUIDs per instance", () => {
    const first = env.trackConnection(new Connection(WS_URL, TOKEN));
    const second = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(first.getUUID()).not.toBe(second.getUUID());
  });
});

describe("browser ID", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("stores a generated browser ID", () => {
    env.trackConnection(new Connection(WS_URL, TOKEN));
    const browserId = localStorage.getItem("kuack-browser-id");
    expect(browserId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("reuses an existing browser ID", () => {
    const existingId = "test-browser-id-123";
    localStorage.setItem("kuack-browser-id", existingId);
    env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(localStorage.getItem("kuack-browser-id")).toBe(existingId);
  });

  it("logs a warning when localStorage is unavailable", () => {
    const originalLocalStorage = global.localStorage;
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(global, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("localStorage unavailable");
        },
        setItem: () => {
          throw new Error("localStorage unavailable");
        },
      },
      configurable: true,
    });

    env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Agent] localStorage unavailable"),
      expect.any(Error),
    );

    Object.defineProperty(global, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
    });
    consoleSpy.mockRestore();
  });
});

describe("browser detection", () => {
  it("detects Firefox", () => {
    const restoreUA = overrideProperty(global.navigator, "userAgent", "Mozilla/5.0 Firefox/90.0");
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(readBrowserName(connection)).toBe("firefox");
    restoreUA();
  });

  it("detects Safari", () => {
    const restoreUA = overrideProperty(global.navigator, "userAgent", "Mozilla/5.0 Version/14.1.1 Safari/605.1.15");
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(readBrowserName(connection)).toBe("safari");
    restoreUA();
  });

  it("detects Edge", () => {
    const restoreUA = overrideProperty(
      global.navigator,
      "userAgent",
      "Mozilla/5.0 Chrome/91.0.4472.124 Edg/91.0.864.59",
    );
    const connection = env.trackConnection(new Connection(WS_URL, TOKEN));
    expect(readBrowserName(connection)).toBe("edge");
    restoreUA();
  });
});
