"use client";

import { useState, useEffect, useRef } from "react";

// ────────────────────────────────────────────────────────────
// useAISearch — debounced hook that sends natural language queries
// (> 3 words) to the AI search endpoint and returns grouped results.
//
// Activates only when the input has more than 3 words to distinguish
// natural language queries from simple keyword navigation.
// ────────────────────────────────────────────────────────────

interface AISearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface AISearchResultGroup {
  type: string;
  label: string;
  items: AISearchResultItem[];
}

interface UseAISearchReturn {
  results: AISearchResultGroup[];
  isSearching: boolean;
  description: string;
}

/** Minimum word count to trigger AI search (natural language threshold) */
const MIN_WORD_COUNT = 4;
/** Minimum character count to trigger AI search */
const MIN_CHAR_COUNT = 10;
/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 500;

export function useAISearch(query: string): UseAISearchReturn {
  const [results, setResults] = useState<AISearchResultGroup[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [description, setDescription] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Only activate AI search when input looks like natural language
    const trimmed = query.trim();
    const wordCount = trimmed.split(/\s+/).length;

    if (wordCount < MIN_WORD_COUNT || trimmed.length < MIN_CHAR_COUNT) {
      setResults([]);
      setDescription("");
      return;
    }

    // Debounce to avoid hammering the API on every keystroke
    const timer = setTimeout(async () => {
      // Cancel any in-flight request before starting a new one
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsSearching(true);
      try {
        const res = await fetch("/api/ai/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setResults([]);
          setDescription("");
          return;
        }

        const data = await res.json();
        if (data.success) {
          setResults(data.results ?? []);
          setDescription(data.description ?? "");
        }
      } catch (error: unknown) {
        // AbortError is expected when a newer request supersedes this one
        if (error instanceof Error && error.name === "AbortError") return;
        setResults([]);
        setDescription("");
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query]);

  return { results, isSearching, description };
}
