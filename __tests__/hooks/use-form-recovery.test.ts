import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormRecovery } from "@/hooks/use-form-recovery";

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

describe("useFormRecovery", () => {
  let lsMock: ReturnType<typeof createLocalStorageMock>;
  let originalLocalStorage: Storage;

  beforeEach(() => {
    vi.useFakeTimers();
    lsMock = createLocalStorageMock();
    originalLocalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: lsMock.mock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
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
    lsMock.store["form_recovery_register"] = JSON.stringify(savedData);

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

    expect(lsMock.store["form_recovery_save-test"]).toBe(
      JSON.stringify({ name: "Alice" })
    );
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

    expect(lsMock.store["form_recovery_debounce-test"]).toBe(
      JSON.stringify({ name: "ABC" })
    );
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
    expect(lsMock.store["form_recovery_custom-debounce"]).toBe(
      JSON.stringify({ name: "test" })
    );
  });

  // --- Clearing saved form ---

  it("should clear localStorage and reset state on clearSavedForm()", () => {
    lsMock.store["form_recovery_clear-test"] = JSON.stringify({
      name: "Old",
    });

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

  it("should handle invalid JSON in localStorage gracefully", () => {
    lsMock.store["form_recovery_bad-json"] = "not valid json{{{";

    const { result } = renderHook(() =>
      useFormRecovery<{ name: string }>({ storageKey: "bad-json" })
    );

    // Should not crash, wasRecovered remains false
    expect(result.current.wasRecovered).toBe(false);
    expect(result.current.getRecoveredState()).toBeNull();
    // Invalid data should be cleaned up
    expect(lsMock.mock.removeItem).toHaveBeenCalledWith(
      "form_recovery_bad-json"
    );
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
    lsMock.store["form_recovery_my-key"] = JSON.stringify({ x: 1 });

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
