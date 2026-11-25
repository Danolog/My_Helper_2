"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { logger } from "@/lib/logger";

const STORAGE_PREFIX = "form_recovery_";
const DEBOUNCE_MS = 500;

/** Version tag of the stored draft envelope. Anything else is discarded. */
const DRAFT_ENVELOPE_VERSION = 1;

/**
 * Maximum age of a stored draft. The privacy policy promises that a form
 * draft left in the browser is gone after 24 hours at the latest, so a draft
 * of exactly this age is already treated as expired.
 */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Top-level form keys that are never written to localStorage, whatever form
 * uses the hook. They can hold health information or free text about a
 * client, which must not outlive the session on a shared salon device.
 */
export const NEVER_PERSIST_KEYS: readonly string[] = ["allergies", "notes", "healthDataConsent"];

interface DraftEnvelope {
  v: typeof DRAFT_ENVELOPE_VERSION;
  /** Epoch milliseconds of the last save. */
  savedAt: number;
  data: Record<string, unknown>;
}

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
  /**
   * Get the recovered form state (or null if none). Keys listed in
   * NEVER_PERSIST_KEYS are never present, so callers must fall back to a
   * default for them.
   */
  getRecoveredState: () => T | null;
  /** Clear saved form state (call on successful submit or cancel) */
  clearSavedForm: () => void;
  /** Mark the form as dirty (has unsaved changes) */
  setDirty: (dirty: boolean) => void;
}

/**
 * Returns localStorage, or null when it is unavailable. Merely reading
 * `window.localStorage` throws a SecurityError when site data is blocked.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing more can be done when the storage refuses the removal.
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripNeverPersistKeys(state: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!NEVER_PERSIST_KEYS.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Parses a stored draft and returns its form data, or null when the entry
 * must be discarded: corrupted JSON, the legacy format without an envelope,
 * an unknown version, or a draft that is expired. A `savedAt` in the future
 * (clock moved back) is also rejected, otherwise the draft could outlive the
 * 24-hour limit.
 */
function readDraftData(raw: string, now: number): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;

  const { v, savedAt, data } = parsed as Partial<DraftEnvelope>;
  if (v !== DRAFT_ENVELOPE_VERSION) return null;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  if (!isPlainObject(data)) return null;

  const age = now - savedAt;
  if (age < 0 || age >= DRAFT_MAX_AGE_MS) return null;

  // Defence in depth: the data was stripped on save, strip it again on read.
  return stripNeverPersistKeys(data);
}

/**
 * Removes every form draft that is expired, corrupted or stored in the legacy
 * format. A draft is otherwise removed only when its form mounts again, so
 * this runs at application start and periodically afterwards (see SwRegister)
 * to keep the 24-hour limit for forms the user never reopens. Keys outside the form-recovery prefix are left alone.
 * Never throws: storage may be missing, blocked or failing.
 */
export function sweepExpiredDrafts(now: number = Date.now()): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    // Collect keys first: removing while iterating by index shifts indices.
    const draftKeys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) {
        draftKeys.push(key);
      }
    }

    for (const key of draftKeys) {
      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        // Unreadable entry: try to remove it below.
      }
      if (raw === null || readDraftData(raw, now) === null) {
        safeRemove(storage, key);
      }
    }
  } catch {
    // Storage enumeration failed; the per-form check on mount still applies.
  }
}

/**
 * Hook for form recovery after page refresh.
 *
 * Features:
 * - Saves form state to localStorage with debouncing, inside a versioned
 *   envelope `{ v, savedAt, data }`
 * - Never stores the keys listed in NEVER_PERSIST_KEYS
 * - Restores form state from localStorage on mount if the draft is younger
 *   than 24 hours; expired, legacy and corrupted drafts are removed
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const storage = getStorage();
    if (!storage) return undefined;

    let saved: string | null = null;
    try {
      saved = storage.getItem(fullKey);
    } catch {
      // Storage unreadable (private mode, blocked site data): nothing to recover.
      return undefined;
    }

    if (saved !== null) {
      const data = readDraftData(saved, Date.now());
      if (data === null) {
        safeRemove(storage, fullKey);
      } else {
        // Keys from NEVER_PERSIST_KEYS are absent at runtime; the cast keeps
        // the public signature, and callers default missing fields.
        recoveredStateRef.current = data as T;
        // setState odroczony do callbacku timera — synchroniczny setState w
        // ciele efektu kaskaduje re-render (react-hooks/set-state-in-effect).
        timer = setTimeout(() => setWasRecovered(true), 0);
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
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
        // savedAt is taken when the write happens, so the 24-hour limit
        // counts from the last change actually stored.
        const envelope: DraftEnvelope = {
          v: DRAFT_ENVELOPE_VERSION,
          savedAt: Date.now(),
          data: stripNeverPersistKeys(state),
        };
        try {
          const storage = getStorage();
          if (!storage) return;
          storage.setItem(fullKey, JSON.stringify(envelope));
        } catch (e) {
          // Warn when localStorage is full or unavailable so the user knows
          // form recovery will not work. This is intentionally not silent
          // because a user could lose data on refresh without knowing.
          // localStorage may be full or unavailable — form recovery will not persist
          if (process.env.NODE_ENV === "development") {
            logger.warn("[useFormRecovery] Failed to save form state to localStorage", { error: e });
          }
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
    const storage = getStorage();
    if (storage) safeRemove(storage, fullKey);
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
