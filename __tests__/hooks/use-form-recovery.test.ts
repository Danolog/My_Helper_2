import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DRAFT_MAX_AGE_MS,
  NEVER_PERSIST_KEYS,
  sweepExpiredDrafts,
  useFormRecovery,
} from "@/hooks/use-form-recovery";

/**
 * Create a fully-controllable localStorage mock that replaces
 * window.localStorage. happy-dom's Storage.prototype cannot be
 * reliably spied on, so we swap the whole object instead.
 */
function createLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    store,
    mock: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((k) => delete store[k]);
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    } as unknown as Storage,
  };
}

const START = new Date("2026-03-10T08:00:00.000Z").getTime();
const MINUTE_MS = 60 * 1000;

/** Builds the stored draft envelope the hook writes. */
function envelope(data: Record<string, unknown>, savedAt: number = Date.now()): string {
  return JSON.stringify({ v: 1, savedAt, data });
}

/** Reads back the form data of a stored envelope. */
function storedData(raw: string | undefined): unknown {
  expect(raw).toBeDefined();
  const parsed = JSON.parse(raw as string) as { v: number; savedAt: number; data: unknown };
  expect(parsed.v).toBe(1);
  expect(typeof parsed.savedAt).toBe("number");
  return parsed.data;
}

function setLocalStorage(value: unknown) {
  Object.defineProperty(window, "localStorage", {
    value,
    writable: true,
    configurable: true,
  });
}

describe("useFormRecovery", () => {
  let lsMock: ReturnType<typeof createLocalStorageMock>;
  let originalLocalStorage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    lsMock = createLocalStorageMock();
    originalLocalStorage = window.localStorage;
    setLocalStorage(lsMock.mock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLocalStorage(originalLocalStorage);
  });

  // --- Initialization ---

  it("should initialize with wasRecovered=false and isDirty=false", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "test-form" })
    );

    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it("should provide all expected API methods", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "test-form" })
    );

    expect(typeof result.current.saveFormState).toBe("function");
    expect(typeof result.current.getRecoveredState).toBe("function");
    expect(typeof result.current.clearSavedForm).toBe("function");
    expect(typeof result.current.setDirty).toBe("function");
  });

  // --- Happy path: recovery from localStorage ---

  it("should recover state from localStorage on mount", () => {
    const savedData = { name: "John", email: "john@example.com" };
    lsMock.store["form_recovery_register"] = envelope(savedData);

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string; email: string }>({
        storageKey: "register",
      })
    );

    // The recovery useEffect runs synchronously in the test environment.
    // Flush any pending effects by advancing timers by 0.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(true);

    const recovered = result.current.getRecoveredState();
    expect(recovered).toEqual(savedData);
  });

  it("should not set wasRecovered if localStorage is empty", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "empty-form" })
    );

    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.getRecoveredState()).toBeNull();
  });

  // --- Saving form state (debounced) ---

  it("should save form state to localStorage after debounce", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "save-test" })
    );

    act(() => {
      result.current.saveFormState({ name: "Alice" });
    });

    // Not saved yet (debounce)
    expect(lsMock.store["form_recovery_save-test"]).toBeUndefined();

    // Advance past default debounce (500ms)
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(storedData(lsMock.store["form_recovery_save-test"])).toEqual({ name: "Alice" });
  });

  it("should store the time of the write as savedAt", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "saved-at" })
    );

    act(() => {
      result.current.saveFormState({ name: "Alice" });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const parsed = JSON.parse(lsMock.store["form_recovery_saved-at"] as string) as {
      savedAt: number;
    };
    expect(parsed.savedAt).toBe(START + 500);
  });

  it("should debounce multiple rapid saves", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "debounce-test" })
    );

    act(() => {
      result.current.saveFormState({ name: "A" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.saveFormState({ name: "AB" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current.saveFormState({ name: "ABC" });
    });

    // Only after the final debounce timeout does the last value get saved
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(storedData(lsMock.store["form_recovery_debounce-test"])).toEqual({ name: "ABC" });
  });

  it("should respect custom debounce delay", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({
        storageKey: "custom-debounce",
        debounceMs: 1000,
      })
    );

    act(() => {
      result.current.saveFormState({ name: "test" });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    // Not saved yet
    expect(lsMock.store["form_recovery_custom-debounce"]).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(storedData(lsMock.store["form_recovery_custom-debounce"])).toEqual({ name: "test" });
  });

  // --- Health data and free text are never persisted ---

  it("should list exactly the keys that are never persisted", () => {
    expect([...NEVER_PERSIST_KEYS]).toEqual(["allergies", "notes", "healthDataConsent"]);
  });

  it("should never write allergies, notes or healthDataConsent to localStorage", () => {
    const { result } = renderHook(() =>
      useFormRecovery<Record<string, unknown>>({ storageKey: "add-client-form" })
    );

    act(() => {
      result.current.saveFormState({
        firstName: "Anna",
        allergies: "lateks",
        notes: "ciaza, 2. trymestr",
        healthDataConsent: true,
      });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    const raw = lsMock.store["form_recovery_add-client-form"];
    expect(storedData(raw)).toEqual({ firstName: "Anna" });
    // No write at all may carry the values, including the raw string.
    for (const [, value] of vi.mocked(lsMock.mock.setItem).mock.calls) {
      expect(value).not.toContain("lateks");
      expect(value).not.toContain("trymestr");
      expect(value).not.toContain("healthDataConsent");
    }
  });

  it("should not save the excluded keys even when they are the only fields", () => {
    const { result } = renderHook(() =>
      useFormRecovery<Record<string, unknown>>({ storageKey: "only-notes" })
    );

    act(() => {
      result.current.saveFormState({ notes: "alergia na orzechy" });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(storedData(lsMock.store["form_recovery_only-notes"])).toEqual({});
  });

  it("should drop excluded keys that appear in a stored envelope", () => {
    lsMock.store["form_recovery_tampered"] = envelope({ name: "Ola", allergies: "pylki" });

    const { result } = renderHook(() =>
      useFormRecovery<Record<string, unknown>>({ storageKey: "tampered" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.getRecoveredState()).toEqual({ name: "Ola" });
  });

  // --- 24-hour expiry ---

  it("should restore a draft saved 23:59 h ago", () => {
    lsMock.store["form_recovery_fresh"] = envelope({ name: "Ewa" });
    vi.setSystemTime(START + DRAFT_MAX_AGE_MS - MINUTE_MS);

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "fresh" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(true);
    expect(result.current.getRecoveredState()).toEqual({ name: "Ewa" });
    expect(lsMock.store["form_recovery_fresh"]).toBeDefined();
  });

  it("should remove a draft saved 24:01 h ago and not restore it", () => {
    lsMock.store["form_recovery_stale"] = envelope({ name: "Ewa" });
    vi.setSystemTime(START + DRAFT_MAX_AGE_MS + MINUTE_MS);

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "stale" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.getRecoveredState()).toBeNull();
    expect(lsMock.store["form_recovery_stale"]).toBeUndefined();
  });

  it("should treat a draft of exactly 24 h as expired", () => {
    lsMock.store["form_recovery_boundary"] = envelope({ name: "Ewa" });
    vi.setSystemTime(START + DRAFT_MAX_AGE_MS);

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "boundary" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(false);
    expect(lsMock.store["form_recovery_boundary"]).toBeUndefined();
  });

  it("should remove a draft whose savedAt lies in the future", () => {
    lsMock.store["form_recovery_future"] = envelope({ name: "Ewa" }, START + MINUTE_MS);

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "future" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(false);
    expect(lsMock.store["form_recovery_future"]).toBeUndefined();
  });

  // --- Legacy and malformed entries ---

  it("should remove a legacy draft without envelope and not restore it", () => {
    lsMock.store["form_recovery_legacy"] = JSON.stringify({ name: "John", notes: "x" });

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "legacy" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.getRecoveredState()).toBeNull();
    expect(lsMock.store["form_recovery_legacy"]).toBeUndefined();
  });

  it.each([
    ["unknown version", JSON.stringify({ v: 2, savedAt: START, data: { name: "x" } })],
    ["missing savedAt", JSON.stringify({ v: 1, data: { name: "x" } })],
    ["non-numeric savedAt", JSON.stringify({ v: 1, savedAt: "2026-03-10", data: { name: "x" } })],
    ["array data", JSON.stringify({ v: 1, savedAt: START, data: ["x"] })],
    ["null data", JSON.stringify({ v: 1, savedAt: START, data: null })],
    ["JSON array", JSON.stringify([1, 2])],
    ["JSON null", "null"],
    ["JSON string", JSON.stringify("text")],
  ])("should remove a malformed envelope (%s)", (_label, raw) => {
    lsMock.store["form_recovery_malformed"] = raw;

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "malformed" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(result.current.wasRecovered).toBe(false);
    expect(lsMock.store["form_recovery_malformed"]).toBeUndefined();
  });

  // --- Clearing saved form ---

  it("should clear localStorage and reset state on clearSavedForm()", () => {
    lsMock.store["form_recovery_clear-test"] = envelope({ name: "Old" });

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "clear-test" })
    );

    act(() => {
      result.current.setDirty(true);
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.clearSavedForm();
    });

    expect(result.current.isDirty).toBe(false);
    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.getRecoveredState()).toBeNull();
    expect(lsMock.store["form_recovery_clear-test"]).toBeUndefined();
  });

  it("should cancel pending debounced save on clearSavedForm()", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "cancel-save" })
    );

    act(() => {
      result.current.saveFormState({ name: "should not persist" });
    });

    act(() => {
      result.current.clearSavedForm();
    });

    // Even after debounce time passes, nothing should be saved
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lsMock.store["form_recovery_cancel-save"]).toBeUndefined();
  });

  // --- isDirty state ---

  it("should allow toggling isDirty via setDirty()", () => {
    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "dirty-test" })
    );

    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setDirty(true);
    });
    expect(result.current.isDirty).toBe(true);

    act(() => {
      result.current.setDirty(false);
    });
    expect(result.current.isDirty).toBe(false);
  });

  // --- beforeunload warning ---

  it("should register beforeunload handler when warnOnUnload is true (default)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "unload-test" })
    );

    const beforeUnloadCalls = addSpy.mock.calls.filter(
      ([type]) => type === "beforeunload"
    );
    expect(beforeUnloadCalls.length).toBeGreaterThan(0);
  });

  it("should NOT register beforeunload handler when warnOnUnload is false", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() =>
      useFormRecovery<{ name: string }>({
        storageKey: "no-unload",
        warnOnUnload: false,
      })
    );

    const beforeUnloadCalls = addSpy.mock.calls.filter(
      ([type]) => type === "beforeunload"
    );
    expect(beforeUnloadCalls.length).toBe(0);
  });

  // --- Error handling ---

  it("should remove invalid JSON in localStorage without throwing", () => {
    lsMock.store["form_recovery_bad-json"] = "not valid json{{{";

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "bad-json" })
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Should not crash, wasRecovered remains false
    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.getRecoveredState()).toBeNull();
    // Invalid data should be cleaned up
    expect(lsMock.mock.removeItem).toHaveBeenCalledWith("form_recovery_bad-json");
    expect(lsMock.store["form_recovery_bad-json"]).toBeUndefined();
  });

  it("should not throw when removing invalid JSON also fails", () => {
    lsMock.store["form_recovery_bad-json"] = "not valid json{{{";
    lsMock.mock.removeItem = vi.fn(() => {
      throw new Error("Storage error");
    });

    expect(() =>
      renderHook(() => useFormRecovery<{ name: string }>({ storageKey: "bad-json" }))
    ).not.toThrow();
  });

  it("should not throw when localStorage.getItem throws on mount", () => {
    lsMock.mock.getItem = vi.fn(() => {
      throw new DOMException("SecurityError");
    });

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "blocked" })
    );

    expect(result.current.wasRecovered).toBe(false);
  });

  it("should not throw when reading window.localStorage throws", () => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("SecurityError");
      },
      configurable: true,
    });

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "no-storage" })
    );

    expect(() => {
      act(() => {
        result.current.saveFormState({ name: "data" });
        vi.advanceTimersByTime(500);
        result.current.clearSavedForm();
      });
    }).not.toThrow();
    expect(result.current.wasRecovered).toBe(false);
  });

  it("should not crash when localStorage.setItem throws", () => {
    lsMock.mock.setItem = vi.fn(() => {
      throw new DOMException("QuotaExceededError");
    });

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "full-storage" })
    );

    act(() => {
      result.current.saveFormState({ name: "data" });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Should not throw — localStorage failure is handled silently
    expect(result.current.isDirty).toBe(false);
  });

  it("should handle localStorage.removeItem throwing silently in clearSavedForm", () => {
    lsMock.mock.removeItem = vi.fn(() => {
      throw new Error("Storage error");
    });

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "remove-error" })
    );

    // Should not throw
    expect(() => {
      act(() => {
        result.current.clearSavedForm();
      });
    }).not.toThrow();
  });

  // --- Edge cases ---

  it("should use the correct storage key prefix", () => {
    lsMock.store["form_recovery_my-key"] = envelope({ x: 1 });

    renderHook(() =>
      useFormRecovery<{ x: number }>({ storageKey: "my-key" })
    );

    expect(lsMock.mock.getItem).toHaveBeenCalledWith("form_recovery_my-key");
  });

  it("should clean up debounce timer on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "unmount-test" })
    );

    act(() => {
      result.current.saveFormState({ name: "pending" });
    });

    unmount();

    // Advance timers - should not throw or write to storage
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lsMock.store["form_recovery_unmount-test"]).toBeUndefined();
  });
});

describe("sweepExpiredDrafts", () => {
  let lsMock: ReturnType<typeof createLocalStorageMock>;
  let originalLocalStorage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    lsMock = createLocalStorageMock();
    originalLocalStorage = window.localStorage;
    setLocalStorage(lsMock.mock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLocalStorage(originalLocalStorage);
  });

  it("removes only expired, legacy and corrupted drafts and keeps other keys", () => {
    const now = START + DRAFT_MAX_AGE_MS + MINUTE_MS;
    lsMock.store["form_recovery_fresh"] = envelope({ a: 1 }, now - MINUTE_MS);
    lsMock.store["form_recovery_almost"] = envelope({ a: 1 }, now - DRAFT_MAX_AGE_MS + MINUTE_MS);
    lsMock.store["form_recovery_expired"] = envelope({ a: 1 }, START);
    lsMock.store["form_recovery_legacy"] = JSON.stringify({ name: "John" });
    lsMock.store["form_recovery_corrupt"] = "{{{";
    lsMock.store["form_recovery_future"] = envelope({ a: 1 }, now + MINUTE_MS);
    // Foreign keys, including ones that only resemble the prefix.
    lsMock.store["theme"] = "dark";
    lsMock.store["other_form_recovery_x"] = "{{{";
    lsMock.store["FORM_RECOVERY_upper"] = JSON.stringify({ name: "x" });

    sweepExpiredDrafts(now);

    expect(Object.keys(lsMock.store).sort()).toEqual(
      [
        "FORM_RECOVERY_upper",
        "form_recovery_almost",
        "form_recovery_fresh",
        "other_form_recovery_x",
        "theme",
      ].sort()
    );
  });

  it("uses the current time by default", () => {
    lsMock.store["form_recovery_expired"] = envelope({ a: 1 }, START);
    lsMock.store["form_recovery_fresh"] = envelope({ a: 1 }, START + DRAFT_MAX_AGE_MS);
    vi.setSystemTime(START + DRAFT_MAX_AGE_MS + MINUTE_MS);

    sweepExpiredDrafts();

    expect(Object.keys(lsMock.store)).toEqual(["form_recovery_fresh"]);
  });

  it("does nothing when there are no drafts", () => {
    lsMock.store["theme"] = "dark";

    sweepExpiredDrafts();

    expect(lsMock.mock.removeItem).not.toHaveBeenCalled();
    expect(lsMock.store).toEqual({ theme: "dark" });
  });

  it("does not throw when window.localStorage is missing", () => {
    setLocalStorage(undefined);

    expect(() => sweepExpiredDrafts()).not.toThrow();
  });

  it("does not throw when reading window.localStorage throws", () => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("SecurityError");
      },
      configurable: true,
    });

    expect(() => sweepExpiredDrafts()).not.toThrow();
  });

  it("does not throw when enumerating keys throws", () => {
    lsMock.store["form_recovery_legacy"] = JSON.stringify({ name: "x" });
    lsMock.mock.key = vi.fn(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => sweepExpiredDrafts()).not.toThrow();
  });

  it("removes an unreadable draft and keeps sweeping when one removal fails", () => {
    lsMock.store["form_recovery_unreadable"] = envelope({ a: 1 });
    lsMock.store["form_recovery_stuck"] = JSON.stringify({ name: "x" });
    lsMock.store["form_recovery_legacy"] = JSON.stringify({ name: "y" });

    const originalGet = lsMock.mock.getItem;
    lsMock.mock.getItem = vi.fn((key: string) => {
      if (key === "form_recovery_unreadable") throw new DOMException("SecurityError");
      return originalGet(key);
    });
    const originalRemove = lsMock.mock.removeItem;
    lsMock.mock.removeItem = vi.fn((key: string) => {
      if (key === "form_recovery_stuck") throw new DOMException("QuotaExceededError");
      originalRemove(key);
    });

    expect(() => sweepExpiredDrafts()).not.toThrow();
    expect(Object.keys(lsMock.store)).toEqual(["form_recovery_stuck"]);
  });
});
