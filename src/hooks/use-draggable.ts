"use client";

import { useState, useCallback, useRef } from "react";

interface UseDraggableOptions {
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function useDraggable(options: UseDraggableOptions = {}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent | React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      setIsDragging(true);

      if ("dataTransfer" in e) {
        // Native drag event
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", "");
      }

      if ("clientX" in e) {
        dragStartPos.current = { x: e.clientX, y: e.clientY };
      } else if ("touches" in e && e.touches.length > 0) {
        const touch = e.touches[0];
        if (touch) {
          dragStartPos.current = { x: touch.clientX, y: touch.clientY };
        }
      }

      options.onDragStart?.();
    },
    [options]
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent | React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      setIsDragging(false);
      dragStartPos.current = null;
      options.onDragEnd?.();
    },
    [options]
  );

  const dragProps = {
    draggable: true,
    onDragStart: handleDragStart as (e: React.DragEvent) => void,
    onDragEnd: handleDragEnd as (e: React.DragEvent) => void,
    onTouchStart: handleDragStart as (e: React.TouchEvent) => void,
    onTouchEnd: handleDragEnd as (e: React.TouchEvent) => void,
  };

  return {
    isDragging,
    dragProps,
    dragStartPos: dragStartPos.current,
  };
}
