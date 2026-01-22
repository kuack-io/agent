import { setupRuntimeTestEnvironment } from "./testUtils";
import { describe, it, expect, vi } from "vitest";

const env = setupRuntimeTestEnvironment();

describe("Runtime WASI limits", () => {
  it("patches fd_write to handle large iovec arrays by chunking", () => {
    const runtime = env.getRuntimeInternals();
    const originalFdWriteStub = vi
      .fn()
      .mockImplementation((_fd: number, _iovs_ptr: number, _iovs_len: number, _nwritten_ptr: number) => {
        // Simulate writing bytes
        // In real WASI, it writes to memory. We mock memory access too.
        return 0; // SUCCESS
      });

    // Mock WASI object
    const mockMemory = {
      buffer: new ArrayBuffer(1024),
    };
    const mockExports = {
      memory: mockMemory,
    };
    const mockInst = {
      exports: mockExports,
    };

    const mockWasi = {
      wasiImport: {
        fd_write: originalFdWriteStub,
        // Mock others to avoid crash in patchWasiImports
        fd_pwrite: vi.fn(),
        fd_read: vi.fn(),
        fd_pread: vi.fn(),
      },
      inst: mockInst,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any; // Cast to bypass types for verification

    // @ts-expect-error - Access private method for testing
    runtime.patchWasiImports(mockWasi);

    const patchedFdWrite = mockWasi.wasiImport.fd_write;
    expect(patchedFdWrite).not.toBe(originalFdWriteStub);

    // Test Case 1: Small write (< 1024) should pass through directly
    patchedFdWrite(1, 100, 500, 200);
    expect(originalFdWriteStub).toHaveBeenCalledWith(1, 100, 500, 200);
    expect(originalFdWriteStub).toHaveBeenCalledTimes(1);

    originalFdWriteStub.mockClear();

    // Test Case 2: Large write (> 1024) should be chunked
    // Mock memory to allow DataView reads/writes
    // The patch reads 'nwritten' from memory after internal call.
    // We need to ensure originalFdWriteStub doesn't crash, and we need to put something in memory if we want to check total.
    // But patching logic:
    //   call original
    //   read nwritten from memory (written by original)
    //   accumulate
    //   write total to memory

    // We need 'originalFdWriteStub' to write 'nwritten' to memory.
    originalFdWriteStub.mockImplementation((_fd, _iovs_ptr, iovs_len, nwritten_ptr) => {
      const view = new DataView(mockMemory.buffer);
      view.setUint32(nwritten_ptr, iovs_len * 10, true); // Fake 10 bytes per iovec
      return 0;
    });

    const totalIovecs = 2500;
    // Expected chunks: 1024, 1024, 452

    patchedFdWrite(1, 0, totalIovecs, 400); // nwritten_ptr at 400

    expect(originalFdWriteStub).toHaveBeenCalledTimes(3);

    // Check call arguments
    const calls = originalFdWriteStub.mock.calls;
    // Call 1: 1024
    expect(calls[0][2]).toBe(1024);
    // Call 2: 1024
    expect(calls[1][2]).toBe(1024);
    // Call 3: 452
    expect(calls[2][2]).toBe(452);

    // Check pointers (offset by 8 bytes per iovec)
    // Call 1: ptr=0
    expect(calls[0][1]).toBe(0);
    // Call 2: ptr=0 + 1024*8 = 8192
    expect(calls[1][1]).toBe(8192);
    // Call 3: ptr=8192 + 1024*8 = 16384
    expect(calls[2][1]).toBe(16384);

    // Check total written
    const view = new DataView(mockMemory.buffer);
    const totalWritten = view.getUint32(400, true);
    // 2500 * 10 = 25000
    expect(totalWritten).toBe(25000);
  });

  it("patches fd_pwrite to handle large iovec arrays by chunking", () => {
    const runtime = env.getRuntimeInternals();
    const originalFdPwriteStub = vi.fn().mockImplementation(
      (_fd: number, _iovs_ptr: number, _iovs_len: number, _offset: bigint, _nwritten_ptr: number) => {
        return 0; // SUCCESS
      },
    );

    const mockMemory = { buffer: new ArrayBuffer(1024) };
    const mockWasi = {
      wasiImport: {
        fd_write: vi.fn(),
        fd_pwrite: originalFdPwriteStub,
        fd_read: vi.fn(),
        fd_pread: vi.fn(),
      },
      inst: { exports: { memory: mockMemory } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    // @ts-expect-error - Access private method
    runtime.patchWasiImports(mockWasi);

    const patchedFdPwrite = mockWasi.wasiImport.fd_pwrite;
    const totalIovecs = 2500;

    originalFdPwriteStub.mockImplementation((_fd, _iovs_ptr, iovs_len, _offset, nwritten_ptr) => {
      const view = new DataView(mockMemory.buffer);
      view.setUint32(nwritten_ptr, iovs_len * 10, true);
      return 0;
    });

    patchedFdPwrite(1, 0, totalIovecs, 0n, 400);

    expect(originalFdPwriteStub).toHaveBeenCalledTimes(3);
    const calls = originalFdPwriteStub.mock.calls;
    expect(calls[0][2]).toBe(1024);
    expect(calls[1][2]).toBe(1024);
    expect(calls[2][2]).toBe(452);

    // Validate offset increments (simulated 10 bytes per iovec)
    // Call 1: offset 0. Written 1024*10 = 10240
    // Call 2: offset 10240. Written 1024*10 = 10240
    // Call 3: offset 20480.
    expect(calls[0][3]).toBe(0n);
    expect(calls[1][3]).toBe(10240n);
    expect(calls[2][3]).toBe(20480n);
  });
});
