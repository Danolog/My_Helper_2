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
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(null);

  useEffect(() => {
    // Set initial state from browser
    setIsOnline(navigator.onLine);

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
 * Checks if an error is a network-related error.
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
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return false;
}
