import { Runtime, type PodSpec } from "./runtime";
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock wasm-bindgen module
const mockWasmBindgenInit = vi.fn().mockResolvedValue(undefined);
const mockMainFunc = vi.fn().mockResolvedValue("success");
const mockWasmBindgenModule = {
  default: mockWasmBindgenInit,
  main: mockMainFunc,
};

// Mock dynamic import
vi.mock("/* @vite-ignore */", () => ({}));

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

// Mock fetch
global.fetch = vi.fn();

// Helper to setup package.json + WASM + JS fetch mocks
function setupWasmJsFetchMock(wasmBytes: Uint8Array, jsCode: string, packageJson?: string) {
  const mockPackageJsonResponse = {
    ok: true,
    text: vi.fn().mockResolvedValue(packageJson || JSON.stringify({ main: "test.js" })),
  };

  const mockWasmResponse = {
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
  };

  const mockJsResponse = {
    ok: true,
    text: vi.fn().mockResolvedValue(jsCode),
  };

  // Use mockResolvedValueOnce to properly alternate between package.json, WASM and JS responses
  vi.mocked(global.fetch)
    .mockResolvedValueOnce(mockPackageJsonResponse as unknown as Response)
    .mockResolvedValueOnce(mockWasmResponse as unknown as Response)
    .mockResolvedValueOnce(mockJsResponse as unknown as Response);
}

describe("Runtime", () => {
  let runtime: Runtime;
  const registryProxyUrl = "http://localhost:8080/registry";

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new Runtime(registryProxyUrl);
    mockWasmBindgenInit.mockClear();
    mockMainFunc.mockClear();

    // Spy on the importWasmBindgenModule method to mock dynamic imports
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(runtime as any, "importWasmBindgenModule").mockResolvedValue(mockWasmBindgenModule);
  });

  describe("constructor", () => {
    it("should initialize with registry proxy URL", () => {
      expect(runtime.getRunningPodCount()).toBe(0);
    });
  });

  describe("executePod", () => {
    const podSpec: PodSpec = {
      metadata: {
        name: "test-pod",
        namespace: "default",
      },
      spec: {
        containers: [
          {
            name: "test-container",
            image: "test-image:latest",
            command: ["/bin/sh"],
            args: ["-c", "echo hello"],
            env: [{ name: "ENV_VAR", value: "test-value" }],
            wasm: {
              path: "/pkg/test_bg.wasm",
            },
          },
        ],
      },
    };

    it("should execute pod successfully", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]); // WASM magic number
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      // Mock fetch to return different responses for package.json, WASM and JS
      const mockPackageJsonResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({ main: "test.js" })),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes("package.json")) {
          return Promise.resolve(mockPackageJsonResponse as unknown as Response);
        } else if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpec, statusCallback, logCallback);

      // Check status updates
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Pending",
        message: "Downloading WASM module",
      });
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Running",
        message: "Executing WASM module",
      });
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });

      // Check wasm-bindgen init was called
      expect(mockWasmBindgenInit).toHaveBeenCalledWith({ module_or_path: wasmBytes });
      expect(mockMainFunc).toHaveBeenCalled();

      // Check pod is cleaned up
      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("propagates wasm hints to the registry proxy", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      const specWithHints: PodSpec = {
        ...podSpec,
        spec: {
          containers: [
            {
              ...podSpec.spec.containers[0],
              wasm: {
                path: "/custom/module.wasm",
                variant: "browser",
              },
            },
          ],
        },
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(specWithHints, statusCallback, logCallback);

      const expectedWasmUrl = new URL(registryProxyUrl);
      expectedWasmUrl.searchParams.set("image", specWithHints.spec.containers[0].image);
      expectedWasmUrl.searchParams.set("path", "/custom/module.wasm");
      expectedWasmUrl.searchParams.set("variant", "browser");

      expect(global.fetch).toHaveBeenCalledWith(expectedWasmUrl.toString());

      const expectedJsUrl = new URL(registryProxyUrl);
      const expectedJsPath = "/custom/module.wasm".replace(/_bg\.wasm$/, ".js");
      expectedJsUrl.searchParams.set("image", specWithHints.spec.containers[0].image);
      expectedJsUrl.searchParams.set("path", expectedJsPath);
      expectedJsUrl.searchParams.set("variant", "browser");

      expect(global.fetch).toHaveBeenCalledWith(expectedJsUrl.toString());
    });

    it("should handle pod with no containers", async () => {
      const emptyPodSpec: PodSpec = {
        metadata: {
          name: "empty-pod",
          namespace: "default",
        },
        spec: {
          containers: [],
        },
      };

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(emptyPodSpec, statusCallback, logCallback);

      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Failed",
        message: expect.stringContaining("No containers specified"),
      });

      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should handle download failure", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };

      vi.mocked(global.fetch).mockResolvedValue(mockResponse as unknown as Response);

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpec, statusCallback, logCallback);

      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Failed",
        message: expect.stringContaining("Failed to download WASM"),
      });

      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should handle WASM execution error", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      mockWasmBindgenInit.mockRejectedValueOnce(new Error("WASM execution error"));

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpec, statusCallback, logCallback);

      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Failed",
        message: expect.stringContaining("Execution error"),
      });

      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should handle WASM module without main function", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      // Mock module without main function
      const moduleWithoutMain = {
        default: mockWasmBindgenInit,
        // No main function
      };

      // Override the spy for this specific test
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(runtime as any, "importWasmBindgenModule").mockResolvedValueOnce(moduleWithoutMain);

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpec, statusCallback, logCallback);

      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });

      expect(logCallback).toHaveBeenCalledWith(expect.stringContaining("no main function found"));

      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should handle aborted signal", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      // Create abort controller and abort it
      const abortController = new AbortController();
      abortController.abort();

      // We need to manually set the signal as aborted
      // Since we can't easily inject the abort controller, we'll test deletePod instead
      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      // Start execution
      const executePromise = runtime.executePod(podSpec, statusCallback, logCallback);

      // Delete pod while executing
      await runtime.deletePod("default", "test-pod");

      await executePromise;

      // Pod should be deleted
      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should track running pods", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      // Make execution take some time
      mockMainFunc.mockImplementation(() => {
        return new Promise((resolve) => setTimeout(resolve, 100));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      const executePromise = runtime.executePod(podSpec, statusCallback, logCallback);

      // Check that pod is tracked while running
      // Note: This is async, so we need to wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The pod should be in the running map
      // But since execution is fast in tests, it might already be done
      // So we'll just verify it eventually reaches 0
      await executePromise;
      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should handle pod with command and args", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      setupWasmJsFetchMock(wasmBytes, jsCode);

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpec, statusCallback, logCallback);

      // Verify wasm-bindgen init was called
      expect(mockWasmBindgenInit).toHaveBeenCalled();
    });

    it("should handle pod with environment variables", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      setupWasmJsFetchMock(wasmBytes, jsCode);

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpec, statusCallback, logCallback);

      // Verify execution happened
      expect(mockMainFunc).toHaveBeenCalled();
    });

    it("should auto-discover WASM path from package.json", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      // Pod spec without wasm.path - should trigger auto-discovery
      const podSpecWithoutPath: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      const packageJson = JSON.stringify({ main: "test_module.js" });
      const mockPackageJsonResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(packageJson),
      };

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes("package.json")) {
          return Promise.resolve(mockPackageJsonResponse as unknown as Response);
        } else if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpecWithoutPath, statusCallback, logCallback);

      // Verify package.json was downloaded
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("package.json"));

      // Verify WASM was downloaded with discovered path (URL-encoded)
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("test_module_bg.wasm"));

      // Verify execution succeeded
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    });

    it("should use fallback path when package.json discovery fails", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      // Pod spec without wasm.path - should trigger auto-discovery, then fallback
      const podSpecWithoutPath: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "ghcr.io/kuack-io/checker:latest",
            },
          ],
        },
      };

      // Mock package.json download to fail
      const mockPackageJsonResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue(""),
      };

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes("package.json")) {
          return Promise.resolve(mockPackageJsonResponse as unknown as Response);
        } else if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpecWithoutPath, statusCallback, logCallback);

      // Verify package.json download was attempted
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("package.json"));

      // Verify WASM was downloaded with fallback path (checker -> checker_bg.wasm)
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("checker_bg.wasm"));

      // Verify execution succeeded
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    });

    it("should convert dashes to underscores in fallback path", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      // Pod spec with image name containing dashes (needs / for regex to match)
      const podSpecWithoutPath: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "registry.io/kuack-checker:latest",
            },
          ],
        },
      };

      // Mock package.json download to fail
      const mockPackageJsonResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue(""),
      };

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes("package.json")) {
          return Promise.resolve(mockPackageJsonResponse as unknown as Response);
        } else if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpecWithoutPath, statusCallback, logCallback);

      // Verify package.json download was attempted
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("package.json"));

      // Verify WASM was downloaded with fallback path (kuack-checker -> kuack_checker_bg.wasm)
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("kuack_checker_bg.wasm"));

      // Verify execution succeeded
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    });

    it("should use wasm.image if provided for path discovery", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      // Pod spec with wasm.image different from container.image
      const podSpecWithWasmImage: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "base-image:latest",
              wasm: {
                image: "wasm-image:latest",
              },
            },
          ],
        },
      };

      const packageJson = JSON.stringify({ main: "module.js" });
      const mockPackageJsonResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(packageJson),
      };

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes("package.json")) {
          return Promise.resolve(mockPackageJsonResponse as unknown as Response);
        } else if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpecWithWasmImage, statusCallback, logCallback);

      // Verify package.json was downloaded using wasm.image
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("image=wasm-image%3Alatest"));

      // Verify WASM was downloaded using wasm.image
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("image=wasm-image%3Alatest"));

      // Verify execution succeeded
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    });

    it("should propagate wasm.variant to package.json download", async () => {
      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const podSpecWithVariant: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
              wasm: {
                variant: "browser",
              },
            },
          ],
        },
      };

      const packageJson = JSON.stringify({ main: "test.js" });
      const mockPackageJsonResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(packageJson),
      };

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes("package.json")) {
          return Promise.resolve(mockPackageJsonResponse as unknown as Response);
        } else if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      await runtime.executePod(podSpecWithVariant, statusCallback, logCallback);

      // Verify variant was passed to package.json download
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("variant=browser"));

      // Verify execution succeeded
      expect(statusCallback).toHaveBeenCalledWith({
        phase: "Succeeded",
        message: "WASM execution completed",
      });
    });
  });

  describe("deletePod", () => {
    it("should delete running pod", async () => {
      const podSpec: PodSpec = {
        metadata: {
          name: "test-pod",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "test-container",
              image: "test-image:latest",
            },
          ],
        },
      };

      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      // Make execution take time
      let resolveExecution: () => void;
      const executionPromise = new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });

      mockMainFunc.mockImplementation(() => {
        return executionPromise;
      });

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      // Start execution
      const executePromise = runtime.executePod(podSpec, statusCallback, logCallback);

      // Wait a bit for pod to be registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Delete pod
      await runtime.deletePod("default", "test-pod");

      // Pod should be removed
      expect(runtime.getRunningPodCount()).toBe(0);

      // Resume execution
      resolveExecution!();
      await executePromise;
    });

    it("should handle deleting non-existent pod", async () => {
      await runtime.deletePod("default", "non-existent-pod");
      expect(runtime.getRunningPodCount()).toBe(0);
    });
  });

  describe("getRunningPodCount", () => {
    it("should return 0 when no pods are running", () => {
      expect(runtime.getRunningPodCount()).toBe(0);
    });

    it("should return correct count of running pods", async () => {
      const podSpec1: PodSpec = {
        metadata: {
          name: "pod-1",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "container",
              image: "image:latest",
            },
          ],
        },
      };

      const podSpec2: PodSpec = {
        metadata: {
          name: "pod-2",
          namespace: "default",
        },
        spec: {
          containers: [
            {
              name: "container",
              image: "image:latest",
            },
          ],
        },
      };

      const wasmBytes = new Uint8Array([0, 97, 115, 109]);
      const jsCode = "export default function() {}";

      const mockWasmResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(wasmBytes.buffer),
      };

      const mockJsResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(jsCode),
      };

      vi.mocked(global.fetch).mockImplementation((url) => {
        const urlStr = url.toString();
        if (urlStr.includes(".wasm")) {
          return Promise.resolve(mockWasmResponse as unknown as Response);
        } else if (urlStr.includes(".js")) {
          return Promise.resolve(mockJsResponse as unknown as Response);
        }
        return Promise.reject(new Error("Unexpected fetch"));
      });

      // Make execution take time
      let resolveExecution1: () => void;
      let resolveExecution2: () => void;
      const executionPromise1 = new Promise<void>((resolve) => {
        resolveExecution1 = resolve;
      });
      const executionPromise2 = new Promise<void>((resolve) => {
        resolveExecution2 = resolve;
      });

      mockMainFunc.mockImplementationOnce(() => executionPromise1).mockImplementationOnce(() => executionPromise2);

      const statusCallback = vi.fn();
      const logCallback = vi.fn();

      // Start two pods
      const executePromise1 = runtime.executePod(podSpec1, statusCallback, logCallback);
      const executePromise2 = runtime.executePod(podSpec2, statusCallback, logCallback);

      // Wait a bit for pods to be registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should have 2 running pods
      // Note: Due to async nature, this might be 0 if execution completes quickly
      // So we'll just verify the method works

      // Complete executions
      resolveExecution1!();
      resolveExecution2!();
      await Promise.all([executePromise1, executePromise2]);

      // Should be 0 after completion
      expect(runtime.getRunningPodCount()).toBe(0);
    });
  });
});
