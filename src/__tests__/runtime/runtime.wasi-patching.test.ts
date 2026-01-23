import { setupRuntimeTestEnvironment } from "./testUtils";
import { WASI } from "@bjorn3/browser_wasi_shim";
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock @bjorn3/browser_wasi_shim
vi.mock("@bjorn3/browser_wasi_shim", () => {
  const WasiFile = vi.fn();
  const OpenFile = vi.fn();
  const WASI = vi.fn();
  const PreopenDirectory = vi.fn();
  const ConsoleStdout = {
    lineBuffered: vi.fn(),
  };
  return { WASI, File: WasiFile, OpenFile, PreopenDirectory, ConsoleStdout };
});

const env = setupRuntimeTestEnvironment();

describe("Runtime WASI Patching", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("patches fd_read to handle iovec limits", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const controller = new AbortController();
    const onLog = vi.fn();

    // 1. Setup Mock WASI Instance and Spies
    const originalFdReadSpy = vi.fn().mockReturnValue(0); // Return 0 (Success)

    interface MockWasiInstance {
      wasiImport: Record<string, unknown>;
      inst: { exports: { memory: WebAssembly.Memory } } | null;
      start: unknown;
    }

    const mockWasiInstance: MockWasiInstance = {
      wasiImport: {
        fd_read: originalFdReadSpy,
        fd_write: vi.fn(), // Needed as it might be patched too
        fd_pread: vi.fn(),
        fd_pwrite: vi.fn(),
      },
      inst: null, // Will be set later
      start: vi.fn().mockReturnValue(0),
    };

    (WASI as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return mockWasiInstance;
    });

    // 2. Setup WebAssembly Memory
    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);

    // Mock original fd_read to simulate reading data
    // It should write the number of bytes read into nread_ptr
    originalFdReadSpy.mockImplementation((fd, iovs_ptr, iovs_len, nread_ptr) => {
      view.setUint32(nread_ptr, 100, true); // Simulate reading 100 bytes per call
      return 0;
    });

    // 3. Mock Instantiate to stop execution but allow patching to happen
    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      instance: {
        exports: {
          memory: memory,
          _start: vi.fn(),
        },
      },
    } as unknown as WebAssembly.Instance);

    // 4. Run executeWASI (this will trigger patching)
    // We don't care if it finishes, we just want to access the patched function afterwards
    // or we can intercept it.
    await runtimeInternals.executeWASI(new Uint8Array([]), [], [], [], onLog, controller.signal);

    // 5. Verify Patching Logic
    const patchedFdRead = mockWasiInstance.wasiImport.fd_read as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      nread_ptr: number,
    ) => number;
    expect(patchedFdRead).not.toBe(originalFdReadSpy); // Should be wrapped

    // Manually set 'inst' on the mock because the patch relies on it
    // In real flow, 'start' or internal logic sets it, but here we just need it for the patch to work
    mockWasiInstance.inst = { exports: { memory } };

    // Case A: Small iovs_len (<= 1024) - Direct Call
    patchedFdRead(1, 0, 10, 0);
    expect(originalFdReadSpy).toHaveBeenLastCalledWith(1, 0, 10, 0);

    // Case B: Large iovs_len (> 1024) - Batched Calls
    // Total 2500 iovs. iovec size is 8 bytes.
    // Batch 1: 1024 iovs.
    // Batch 2: 1024 iovs.
    // Batch 3: 452 iovs.
    // Total read should be 100 * 3 = 300 (since our mock always returns 100)
    originalFdReadSpy.mockClear();

    // We need valid pointers for nread_ptr. Let's use offset 0 for simplicity.
    const nreadPtr = 0;

    // Call patched function
    const ret = patchedFdRead(1, 1000, 2500, nreadPtr);

    expect(ret).toBe(0);
    expect(originalFdReadSpy).toHaveBeenCalledTimes(3);

    // Check first batch
    // ptr starts at 1000. 1024 * 8 = 8192 bytes advanced
    expect(originalFdReadSpy).toHaveBeenNthCalledWith(1, 1, 1000, 1024, nreadPtr);

    // Check second batch
    // ptr = 1000 + 8192 = 9192
    expect(originalFdReadSpy).toHaveBeenNthCalledWith(2, 1, 9192, 1024, nreadPtr);

    // Verift total read accumulation
    const totalRead = view.getUint32(nreadPtr, true);
    expect(totalRead).toBe(300);
  });

  it("patches fd_pread to handle iovec limits", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const controller = new AbortController();
    const onLog = vi.fn();

    const originalFdPreadSpy = vi.fn().mockReturnValue(0);
    const mockWasiInstance = {
      wasiImport: {
        fd_read: vi.fn(),
        fd_write: vi.fn(),
        fd_pread: originalFdPreadSpy,
        fd_pwrite: vi.fn(),
      },
      inst: null as { exports: { memory: WebAssembly.Memory } } | null,
      start: vi.fn().mockReturnValue(0),
    };

    (WASI as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return mockWasiInstance;
    });

    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);

    originalFdPreadSpy.mockImplementation((fd, iovs_ptr, iovs_len, offset, nread_ptr) => {
      view.setUint32(nread_ptr, 50, true); // Simulate reading 50 bytes
      return 0;
    });

    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      instance: { exports: { memory, _start: vi.fn() } },
    } as unknown as WebAssembly.Instance);

    await runtimeInternals.executeWASI(new Uint8Array([]), [], [], [], onLog, controller.signal);

    const patchedFdPread = mockWasiInstance.wasiImport.fd_pread as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      offset: bigint,
      nread_ptr: number,
    ) => number;
    mockWasiInstance.inst = { exports: { memory } };

    // Case B: Large iovs_len (> 1024)
    // 1500 iovs.
    // Batch 1: 1024. Read 50. Offset updates by 50.
    // Batch 2: 476. Read 50.

    const nreadPtr = 16;
    const initialOffset = 1000n;

    const ret = patchedFdPread(1, 0, 1500, initialOffset, nreadPtr);

    expect(ret).toBe(0);
    expect(originalFdPreadSpy).toHaveBeenCalledTimes(2);

    // First call: offset 1000n
    expect(originalFdPreadSpy).toHaveBeenNthCalledWith(1, 1, 0, 1024, 1000n, nreadPtr);

    // Second call: offset 1000n + 50n = 1050n
    // Ptr advanced by 1024 * 8 = 8192
    expect(originalFdPreadSpy).toHaveBeenNthCalledWith(2, 1, 8192, 476, 1050n, nreadPtr);

    const totalRead = view.getUint32(nreadPtr, true);
    expect(totalRead).toBe(100);
  });

  it("handles error from original fd_write", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const controller = new AbortController();
    const onLog = vi.fn();

    const originalFdWriteSpy = vi.fn().mockReturnValue(-1); // Error
    const mockWasiInstance = {
      wasiImport: {
        fd_read: vi.fn(),
        fd_write: originalFdWriteSpy,
        fd_pread: vi.fn(),
        fd_pwrite: vi.fn(),
      },
      inst: null as { exports: { memory: WebAssembly.Memory } } | null,
      start: vi.fn().mockReturnValue(0),
    };
    (WASI as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockWasiInstance);
    // Use function for mock as before
    (WASI as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return mockWasiInstance;
    });

    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      instance: { exports: { memory: new WebAssembly.Memory({ initial: 1 }), _start: vi.fn() } },
    } as unknown as WebAssembly.Instance);

    await runtimeInternals.executeWASI(new Uint8Array([]), [], [], [], onLog, controller.signal);

    const patchedFdWrite = mockWasiInstance.wasiImport.fd_write as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      nwritten_ptr: number,
    ) => number;

    // Call with > 1024 to trigger loop
    const ret = patchedFdWrite(1, 0, 1025, 0);

    expect(ret).toBe(-1);
    expect(originalFdWriteSpy).toHaveBeenCalledTimes(1);
  });

  it("handles partial read/EOF in fd_read loop", async () => {
    const runtimeInternals = env.getRuntimeInternals();
    const controller = new AbortController();
    const onLog = vi.fn();

    const originalFdReadSpy = vi.fn();
    const mockWasiInstance = {
      wasiImport: {
        fd_read: originalFdReadSpy,
        fd_write: vi.fn(),
        fd_pread: vi.fn(),
        fd_pwrite: vi.fn(),
      },
      inst: null as { exports: { memory: WebAssembly.Memory } } | null,
      start: vi.fn().mockReturnValue(0),
    };
    (WASI as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () {
      return mockWasiInstance;
    });

    const memory = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(memory.buffer);

    originalFdReadSpy.mockImplementation((fd, iovs_ptr, iovs_len, nread_ptr) => {
      // Return 0 bytes (EOF)
      view.setUint32(nread_ptr, 0, true);
      return 0;
    });

    vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({
      instance: { exports: { memory, _start: vi.fn() } },
    } as unknown as WebAssembly.Instance);

    await runtimeInternals.executeWASI(new Uint8Array([]), [], [], [], onLog, controller.signal);

    const patchedFdRead = mockWasiInstance.wasiImport.fd_read as (
      fd: number,
      iovs_ptr: number,
      iovs_len: number,
      nread_ptr: number,
    ) => number;
    mockWasiInstance.inst = { exports: { memory } };

    // Request lots of iovs
    // Should stop after first batch returns 0 bytes
    const ret = patchedFdRead(1, 0, 2048, 0);

    expect(ret).toBe(0);
    expect(originalFdReadSpy).toHaveBeenCalledTimes(1); // Should break loop early
  });
});
