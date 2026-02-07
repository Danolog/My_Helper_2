"use client";

import { useDraggable } from "@/hooks/use-draggable";
import type { CalendarEvent } from "@/types/calendar";

interface CalendarEventProps {
  event: CalendarEvent;
  onDragStart: (event: CalendarEvent) => void;
  onDragEnd: () => void;
  onClick: (event: CalendarEvent) => void;
  colorMode?: "employee" | "status"; // Color by employee or by status
}

// Status-based color scheme
const STATUS_COLORS = {
  scheduled: {
    bg: "#f59e0b", // Amber - pending/scheduled
    border: "#d97706",
    text: "white",
  },
  confirmed: {
    bg: "#3b82f6", // Blue - confirmed
    border: "#2563eb",
    text: "white",
  },
  completed: {
    bg: "#10b981", // Green - completed
    border: "#059669",
    text: "white",
  },
  cancelled: {
    bg: "#9ca3af", // Gray - cancelled
    border: "#6b7280",
    text: "white",
    striped: true,
  },
  no_show: {
    bg: "#ef4444", // Red - no show
    border: "#dc2626",
    text: "white",
  },
};

// Status labels for display
const STATUS_LABELS = {
  scheduled: "Zaplanowana",
  confirmed: "Potwierdzona",
  completed: "Zakonczona",
  cancelled: "Anulowana",
  no_show: "Niestawienie sie",
};

export function CalendarEventComponent({
  event,
  onDragStart,
  onDragEnd,
  onClick,
  colorMode = "status",
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

  // Get color based on mode
  const status = event.appointment.status || "scheduled";
  const statusColors = STATUS_COLORS[status] || STATUS_COLORS.scheduled;

  const backgroundColor = colorMode === "status"
    ? statusColors.bg
    : (event.employeeColor || "#3b82f6");

  const borderColor = colorMode === "status"
    ? statusColors.border
    : backgroundColor;

  // Cancelled appointments have striped pattern
  const isCancelled = status === "cancelled";

  // Check if appointment is draggable (only scheduled or confirmed can be rescheduled)
  const isDraggable = status === "scheduled" || status === "confirmed";

  return (
    <div
      {...(isDraggable ? dragProps : {})}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      className={`
        absolute left-1 right-1 rounded-md px-2 py-1 text-xs overflow-hidden
        transition-all duration-200 border-l-4
        ${isDraggable ? "cursor-grab" : "cursor-pointer"}
        ${isDragging ? "opacity-50 cursor-grabbing shadow-lg scale-105 z-50" : "hover:shadow-md"}
        ${isCancelled ? "opacity-60" : ""}
      `}
      style={{
        backgroundColor,
        borderLeftColor: borderColor,
        color: statusColors.text,
        minHeight: Math.max(duration * 1.5, 24) + "px",
        backgroundImage: isCancelled
          ? "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.1) 5px, rgba(0,0,0,0.1) 10px)"
          : undefined,
      }}
      data-event-id={event.id}
      data-status={status}
    >
      <div className="flex items-center gap-1">
        <div className="font-medium truncate flex-1">{event.title}</div>
        {/* Status indicator dot for employee color mode */}
        {colorMode === "employee" && (
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: statusColors.bg }}
            title={STATUS_LABELS[status]}
          />
        )}
      </div>
      <div className="opacity-80 truncate">
        {formatTime(startTime)} - {formatTime(endTime)}
      </div>
      {event.appointment.client && (
        <div className="opacity-80 truncate">
          {event.appointment.client.firstName} {event.appointment.client.lastName}
        </div>
      )}
      {/* Show status label for cancelled/completed */}
      {(isCancelled || status === "completed" || status === "no_show") && (
        <div className="text-[10px] opacity-90 mt-0.5 font-medium uppercase tracking-wide">
          {STATUS_LABELS[status]}
        </div>
      )}
    </div>
  );
}

// Export status colors for legend component
export { STATUS_COLORS, STATUS_LABELS };
