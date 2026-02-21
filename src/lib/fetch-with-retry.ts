import { isNetworkError, isTimeoutError } from "@/hooks/use-network-status";

interface FetchWithRetryOptions extends RequestInit {
  /** Maximum number of retry attempts (default: 2) */
  maxRetries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Timeout for each request in ms (default: 15000) */
  timeout?: number;
}

interface FetchResult<T> {
  data: T | null;
  error: string | null;
  isNetworkError: boolean;
  isTimeout?: boolean;
  retry: () => Promise<FetchResult<T>>;
}

/**
 * Network-aware fetch wrapper with automatic retry for network failures.
 *
 * Features:
 * - Detects network errors vs server errors
 * - Automatic retry with exponential backoff for network failures
 * - Timeout support
 * - Returns a retry function for manual retry
 */
export async function fetchWithRetry<T = unknown>(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<FetchResult<T>> {
  const {
    maxRetries = 2,
    retryDelay = 1000,
    timeout = 15000,
    ...fetchOptions
  } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Check if browser is offline before attempting
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new TypeError("Failed to fetch: browser is offline");
      }

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      return {
        data: data as T,
        error: null,
        isNetworkError: false,
        retry: () => fetchWithRetry<T>(url, options),
      };
    } catch (error) {
      lastError = error;

      // Only retry on network errors, not on server errors
      if (isNetworkError(error) && attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * Math.pow(2, attempt))
        );
        continue;
      }

      // No more retries or non-network error
      break;
    }
  }

  const networkErr = isNetworkError(lastError);
  const timeoutErr = isTimeoutError(lastError);

  return {
    data: null,
    error: timeoutErr
      ? "Serwer nie odpowiedzial w wymaganym czasie. Sprobuj ponownie pozniej."
      : networkErr
        ? "Brak polaczenia z serwerem. Sprawdz polaczenie internetowe i sprobuj ponownie."
        : lastError instanceof Error
          ? lastError.message
          : "Wystapil nieznany blad",
    isNetworkError: networkErr,
    isTimeout: timeoutErr,
    retry: () => fetchWithRetry<T>(url, options),
  };
}

/**
 * Returns a user-friendly error message for network failures.
 * Use this in catch blocks of existing fetch calls.
 * Distinguishes between timeout errors and other network errors.
 */
export function getNetworkErrorMessage(error: unknown): {
  message: string;
  isNetwork: boolean;
  isTimeout: boolean;
} {
  if (isTimeoutError(error)) {
    return {
      message:
        "Serwer nie odpowiedzial w wymaganym czasie. Sprobuj ponownie pozniej.",
      isNetwork: true,
      isTimeout: true,
    };
  }

  if (isNetworkError(error)) {
    return {
      message:
        "Brak polaczenia z serwerem. Sprawdz polaczenie internetowe i sprobuj ponownie.",
      isNetwork: true,
      isTimeout: false,
    };
  }

  return {
    message:
      error instanceof Error ? error.message : "Wystapil nieznany blad",
    isNetwork: false,
    isTimeout: false,
  };
}
