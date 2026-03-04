import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock fetch globally before import
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  useNetworkStatus,
  isTimeoutError,
  isNetworkError,
} from "@/hooks/use-network-status";

describe("useNetworkStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: browser thinks it is online, health check succeeds
    Object.defineProperty(navigator, "onLine", {
      value: true,
      writable: true,
      configurable: true,
    });
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Initialization ---

  it("should start with isOnline=true, wasOffline=false, lastOfflineAt=null", () => {
    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current.isOnline).toBe(true);
    expect(result.current.wasOffline).toBe(false);
    expect(result.current.lastOfflineAt).toBeNull();
  });

  // --- Online/offline events ---

  it("should set isOnline=true and wasOffline=true when online event fires", async () => {
    // First go offline (verified), then come back online
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useNetworkStatus());

    // Trigger offline event and allow the verify to resolve
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      // Allow the verifyOffline promise to resolve
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isOnline).toBe(false);

    // Now go online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.wasOffline).toBe(true);
  });

  it("should auto-clear wasOffline after 10 seconds", async () => {
    // Go offline first (verified)
    mockFetch.mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Come back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.wasOffline).toBe(true);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(result.current.wasOffline).toBe(false);
  });

  it("should NOT mark offline if health check succeeds (navigator.onLine lied)", async () => {
    // Health check succeeds despite offline event
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(0);
    });

    // Should still be online because verify returned false (not truly offline)
    expect(result.current.isOnline).toBe(true);
    expect(result.current.lastOfflineAt).toBeNull();
  });

  it("should set lastOfflineAt when going offline", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(() => useNetworkStatus());

    const beforeTime = new Date();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.lastOfflineAt).toBeInstanceOf(Date);
    expect(result.current.lastOfflineAt!.getTime()).toBeGreaterThanOrEqual(
      beforeTime.getTime()
    );
  });

  // --- Mount behavior when navigator.onLine is false ---

  it("should verify offline on mount when navigator.onLine is false", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });
    mockFetch.mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isOnline).toBe(false);
  });

  it("should stay online when navigator.onLine=false but health check succeeds", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useNetworkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isOnline).toBe(true);
  });

  // --- Cleanup ---

  it("should remove event listeners on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useNetworkStatus());
    unmount();

    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain("online");
    expect(removed).toContain("offline");
  });

  // --- Edge case: cancelled flag ---

  it("should not update state after unmount (cancelled flag)", async () => {
    // Make the verify take a long time
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), 5000);
        })
    );

    Object.defineProperty(navigator, "onLine", {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result, unmount } = renderHook(() => useNetworkStatus());

    // Unmount before verify resolves
    unmount();

    // Let the timer complete - should not throw
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // State should remain at initial value (no error)
    expect(result.current.isOnline).toBe(true);
  });
});

// --- isTimeoutError ---

describe("isTimeoutError", () => {
  it("should return true for DOMException with name TimeoutError", () => {
    const err = new DOMException("timeout", "TimeoutError");
    expect(isTimeoutError(err)).toBe(true);
  });

  it("should return true for TypeError with 'timeout' in message", () => {
    const err = new TypeError("The operation was timeout");
    expect(isTimeoutError(err)).toBe(true);
  });

  it("should return true for TypeError with 'timed out' in message", () => {
    const err = new TypeError("Request timed out");
    expect(isTimeoutError(err)).toBe(true);
  });

  it("should return true for DOMException AbortError with timeout message", () => {
    const err = new DOMException("The request timed out", "AbortError");
    expect(isTimeoutError(err)).toBe(true);
  });

  it("should return false for DOMException AbortError without timeout message", () => {
    const err = new DOMException("User aborted", "AbortError");
    expect(isTimeoutError(err)).toBe(false);
  });

  it("should return false for generic Error", () => {
    expect(isTimeoutError(new Error("something"))).toBe(false);
  });

  it("should return false for non-error values", () => {
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("timeout")).toBe(false);
    expect(isTimeoutError(42)).toBe(false);
  });
});

// --- isNetworkError ---

describe("isNetworkError", () => {
  it("should return true for TypeError with 'failed to fetch'", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("should return true for TypeError with 'network' in message", () => {
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
  });

  it("should return true for TypeError with 'load failed'", () => {
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("should return true for TypeError with 'networkerror'", () => {
    expect(isNetworkError(new TypeError("NetworkError when attempting"))).toBe(
      true
    );
  });

  it("should return true for TypeError with 'abort' in message", () => {
    expect(isNetworkError(new TypeError("The operation was abort"))).toBe(true);
  });

  it("should return true for TypeError with 'timeout' in message", () => {
    expect(isNetworkError(new TypeError("Request timeout"))).toBe(true);
  });

  it("should return true for TypeError with 'connection refused'", () => {
    expect(isNetworkError(new TypeError("Connection refused"))).toBe(true);
  });

  it("should return true for DOMException AbortError", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(isNetworkError(err)).toBe(true);
  });

  it("should return true for DOMException TimeoutError", () => {
    const err = new DOMException("Timeout", "TimeoutError");
    expect(isNetworkError(err)).toBe(true);
  });

  it("should return false for generic Error", () => {
    expect(isNetworkError(new Error("Something went wrong"))).toBe(false);
  });

  it("should return false for non-error values", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError("network error")).toBe(false);
  });
});
