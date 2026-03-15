"use client";

import { useState, useEffect, useCallback } from "react";
import { getUserFriendlyMessage } from "@/lib/error-messages";
import type { AnalyticsData } from "../_types";

interface UseAnalyticsReturn {
  analytics: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches and manages the salon analytics data displayed on the
 * "Dane salonu" dashboard tab.
 */
export function useAnalytics(): UseAnalyticsReturn {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/analytics");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac danych");
      }
      const json = await res.json();
      setAnalytics(json.analytics);
    } catch (e) {
      setError(
        getUserFriendlyMessage(
          e,
          "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return {
    analytics,
    loading,
    error,
    refresh: fetchAnalytics,
  };
}
