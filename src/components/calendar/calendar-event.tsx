"use client";

import { useDraggable } from "@/hooks/use-draggable";
import type { CalendarEvent } from "@/types/calendar";

interface CalendarEventProps {
  event: CalendarEvent;
  onDragStart: (event: CalendarEvent) => void;
  onDragEnd: () => void;
  onClick: (event: CalendarEvent) => void;
}

export function CalendarEventComponent({
  event,
  onDragStart,
  onDragEnd,
  onClick,
}: CalendarEventProps) {
  const { isDragging, dragProps } = useDraggable({
    onDragStart: () => onDragStart(event),
    onDragEnd: () => onDragEnd(),
  });

  const startTime = new Date(event.start);
  const endTime = new Date(event.end);
  const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60); // minutes

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      {...dragProps}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      className={`
        absolute left-1 right-1 rounded-md px-2 py-1 text-xs cursor-grab overflow-hidden
        transition-all duration-200
        ${isDragging ? "opacity-50 cursor-grabbing shadow-lg scale-105 z-50" : "hover:shadow-md"}
      `}
      style={{
        backgroundColor: event.employeeColor || "#3b82f6",
        color: "white",
        minHeight: Math.max(duration * 1.5, 24) + "px",
      }}
      data-event-id={event.id}
    >
      <div className="font-medium truncate">{event.title}</div>
      <div className="opacity-80 truncate">
        {formatTime(startTime)} - {formatTime(endTime)}
      </div>
      {event.appointment.client && (
        <div className="opacity-80 truncate">
          {event.appointment.client.firstName} {event.appointment.client.lastName}
        </div>
      )}
    </div>
  );
}
