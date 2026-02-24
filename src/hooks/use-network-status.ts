"use client";

import { useState, useEffect, useCallback } from "react";

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastOfflineAt: Date | null;
}

/**
 * Performs an HTTP connectivity check to verify whether the browser
 * is truly offline. navigator.onLine is unreliable and can report
 * false negatives (saying offline when the user is actually online).
 *
 * Returns true if the user is actually offline (fetch failed).
 * Returns false if the user is online (fetch succeeded).
 */
async function verifyOffline(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    // If we got any response (even error), the network is reachable
    return false;
  } catch {
    // Fetch failed entirely -- genuinely offline or server unreachable
    return true;
  }
}

/**
 * Hook that monitors browser online/offline status.
 * Provides current status and tracks if user was recently offline.
 *
 * Uses navigator.onLine events as a fast signal, but verifies with
 * an HTTP ping before declaring the user offline. This prevents
 * false "offline" banners caused by unreliable browser APIs.
 */
export function useNetworkStatus(): NetworkStatus {
  // Always start as online to avoid false offline banners during SSR/hydration.
  // The offline state is only set after verified HTTP check.
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOfflineAt, setLastOfflineAt] = useState<Date | null>(null);

  const markOffline = useCallback(() => {
    setIsOnline(false);
    setLastOfflineAt(new Date());
  }, []);

  const markOnline = useCallback(() => {
    setIsOnline(true);
    setWasOffline(true);
    // Auto-clear the "was offline" flag after 10 seconds
    setTimeout(() => setWasOffline(false), 10000);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleOnline = () => {
      if (!cancelled) {
        markOnline();
      }
    };

    const handleOffline = async () => {
      // navigator.onLine reported offline, but verify with an actual HTTP request
      // before showing the banner. This prevents false positives.
      const trulyOffline = await verifyOffline();
      if (cancelled) return;

      if (trulyOffline) {
        markOffline();
      }
      // If the ping succeeded, the user is actually online -- do nothing
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // On mount, if navigator.onLine is false, verify before declaring offline
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      verifyOffline().then((trulyOffline) => {
        if (cancelled) return;
        if (trulyOffline) {
          markOffline();
        } else {
          // navigator.onLine lied -- we're actually online
          setIsOnline(true);
        }
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [markOffline, markOnline]);

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
