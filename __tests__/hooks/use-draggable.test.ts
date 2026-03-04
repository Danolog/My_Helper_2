import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraggable } from "@/hooks/use-draggable";

/**
 * Creates a minimal synthetic DragEvent with the properties
 * the hook reads: stopPropagation, dataTransfer, clientX/clientY.
 */
function makeDragEvent(
  overrides: Partial<{
    clientX: number;
    clientY: number;
    dataTransfer: { effectAllowed: string; setData: (t: string, d: string) => void };
  }> = {}
) {
  return {
    stopPropagation: vi.fn(),
    dataTransfer: overrides.dataTransfer ?? {
      effectAllowed: "",
      setData: vi.fn(),
    },
    clientX: overrides.clientX ?? 100,
    clientY: overrides.clientY ?? 200,
  } as unknown as React.DragEvent;
}

/**
 * Creates a minimal synthetic TouchEvent with touches[0].
 */
function makeTouchEvent(
  overrides: Partial<{ clientX: number; clientY: number }> = {}
) {
  return {
    stopPropagation: vi.fn(),
    touches: [
      {
        clientX: overrides.clientX ?? 50,
        clientY: overrides.clientY ?? 75,
      },
    ],
  } as unknown as React.TouchEvent;
}

/**
 * Creates a minimal MouseEvent (no dataTransfer, has clientX/clientY).
 */
function makeMouseEvent(
  overrides: Partial<{ clientX: number; clientY: number }> = {}
) {
  return {
    stopPropagation: vi.fn(),
    clientX: overrides.clientX ?? 30,
    clientY: overrides.clientY ?? 40,
  } as unknown as React.MouseEvent;
}

describe("useDraggable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should return isDragging=false and dragStartPos=null on init", () => {
    const { result } = renderHook(() => useDraggable());

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dragStartPos).toBeNull();
  });

  it("should return dragProps with draggable=true and event handlers", () => {
    const { result } = renderHook(() => useDraggable());

    expect(result.current.dragProps.draggable).toBe(true);
    expect(typeof result.current.dragProps.onDragStart).toBe("function");
    expect(typeof result.current.dragProps.onDragEnd).toBe("function");
    expect(typeof result.current.dragProps.onTouchStart).toBe("function");
    expect(typeof result.current.dragProps.onTouchEnd).toBe("function");
  });

  // --- Happy path: native drag events ---

  it("should set isDragging=true on drag start (DragEvent)", () => {
    const { result } = renderHook(() => useDraggable());
    const event = makeDragEvent({ clientX: 10, clientY: 20 });

    act(() => {
      result.current.dragProps.onDragStart(event);
    });

    expect(result.current.isDragging).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("should set dataTransfer.effectAllowed to move on drag start", () => {
    const { result } = renderHook(() => useDraggable());
    const dt = { effectAllowed: "", setData: vi.fn() };
    const event = makeDragEvent({ clientX: 0, clientY: 0, dataTransfer: dt });

    act(() => {
      result.current.dragProps.onDragStart(event);
    });

    expect(dt.effectAllowed).toBe("move");
    expect(dt.setData).toHaveBeenCalledWith("text/plain", "");
  });

  it("should set isDragging=false on drag end", () => {
    const { result } = renderHook(() => useDraggable());

    act(() => {
      result.current.dragProps.onDragStart(makeDragEvent());
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      result.current.dragProps.onDragEnd(makeDragEvent());
    });
    expect(result.current.isDragging).toBe(false);
  });

  // --- Touch events ---

  it("should set isDragging=true on touch start", () => {
    const { result } = renderHook(() => useDraggable());
    const event = makeTouchEvent({ clientX: 50, clientY: 75 });

    act(() => {
      result.current.dragProps.onTouchStart(event);
    });

    expect(result.current.isDragging).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("should set isDragging=false on touch end", () => {
    const { result } = renderHook(() => useDraggable());

    act(() => {
      result.current.dragProps.onTouchStart(makeTouchEvent());
    });
    expect(result.current.isDragging).toBe(true);

    // Touch end events typically have no touches
    const endEvent = {
      stopPropagation: vi.fn(),
    } as unknown as React.TouchEvent;

    act(() => {
      result.current.dragProps.onTouchEnd(endEvent);
    });
    expect(result.current.isDragging).toBe(false);
  });

  // --- Mouse events (no dataTransfer) ---

  it("should handle mouse events without dataTransfer", () => {
    const { result } = renderHook(() => useDraggable());
    const event = makeMouseEvent({ clientX: 30, clientY: 40 });

    act(() => {
      // Cast needed because dragProps types expect DragEvent/TouchEvent
      (result.current.dragProps.onDragStart as (e: React.MouseEvent) => void)(
        event
      );
    });

    expect(result.current.isDragging).toBe(true);
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  // --- Callbacks ---

  it("should call onDragStart callback when drag begins", () => {
    const onDragStart = vi.fn();
    const { result } = renderHook(() => useDraggable({ onDragStart }));

    act(() => {
      result.current.dragProps.onDragStart(makeDragEvent());
    });

    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("should call onDragEnd callback when drag ends", () => {
    const onDragEnd = vi.fn();
    const { result } = renderHook(() => useDraggable({ onDragEnd }));

    act(() => {
      result.current.dragProps.onDragEnd(makeDragEvent());
    });

    expect(onDragEnd).toHaveBeenCalledOnce();
  });

  it("should call both callbacks for a full drag cycle", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const { result } = renderHook(() =>
      useDraggable({ onDragStart, onDragEnd })
    );

    act(() => {
      result.current.dragProps.onDragStart(makeDragEvent());
    });
    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragEnd).not.toHaveBeenCalled();

    act(() => {
      result.current.dragProps.onDragEnd(makeDragEvent());
    });
    expect(onDragEnd).toHaveBeenCalledOnce();
  });

  // --- Edge cases ---

  it("should work without any options", () => {
    const { result } = renderHook(() => useDraggable());

    // Should not throw
    act(() => {
      result.current.dragProps.onDragStart(makeDragEvent());
    });
    expect(result.current.isDragging).toBe(true);

    act(() => {
      result.current.dragProps.onDragEnd(makeDragEvent());
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("should reset dragStartPos to null on drag end", () => {
    const { result } = renderHook(() => useDraggable());

    act(() => {
      result.current.dragProps.onDragStart(makeDragEvent({ clientX: 5, clientY: 10 }));
    });

    // After drag end, dragStartPos should be null
    act(() => {
      result.current.dragProps.onDragEnd(makeDragEvent());
    });
    expect(result.current.dragStartPos).toBeNull();
  });

  it("should stop propagation on both start and end events", () => {
    const { result } = renderHook(() => useDraggable());

    const startEvent = makeDragEvent();
    const endEvent = makeDragEvent();

    act(() => {
      result.current.dragProps.onDragStart(startEvent);
    });
    expect(startEvent.stopPropagation).toHaveBeenCalled();

    act(() => {
      result.current.dragProps.onDragEnd(endEvent);
    });
    expect(endEvent.stopPropagation).toHaveBeenCalled();
  });
});
