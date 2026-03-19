/**
 * Unit tests for the useAISearch hook.
 *
 * Tests cover:
 * - Query gating: does not search when query has <= 3 words or <= 10 chars
 * - Happy path: searches when query meets word count and character thresholds
 * - Debounce: waits 500ms before sending the request
 * - Abort: cancels previous request when query changes
 * - Error handling: clears results on failed fetch
 * - Cleanup: aborts in-flight request on unmount
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock fetch globally before importing the hook
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useAISearch } from "@/hooks/use-ai-search";

describe("useAISearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Query gating ---

  it("should not search when query has <= 3 words", () => {
    const { result } = renderHook(() => useAISearch("klienci dzisiaj tu"));

    // Even after advancing timers, fetch should NOT be called
    // because 3 words does not meet the MIN_WORD_COUNT of 4
    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.description).toBe("");
  });

  it("should not search when query has exactly 3 words", () => {
    const { result } = renderHook(() => useAISearch("wizyty na jutro"));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it("should not search when query is too short (< 10 chars even with enough words)", () => {
    // 4 words but only 7 characters (without spaces: "a b c d" = 7 chars total)
    const { result } = renderHook(() => useAISearch("a b c d"));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it("should not search when query is empty", () => {
    const { result } = renderHook(() => useAISearch(""));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  it("should not search when query is only whitespace", () => {
    const { result } = renderHook(() => useAISearch("   "));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
  });

  // --- Happy path ---

  it("should search when query has > 3 words and > 10 chars", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        results: [
          {
            type: "clients",
            label: "Klienci",
            items: [{ id: "1", title: "Anna Kowalska", subtitle: "tel: +48123", href: "/dashboard/clients/1" }],
          },
        ],
        description: "Klienci z wizytami dzisiaj",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { result } = renderHook(() =>
      useAISearch("pokaz klientow z wizytami dzisiaj"),
    );

    // Advance past the debounce delay
    await act(async () => {
      vi.advanceTimersByTime(500);
      // Allow the async fetch to resolve
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/ai/search",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]!.type).toBe("clients");
    expect(result.current.description).toBe("Klienci z wizytami dzisiaj");
  });

  // --- Debounce ---

  it("should debounce requests by 500ms", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        results: [],
        description: "test",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    renderHook(() => useAISearch("pokaz klientow z wizytami dzisiaj"));

    // At 200ms, fetch should NOT yet be called
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    // At 499ms, still not called
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(mockFetch).not.toHaveBeenCalled();

    // At 500ms, fetch should be called
    await act(async () => {
      vi.advanceTimersByTime(1);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // --- Cancel previous request ---

  it("should cancel previous request when query changes", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        results: [],
        description: "wynik",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { rerender } = renderHook(
      ({ query }: { query: string }) => useAISearch(query),
      { initialProps: { query: "pokaz wizyty na jutro rano" } },
    );

    // Advance partially, then change the query (simulates typing)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Change query — the previous timer should be cleared
    rerender({ query: "znajdz klientki z zeszlego tygodnia" });

    // Advance past debounce for the new query
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.advanceTimersByTimeAsync(0);
    });

    // Only the second query should have been fetched
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the body contains the second query
    const fetchCall = mockFetch.mock.calls[0]!;
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.query).toBe("znajdz klientki z zeszlego tygodnia");
  });

  // --- Error handling ---

  it("should clear results when fetch fails with non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: "Server error" }),
    });

    const { result } = renderHook(() =>
      useAISearch("pokaz klientow z wizytami dzisiaj"),
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.description).toBe("");
  });

  it("should handle fetch throwing an error gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const { result } = renderHook(() =>
      useAISearch("pokaz klientow z wizytami dzisiaj"),
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.results).toEqual([]);
    expect(result.current.description).toBe("");
  });

  // --- Cleanup on unmount ---

  it("should abort in-flight request on unmount", async () => {
    // Use a never-resolving promise to simulate an in-flight request
    mockFetch.mockImplementation(
      () => new Promise(() => {}),
    );

    const { unmount } = renderHook(() =>
      useAISearch("pokaz klientow z wizytami dzisiaj"),
    );

    // Start the fetch
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the abort signal was passed to fetch
    const fetchCall = mockFetch.mock.calls[0]!;
    const signal = fetchCall[1].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    // Unmount should abort the request
    unmount();
    expect(signal.aborted).toBe(true);
  });

  // --- Clearing results when query becomes too short ---

  it("should clear results when query goes from valid to too-short", async () => {
    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        results: [{ type: "clients", label: "Klienci", items: [{ id: "1", title: "T", subtitle: "", href: "/" }] }],
        description: "test",
      }),
    };
    mockFetch.mockResolvedValue(mockResponse);

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useAISearch(query),
      { initialProps: { query: "pokaz klientow z wizytami dzisiaj" } },
    );

    // Complete the first search
    await act(async () => {
      vi.advanceTimersByTime(500);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.results).toHaveLength(1);

    // Now change to a short query
    rerender({ query: "klienci" });

    // Results should be cleared immediately (no debounce needed)
    expect(result.current.results).toEqual([]);
    expect(result.current.description).toBe("");
  });
});
