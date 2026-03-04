import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the network status hooks
vi.mock("@/hooks/use-network-status", () => ({
  isNetworkError: vi.fn((error: unknown) => {
    if (error instanceof TypeError) {
      const msg = (error as TypeError).message.toLowerCase();
      return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("abort");
    }
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return true;
    }
    return false;
  }),
  isTimeoutError: vi.fn((error: unknown) => {
    if (error instanceof DOMException && error.name === "TimeoutError") return true;
    if (error instanceof TypeError && error.message.toLowerCase().includes("timeout")) return true;
    return false;
  }),
}));

import {
  getNetworkErrorMessage,
  fetchWithRetry,
} from "@/lib/fetch-with-retry";

describe("getNetworkErrorMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should identify timeout errors", () => {
    const error = new DOMException("Signal timed out", "TimeoutError");
    const result = getNetworkErrorMessage(error);
    expect(result.isNetwork).toBe(true);
    expect(result.isTimeout).toBe(true);
    expect(result.message).toContain("nie odpowiedzial");
  });

  it("should identify network errors", () => {
    const error = new TypeError("Failed to fetch");
    const result = getNetworkErrorMessage(error);
    expect(result.isNetwork).toBe(true);
    expect(result.isTimeout).toBe(false);
    expect(result.message).toContain("polaczenie");
  });

  it("should handle non-network Error objects", () => {
    const error = new Error("Some application error");
    const result = getNetworkErrorMessage(error);
    expect(result.isNetwork).toBe(false);
    expect(result.isTimeout).toBe(false);
    expect(result.message).toBe("Some application error");
  });

  it("should handle non-Error values", () => {
    const result = getNetworkErrorMessage("string error");
    expect(result.isNetwork).toBe(false);
    expect(result.isTimeout).toBe(false);
    expect(result.message).toBe("Wystapil nieznany blad");
  });

  it("should handle null/undefined", () => {
    const nullResult = getNetworkErrorMessage(null);
    expect(nullResult.isNetwork).toBe(false);
    expect(nullResult.message).toBe("Wystapil nieznany blad");

    const undefinedResult = getNetworkErrorMessage(undefined);
    expect(undefinedResult.isNetwork).toBe(false);
  });
});

describe("fetchWithRetry", () => {
  const TEST_URL = "https://api.example.com/data";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();

    // Default: navigator is online
    vi.stubGlobal("navigator", { onLine: true });
  });

  describe("success path", () => {
    it("should return data on successful fetch", async () => {
      const mockData = { id: 1, name: "test" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve(mockData),
        })
      );

      const result = await fetchWithRetry<{ id: number; name: string }>(
        TEST_URL
      );

      expect(result.data).toEqual(mockData);
      expect(result.error).toBeNull();
      expect(result.isNetworkError).toBe(false);
      expect(result.isTimeout).toBeUndefined();
      expect(typeof result.retry).toBe("function");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("should pass fetch options through to the underlying fetch call", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve({ ok: true }),
        })
      );

      await fetchWithRetry(TEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "value" }),
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe(TEST_URL);
      expect(callArgs[1]).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "value" }),
      });
      // Should also include an AbortController signal
      expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("browser offline", () => {
    it("should throw immediately when navigator.onLine is false", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      vi.stubGlobal("fetch", vi.fn());

      const result = await fetchWithRetry(TEST_URL);

      // fetch should never be called because the offline check happens first
      expect(fetch).not.toHaveBeenCalled();
      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
      expect(result.isNetworkError).toBe(true);
    });
  });

  describe("timeout", () => {
    it("should abort fetch when timeout expires", async () => {
      vi.useFakeTimers();

      // fetch that never resolves, simulating a hanging request
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          (_url: string, opts: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              opts.signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            })
        )
      );

      const fetchPromise = fetchWithRetry(TEST_URL, {
        timeout: 5000,
        maxRetries: 0,
      });

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(5001);

      const result = await fetchPromise;

      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
      // AbortError is classified as a network error by the mock
      expect(result.isNetworkError).toBe(true);
    });
  });

  describe("network error with retry", () => {
    it("should retry on network error and succeed on second attempt", async () => {
      vi.useFakeTimers();

      const mockData = { success: true };
      const networkError = new TypeError("Failed to fetch");

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(mockData),
          })
      );

      const fetchPromise = fetchWithRetry(TEST_URL, {
        maxRetries: 2,
        retryDelay: 1000,
      });

      // First retry delay: retryDelay * 2^0 = 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      const result = await fetchPromise;

      expect(result.data).toEqual(mockData);
      expect(result.error).toBeNull();
      expect(result.isNetworkError).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("should use exponential backoff between retries", async () => {
      vi.useFakeTimers();

      const networkError = new TypeError("Failed to fetch");
      const mockData = { recovered: true };

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockRejectedValueOnce(networkError) // attempt 0 fails
          .mockRejectedValueOnce(networkError) // attempt 1 fails
          .mockResolvedValueOnce({
            // attempt 2 succeeds
            json: () => Promise.resolve(mockData),
          })
      );

      const fetchPromise = fetchWithRetry(TEST_URL, {
        maxRetries: 2,
        retryDelay: 500,
      });

      // After attempt 0 failure: wait retryDelay * 2^0 = 500ms
      await vi.advanceTimersByTimeAsync(500);
      // After attempt 1 failure: wait retryDelay * 2^1 = 1000ms
      await vi.advanceTimersByTimeAsync(1000);

      const result = await fetchPromise;

      expect(result.data).toEqual(mockData);
      expect(result.error).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("network error exhausts retries", () => {
    it("should return network error after all retries are exhausted", async () => {
      vi.useFakeTimers();

      const networkError = new TypeError("Failed to fetch");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(networkError)
      );

      const fetchPromise = fetchWithRetry(TEST_URL, {
        maxRetries: 2,
        retryDelay: 1000,
      });

      // Attempt 0 fails -> wait 1000ms (1000 * 2^0)
      await vi.advanceTimersByTimeAsync(1000);
      // Attempt 1 fails -> wait 2000ms (1000 * 2^1)
      await vi.advanceTimersByTimeAsync(2000);
      // Attempt 2 fails -> no more retries, loop ends

      const result = await fetchPromise;

      expect(result.data).toBeNull();
      expect(result.isNetworkError).toBe(true);
      expect(result.isTimeout).toBe(false);
      expect(result.error).toContain("polaczenie");
      expect(fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
      expect(typeof result.retry).toBe("function");
    });
  });

  describe("non-network error", () => {
    it("should not retry on non-network errors and break immediately", async () => {
      const serverError = new Error("Internal Server Error");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(serverError)
      );

      const result = await fetchWithRetry(TEST_URL, { maxRetries: 2 });

      // Should not retry because isNetworkError returns false for generic Error
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.data).toBeNull();
      expect(result.isNetworkError).toBe(false);
      expect(result.isTimeout).toBe(false);
      expect(result.error).toBe("Internal Server Error");
    });

    it("should return generic message for non-Error thrown values", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue("string error")
      );

      const result = await fetchWithRetry(TEST_URL, { maxRetries: 0 });

      expect(result.data).toBeNull();
      expect(result.isNetworkError).toBe(false);
      expect(result.error).toBe("Wystapil nieznany blad");
    });
  });

  describe("custom options", () => {
    it("should respect maxRetries=0 and not retry at all", async () => {
      const networkError = new TypeError("Failed to fetch");

      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(networkError)
      );

      const result = await fetchWithRetry(TEST_URL, { maxRetries: 0 });

      // With maxRetries=0, loop runs once (attempt 0 only), then attempt < maxRetries
      // is false so it breaks without retrying
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.data).toBeNull();
      expect(result.isNetworkError).toBe(true);
    });

    it("should use custom timeout value", async () => {
      vi.useFakeTimers();

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          (_url: string, opts: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              opts.signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            })
        )
      );

      const fetchPromise = fetchWithRetry(TEST_URL, {
        timeout: 500,
        maxRetries: 0,
      });

      // Advance just past the custom 500ms timeout
      await vi.advanceTimersByTimeAsync(501);

      const result = await fetchPromise;

      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
    });

    it("should use custom retryDelay for backoff calculation", async () => {
      vi.useFakeTimers();

      const networkError = new TypeError("Failed to fetch");
      const mockData = { ok: true };

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(mockData),
          })
      );

      const fetchPromise = fetchWithRetry(TEST_URL, {
        maxRetries: 1,
        retryDelay: 200,
      });

      // Custom delay: 200 * 2^0 = 200ms
      await vi.advanceTimersByTimeAsync(200);

      const result = await fetchPromise;

      expect(result.data).toEqual(mockData);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("retry() function", () => {
    it("should return a working retry function on success result", async () => {
      const mockData1 = { attempt: 1 };
      const mockData2 = { attempt: 2 };

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce({
            json: () => Promise.resolve(mockData1),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve(mockData2),
          })
      );

      const result1 = await fetchWithRetry(TEST_URL);
      expect(result1.data).toEqual(mockData1);

      // Call the retry function to re-invoke fetchWithRetry with same args
      const result2 = await result1.retry();
      expect(result2.data).toEqual(mockData2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("should return a working retry function on error result", async () => {
      const serverError = new Error("Server error");
      const mockData = { recovered: true };

      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockRejectedValueOnce(serverError)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(mockData),
          })
      );

      const errorResult = await fetchWithRetry(TEST_URL, { maxRetries: 0 });
      expect(errorResult.data).toBeNull();
      expect(errorResult.error).toBe("Server error");

      // Use the retry function to try again -- this time it should succeed
      const retryResult = await errorResult.retry();
      expect(retryResult.data).toEqual(mockData);
      expect(retryResult.error).toBeNull();
    });
  });
});
