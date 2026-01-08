import { Runtime, type ContainerSpec } from "../../runtime";
import { beforeEach, afterEach, vi } from "vitest";

export const registryUrl = "https://registry.example.com/proxy";
export const token = "test-token";
const originalWindow = globalThis.window;

type FetchMock = ReturnType<typeof vi.fn>;

type DownloadFileFn = (imageRef: string, path: string, variant?: string) => Promise<string>;
type DownloadWASMFn = (container: ContainerSpec) => Promise<Uint8Array>;
type DownloadJSFn = (wasmPath: string, imageRef: string, variant?: string) => Promise<string>;
type ExecuteWASMFn = (
  wasmBytes: Uint8Array,
  jsCode: string,
  command: string[],
  args: string[],
  env: Array<{ name: string; value: string }>,
  onLog: (log: string) => void,
  signal: AbortSignal,
) => Promise<void>;
type ImportWasmModuleFn = (blobUrl: string) => Promise<{
  default: (config: { module_or_path: Uint8Array }) => Promise<void>;
  main?: (env?: Record<string, string>) => Promise<unknown>;
}>;

type ExecuteWASIFn = (
  wasmBytes: Uint8Array,
  command: string[],
  args: string[],
  env: Array<{ name: string; value: string }>,
  onLog: (log: string) => void,
  signal: AbortSignal,
) => Promise<void>;

export type RuntimeInternals = {
  downloadFile: DownloadFileFn;
  downloadWASM: DownloadWASMFn;
  downloadJS: DownloadJSFn;
  executeWASM: ExecuteWASMFn;
  executeWASI: ExecuteWASIFn;
  importWasmBindgenModule: ImportWasmModuleFn;
};

export interface RuntimeTestEnvironment {
  getRuntime(): Runtime;
  getRuntimeInternals(): RuntimeInternals;
  getFetchMock(): FetchMock;
  getRunningPodsMap(): Map<string, AbortController>;
}

export const setupRuntimeTestEnvironment = (): RuntimeTestEnvironment => {
  const state: { runtime: Runtime | null; fetchMock: FetchMock | null } = {
    runtime: null,
    fetchMock: null,
  };

  beforeEach(() => {
    state.runtime = new Runtime(registryUrl, token);
    state.fetchMock = vi.fn();
    vi.stubGlobal("fetch", state.fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  return {
    getRuntime: () => {
      if (!state.runtime) {
        throw new Error("Runtime not initialized");
      }
      return state.runtime;
    },
    getRuntimeInternals: () => {
      if (!state.runtime) {
        throw new Error("Runtime not initialized");
      }
      return state.runtime as unknown as RuntimeInternals;
    },
    getFetchMock: () => {
      if (!state.fetchMock) {
        throw new Error("fetch mock not initialized");
      }
      return state.fetchMock;
    },
    getRunningPodsMap: () => {
      if (!state.runtime) {
        throw new Error("Runtime not initialized");
      }
      return (state.runtime as unknown as { runningPods: Map<string, AbortController> }).runningPods;
    },
  };
};

export const createFetchResponse = (
  overrides: Partial<Response> & {
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  } = {},
): Response => {
  const response: Partial<Response> = {
    ok: true,
    status: 200,
    statusText: "OK",
    text: vi.fn().mockResolvedValue(""),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    ...overrides,
  };

  return response as Response;
};

type BlobUrlHost = {
  createObjectURL?: (object: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

export const setupBlobUrlMocks = () => {
  const urlHost = URL as unknown as BlobUrlHost;
  const originalCreate = urlHost.createObjectURL;
  const originalRevoke = urlHost.revokeObjectURL;
  const createSpy = vi.fn<(blob: Blob) => string>().mockReturnValue("blob:mock-url");
  const revokeSpy = vi.fn<(url: string) => void>();
  urlHost.createObjectURL = createSpy;
  urlHost.revokeObjectURL = revokeSpy;

  const restore = () => {
    if (originalCreate) {
      urlHost.createObjectURL = originalCreate;
    } else {
      delete (urlHost as Record<string, unknown>).createObjectURL;
    }

    if (originalRevoke) {
      urlHost.revokeObjectURL = originalRevoke;
    } else {
      delete (urlHost as Record<string, unknown>).revokeObjectURL;
    }
  };

  return { createSpy, revokeSpy, restore };
};
