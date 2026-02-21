"use client";

import { useEffect, useRef, useCallback, useState } from "react";

const STORAGE_PREFIX = "form_recovery_";
const DEBOUNCE_MS = 500;

interface FormRecoveryOptions {
  /** Unique key to identify this form in localStorage */
  storageKey: string;
  /** Whether to enable beforeunload warning when form is dirty */
  warnOnUnload?: boolean;
  /** Debounce delay in ms for saving to localStorage (default 500) */
  debounceMs?: number;
}

interface FormRecoveryResult<T extends Record<string, unknown>> {
  /** Whether saved form data was recovered from localStorage */
  wasRecovered: boolean;
  /** Whether the form has unsaved changes */
  isDirty: boolean;
  /** Save the current form state to localStorage */
  saveFormState: (state: T) => void;
  /** Get the recovered form state (or null if none) */
  getRecoveredState: () => T | null;
  /** Clear saved form state (call on successful submit or cancel) */
  clearSavedForm: () => void;
  /** Mark the form as dirty (has unsaved changes) */
  setDirty: (dirty: boolean) => void;
}

/**
 * Hook for form recovery after page refresh.
 *
 * Features:
 * - Saves form state to localStorage with debouncing
 * - Restores form state from localStorage on mount
 * - Shows browser beforeunload warning when form is dirty
 * - Provides clear function for submit/cancel cleanup
 *
 * Usage:
 * ```tsx
 * const { wasRecovered, getRecoveredState, saveFormState, clearSavedForm, isDirty, setDirty } =
 *   useFormRecovery<{ name: string; email: string }>({ storageKey: "registration-form" });
 *
 * // On mount, check for recovered state
 * useEffect(() => {
 *   if (wasRecovered) {
 *     const saved = getRecoveredState();
 *     if (saved) {
 *       setName(saved.name || "");
 *       setEmail(saved.email || "");
 *     }
 *   }
 * }, [wasRecovered]);
 *
 * // Save state on changes
 * useEffect(() => {
 *   saveFormState({ name, email });
 *   setDirty(!!name || !!email);
 * }, [name, email]);
 *
 * // Clear on submit
 * const handleSubmit = async () => {
 *   await submitForm();
 *   clearSavedForm();
 * };
 * ```
 */
export function useFormRecovery<T extends Record<string, unknown>>(
  options: FormRecoveryOptions
): FormRecoveryResult<T> {
  const { storageKey, warnOnUnload = true, debounceMs = DEBOUNCE_MS } = options;
  const fullKey = `${STORAGE_PREFIX}${storageKey}`;

  const [isDirty, setDirty] = useState(false);
  const [wasRecovered, setWasRecovered] = useState(false);
  const recoveredStateRef = useRef<T | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // On mount, check localStorage for saved form state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(fullKey);
      if (saved) {
        const parsed = JSON.parse(saved) as T;
        recoveredStateRef.current = parsed;
        setWasRecovered(true);
      }
    } catch {
      // Invalid data in localStorage, ignore
      localStorage.removeItem(fullKey);
    }
  }, [fullKey]);

  // Beforeunload warning when form is dirty
  useEffect(() => {
    if (!warnOnUnload) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent): string | void => {
      if (isDirtyRef.current) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but this triggers the dialog
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [warnOnUnload]);

  // Save form state to localStorage (debounced)
  const saveFormState = useCallback(
    (state: T) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(fullKey, JSON.stringify(state));
        } catch (e) {
          // Warn when localStorage is full or unavailable so the user knows
          // form recovery will not work. This is intentionally not silent
          // because a user could lose data on refresh without knowing.
          console.warn("Form recovery: nie udalo sie zapisac stanu formularza (localStorage moze byc pelny)", e);
        }
      }, debounceMs);
    },
    [fullKey, debounceMs]
  );

  // Get the recovered state
  const getRecoveredState = useCallback((): T | null => {
    return recoveredStateRef.current;
  }, []);

  // Clear saved form state
  const clearSavedForm = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    try {
      localStorage.removeItem(fullKey);
    } catch {
      // Silently fail
    }
    recoveredStateRef.current = null;
    setWasRecovered(false);
    setDirty(false);
  }, [fullKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    wasRecovered,
    isDirty,
    saveFormState,
    getRecoveredState,
    clearSavedForm,
    setDirty,
  };
}
