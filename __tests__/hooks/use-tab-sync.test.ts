import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabSync } from "@/hooks/use-tab-sync";

/**
 * Minimal BroadcastChannel mock so we can control message delivery
 * and verify postMessage calls in tests.
 */
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    // Deliver to all OTHER instances with the same channel name
    MockBroadcastChannel.instances
      .filter((ch) => ch !== this && ch.name === this.name && !ch.closed)
      .forEach((ch) => {
        if (ch.onmessage) {
          ch.onmessage(new MessageEvent("message", { data }));
        }
      });
  }

  close() {
    this.closed = true;
  }

  static reset() {
    MockBroadcastChannel.instances = [];
  }
}

describe("useTabSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockBroadcastChannel.reset();
    // Provide the mock BroadcastChannel globally
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // --- Initialization ---

  it("should return notifyChange function", () => {
    const onRefetch = vi.fn();
    const { result } = renderHook(() => useTabSync("clients", onRefetch));

    expect(typeof result.current.notifyChange).toBe("function");
  });

  it("should create a BroadcastChannel on mount", () => {
    const onRefetch = vi.fn();
    renderHook(() => useTabSync("clients", onRefetch));

    expect(MockBroadcastChannel.instances.length).toBeGreaterThanOrEqual(1);
    const channel = MockBroadcastChannel.instances[0]!;
    expect(channel.name).toBe("myhelper-tab-sync");
  });

  // --- Cross-tab messaging ---

  it("should call onRefetch when another tab sends a change for the same resource", () => {
    const onRefetch1 = vi.fn();
    const onRefetch2 = vi.fn();

    // Simulate two tabs: both listening for "clients"
    const { result: tab1 } = renderHook(() =>
      useTabSync("clients", onRefetch1)
    );
    renderHook(() => useTabSync("clients", onRefetch2));

    // Tab1 notifies a change
    act(() => {
      tab1.current.notifyChange();
    });

    // Tab2 should have received the change and called its refetch
    expect(onRefetch2).toHaveBeenCalledOnce();
    // Tab1 should NOT call its own refetch (same tab filter)
    expect(onRefetch1).not.toHaveBeenCalled();
  });

  it("should NOT call onRefetch for a different resource", () => {
    const clientsRefetch = vi.fn();
    const servicesRefetch = vi.fn();

    const { result: clientsTab } = renderHook(() =>
      useTabSync("clients", clientsRefetch)
    );
    renderHook(() => useTabSync("services", servicesRefetch));

    act(() => {
      clientsTab.current.notifyChange();
    });

    // Services tab should not be notified about clients changes
    expect(servicesRefetch).not.toHaveBeenCalled();
  });

  // --- Visibility change ---

  it("should refetch on tab visibility change after more than 5 seconds", () => {
    vi.useFakeTimers();
    const onRefetch = vi.fn();

    renderHook(() => useTabSync("appointments", onRefetch));

    // Simulate: tab hidden for 6 seconds, then becomes visible
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onRefetch).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("should NOT refetch on tab visibility change within 5 seconds", () => {
    vi.useFakeTimers();
    const onRefetch = vi.fn();

    renderHook(() => useTabSync("appointments", onRefetch));

    // Immediately make visible (lastFetchRef was just set on mount)
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onRefetch).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // --- Cleanup ---

  it("should close the BroadcastChannel on unmount", () => {
    const onRefetch = vi.fn();
    const { unmount } = renderHook(() => useTabSync("clients", onRefetch));

    const channel = MockBroadcastChannel.instances[0]!;
    expect(channel.closed).toBe(false);

    unmount();

    expect(channel.closed).toBe(true);
  });

  it("should remove visibilitychange listener on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const onRefetch = vi.fn();

    const { unmount } = renderHook(() => useTabSync("clients", onRefetch));
    unmount();

    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain("visibilitychange");
  });

  // --- Edge cases ---

  it("should handle BroadcastChannel not being available", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    const onRefetch = vi.fn();

    // Should not throw
    expect(() => {
      renderHook(() => useTabSync("clients", onRefetch));
    }).not.toThrow();
  });

  it("should handle BroadcastChannel constructor throwing", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("SecurityError");
        }
      }
    );

    const onRefetch = vi.fn();

    // Should not throw
    expect(() => {
      renderHook(() => useTabSync("clients", onRefetch));
    }).not.toThrow();
  });

  it("should handle postMessage throwing gracefully", () => {
    const onRefetch = vi.fn();
    const { result } = renderHook(() => useTabSync("clients", onRefetch));

    // Sabotage the channel
    const channel = MockBroadcastChannel.instances[0]!;
    channel.postMessage = () => {
      throw new Error("Channel closed");
    };

    // Should not throw
    expect(() => {
      act(() => {
        result.current.notifyChange();
      });
    }).not.toThrow();
  });

  it("should update lastFetchRef when notifyChange is called", () => {
    vi.useFakeTimers();
    const onRefetch = vi.fn();

    const { result } = renderHook(() =>
      useTabSync("clients", onRefetch)
    );

    // Advance time, then notify change
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    act(() => {
      result.current.notifyChange();
    });

    // Immediately check visibility - should NOT refetch because
    // lastFetchRef was just updated by notifyChange
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onRefetch).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
