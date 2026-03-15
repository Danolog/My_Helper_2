"use client";

import { useState, useEffect, useCallback } from "react";
import type { TrendsData } from "../_types";

interface UseTrendsDataReturn {
  data: TrendsData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches and manages the business trends data displayed across
 * overview, details, and insights tabs.
 */
export function useTrendsData(): UseTrendsDataReturn {
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/trends", signal ? { signal } : {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch trends");
      }
      const json = await res.json();
      if (!signal?.aborted) setData(json.data);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!signal?.aborted) setError("Nie udalo sie zaladowac danych. Sprobuj ponownie pozniej.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrends(controller.signal);
    return () => controller.abort();
  }, [fetchTrends]);

  return {
    data,
    loading,
    error,
    refresh: fetchTrends,
  };
}
