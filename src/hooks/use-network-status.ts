"use client";

import { useState, useEffect } from "react";

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastOfflineAt: Date | null;
}

/**
 * Hook that monitors browser online/offline status.
 * Provides current status and tracks if user was recently offline.
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Mark that user was offline (for recovery messages)
      setWasOffline(true);
      // Auto-clear the "was offline" flag after 10 seconds
      setTimeout(() => setWasOffline(false), 10000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastOfflineAt(new Date());
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { isOnline, wasOffline, lastOfflineAt };
}

/**
 * Checks if an error is specifically a timeout error.
 * Detects AbortSignal.timeout() errors and DOMException AbortError from timeout controllers.
 */
export function isTimeoutError(error: unknown): boolean {
  // AbortSignal.timeout() throws DOMException with name "TimeoutError"
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return true;
  }
  // Some browsers throw TypeError with "timeout" in the message
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return message.includes("timeout") || message.includes("timed out");
  }
  // AbortController.abort() can throw DOMException with name "AbortError"
  // When used with a timeout pattern, check the message
  if (error instanceof DOMException && error.name === "AbortError") {
    const message = error.message.toLowerCase();
    return message.includes("timeout") || message.includes("timed out");
  }
  return false;
}

/**
 * Checks if an error is a network-related error (including timeouts).
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return (
      message.includes("failed to fetch") ||
      message.includes("network") ||
      message.includes("load failed") ||
      message.includes("networkerror") ||
      message.includes("abort") ||
      message.includes("timeout") ||
      message.includes("connection refused")
    );
  }
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true;
  }
  return false;
}
