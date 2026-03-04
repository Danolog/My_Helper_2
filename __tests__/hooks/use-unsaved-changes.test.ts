import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

describe("useUnsavedChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset location for each test
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
        pathname: "/dashboard",
        search: "",
        href: "http://localhost:3000/dashboard",
      },
      writable: true,
      configurable: true,
    });
    // Mock history methods
    vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.spyOn(window.history, "go").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Initialization ---

  it("should start with showDialog=false and pendingUrl=null", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: false })
    );

    expect(result.current.showDialog).toBe(false);
    expect(result.current.pendingUrl).toBeNull();
  });

  it("should expose confirmNavigation and cancelNavigation functions", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: false })
    );

    expect(typeof result.current.confirmNavigation).toBe("function");
    expect(typeof result.current.cancelNavigation).toBe("function");
  });

  // --- beforeunload ---

  it("should register beforeunload handler when warnOnUnload=true (default)", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() => useUnsavedChanges({ isDirty: true }));

    const calls = addSpy.mock.calls.filter(([t]) => t === "beforeunload");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("should NOT register beforeunload handler when warnOnUnload=false", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() =>
      useUnsavedChanges({ isDirty: true, warnOnUnload: false })
    );

    const calls = addSpy.mock.calls.filter(([t]) => t === "beforeunload");
    expect(calls.length).toBe(0);
  });

  // --- Link click interception ---

  it("should show dialog when clicking a same-origin link while dirty", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    // Create a link element
    const link = document.createElement("a");
    link.href = "/settings";
    document.body.appendChild(link);

    // Dispatch a click event (capture phase)
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: link });

    act(() => {
      link.dispatchEvent(event);
    });

    expect(result.current.showDialog).toBe(true);
    expect(result.current.pendingUrl).toBe("/settings");

    document.body.removeChild(link);
  });

  it("should NOT intercept clicks when form is NOT dirty", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: false })
    );

    const link = document.createElement("a");
    link.href = "/settings";
    document.body.appendChild(link);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    act(() => {
      link.dispatchEvent(event);
    });

    expect(result.current.showDialog).toBe(false);

    document.body.removeChild(link);
  });

  it("should NOT intercept clicks on same-page hash links", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    const link = document.createElement("a");
    link.href = "/dashboard#section";
    document.body.appendChild(link);

    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    // Same pathname, so should not intercept
    expect(result.current.showDialog).toBe(false);

    document.body.removeChild(link);
  });

  it("should NOT intercept clicks with modifier keys (meta/ctrl)", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    const link = document.createElement("a");
    link.href = "/other";
    document.body.appendChild(link);

    // Click with metaKey (Cmd+click / open in new tab)
    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        })
      );
    });

    expect(result.current.showDialog).toBe(false);

    document.body.removeChild(link);
  });

  it("should NOT intercept clicks on target=_blank links", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    const link = document.createElement("a");
    link.href = "/external";
    link.target = "_blank";
    document.body.appendChild(link);

    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(result.current.showDialog).toBe(false);

    document.body.removeChild(link);
  });

  // --- Browser back/forward (popstate) ---

  it("should push sentinel history state when isDirty becomes true", () => {
    renderHook(() => useUnsavedChanges({ isDirty: true }));

    expect(window.history.pushState).toHaveBeenCalledWith(
      { unsavedChanges: true },
      "",
      "http://localhost:3000/dashboard"
    );
  });

  it("should show dialog on popstate when dirty", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.showDialog).toBe(true);
    expect(result.current.pendingUrl).toBe("__back__");
  });

  // --- cancelNavigation ---

  it("should close dialog and clear pendingUrl on cancelNavigation", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    // Trigger dialog via popstate
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.showDialog).toBe(true);

    act(() => {
      result.current.cancelNavigation();
    });

    expect(result.current.showDialog).toBe(false);
    expect(result.current.pendingUrl).toBeNull();
  });

  // --- confirmNavigation ---

  it("should call history.go(-2) on confirmNavigation for back button", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    // Trigger back button dialog
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    act(() => {
      result.current.confirmNavigation();
    });

    expect(result.current.showDialog).toBe(false);
    expect(window.history.go).toHaveBeenCalledWith(-2);
  });

  it("should navigate to pendingUrl on confirmNavigation for link click", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    // Trigger dialog via link click
    const link = document.createElement("a");
    link.href = "/new-page";
    document.body.appendChild(link);

    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(result.current.showDialog).toBe(true);

    act(() => {
      result.current.confirmNavigation();
    });

    expect(result.current.showDialog).toBe(false);
    // history.back() should be called to remove sentinel
    expect(window.history.back).toHaveBeenCalled();

    document.body.removeChild(link);
    vi.useRealTimers();
  });

  // --- Cleanup ---

  it("should remove event listeners on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const windowRemoveSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    unmount();

    const docRemoved = removeSpy.mock.calls.map(([t]) => t);
    const winRemoved = windowRemoveSpy.mock.calls.map(([t]) => t);

    expect(docRemoved).toContain("click");
    expect(winRemoved).toContain("beforeunload");
    expect(winRemoved).toContain("popstate");
  });

  // --- Edge cases ---

  it("should handle clicks on non-link elements (no-op)", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    const div = document.createElement("div");
    document.body.appendChild(div);

    act(() => {
      div.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(result.current.showDialog).toBe(false);

    document.body.removeChild(div);
  });

  it("should handle links without href attribute (no-op)", () => {
    const { result } = renderHook(() =>
      useUnsavedChanges({ isDirty: true })
    );

    const link = document.createElement("a");
    // No href attribute set
    document.body.appendChild(link);

    act(() => {
      link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(result.current.showDialog).toBe(false);

    document.body.removeChild(link);
  });
});
