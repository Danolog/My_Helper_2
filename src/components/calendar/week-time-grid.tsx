"use client";

import { useMemo } from "react";
import { CalendarEventComponent } from "./calendar-event";
import { getBlockStyle } from "./calendar-constants";
import { getWeekDays, isSameDay } from "@/lib/date-utils";
import type { CalendarEvent, Employee, TimeBlock, TimeSlot, WorkSchedule } from "@/types/calendar";

interface WeekTimeGridProps {
  weekStart: Date;
  employees: Employee[];
  events: CalendarEvent[];
  workSchedules?: WorkSchedule[];
  timeBlocks?: TimeBlock[];
  onEventClick: (event: CalendarEvent) => void;
  onEventCancel?: (event: CalendarEvent) => void;
  onEventComplete?: (event: CalendarEvent) => void;
  onDayClick: (date: Date) => void;
  colorMode?: "employee" | "status";
  startHour?: number;
  endHour?: number;
  slotDuration?: number;
}

const DAY_NAMES = ["Pon", "Wt", "Sr", "Czw", "Pt", "Sob", "Ndz"];

export function WeekTimeGrid({
  weekStart,
  employees,
  events,
  workSchedules = [],
  timeBlocks = [],
  onEventClick,
  onEventCancel,
  onEventComplete,
  onDayClick,
  colorMode = "status",
  startHour = 8,
  endHour = 20,
  slotDuration = 30,
}: WeekTimeGridProps) {
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const today = useMemo(() => new Date(), []);

  // Generate time slots (shared for every day column)
  const timeSlots: TimeSlot[] = useMemo(() => {
    const slots: TimeSlot[] = [];
    const base = new Date(weekStart);
    base.setHours(startHour, 0, 0, 0);
    const end = new Date(weekStart);
    end.setHours(endHour, 0, 0, 0);

    let current = new Date(base);
    while (current < end) {
      slots.push({
        time: new Date(current),
        displayTime: current.toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
      current = new Date(current.getTime() + slotDuration * 60 * 1000);
    }
    return slots;
  }, [weekStart, startHour, endHour, slotDuration]);

  const slotHeight = (slotDuration / 30) * 40;

  // Group events by day
  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const ev of events) {
      const evStart = new Date(ev.start);
      for (let i = 0; i < 7; i++) {
        if (isSameDay(evStart, weekDays[i]!)) {
          map.get(i)!.push(ev);
          break;
        }
      }
    }
    return map;
  }, [events, weekDays]);

  // Group time blocks by day
  const blocksByDay = useMemo(() => {
    const map = new Map<number, TimeBlock[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);
    for (const block of timeBlocks) {
      const blockStart = new Date(block.startTime);
      const blockEnd = new Date(block.endTime);
      // A block may span multiple days
      for (let i = 0; i < 7; i++) {
        const dayStart = new Date(weekDays[i]!);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(weekDays[i]!);
        dayEnd.setHours(23, 59, 59, 999);
        if (blockStart <= dayEnd && blockEnd >= dayStart) {
          map.get(i)!.push(block);
        }
      }
    }
    return map;
  }, [timeBlocks, weekDays]);

  // Build a set of employeeIds that have any schedule defined
  const employeesWithSchedule = useMemo(() => {
    const s = new Set<string>();
    for (const ws of workSchedules) s.add(ws.employeeId);
    return s;
  }, [workSchedules]);

  // Check if a slot on a given day is outside all selected employees' working hours
  // When filtering a single employee — shade non-working slots
  // When "all" employees — no shading (different employees have different schedules)
  const isOutsideWorkingHours = (dayDate: Date, slotTime: Date): boolean => {
    if (employees.length !== 1) return false;
    const emp = employees[0]!;
    if (!employeesWithSchedule.has(emp.id)) return false;

    const dow = dayDate.getDay();
    const schedule = workSchedules.find(
      (s) => s.employeeId === emp.id && s.dayOfWeek === dow
    );
    if (!schedule) return true; // day off

    const h = slotTime.getHours();
    const m = slotTime.getMinutes();
    const slotStr = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    return slotStr < schedule.startTime || slotStr >= schedule.endTime;
  };

  // Overlap layout algorithm: assign column index to overlapping events
  const layoutEvents = (dayEvents: CalendarEvent[]) => {
    if (dayEvents.length === 0) return [];

    const sorted = [...dayEvents].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    type LayoutItem = {
      event: CalendarEvent;
      col: number;
      totalCols: number;
    };

    // Greedy interval-graph colouring
    const columns: { end: number }[] = [];
    const assignments: { event: CalendarEvent; col: number }[] = [];

    for (const ev of sorted) {
      const evStart = new Date(ev.start).getTime();
      const evEnd = new Date(ev.end).getTime();

      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        if (columns[c]!.end <= evStart) {
          columns[c]!.end = evEnd;
          assignments.push({ event: ev, col: c });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push({ end: evEnd });
        assignments.push({ event: ev, col: columns.length - 1 });
      }
    }

    const totalCols = columns.length;
    return assignments.map<LayoutItem>((a) => ({
      event: a.event,
      col: a.col,
      totalCols,
    }));
  };

  // Position helpers
  const getEventTop = (event: CalendarEvent, dayDate: Date) => {
    const evStart = new Date(event.start);
    const dayStart = new Date(dayDate);
    dayStart.setHours(startHour, 0, 0, 0);
    const minutesFromStart = (evStart.getTime() - dayStart.getTime()) / (1000 * 60);
    return (minutesFromStart / slotDuration) * slotHeight;
  };

  const getEventHeight = (event: CalendarEvent) => {
    const dur = (new Date(event.end).getTime() - new Date(event.start).getTime()) / (1000 * 60);
    return (dur / slotDuration) * slotHeight;
  };

  const getBlockPosition = (block: TimeBlock, dayDate: Date) => {
    const blockStart = new Date(block.startTime);
    const blockEnd = new Date(block.endTime);
    const dayStart = new Date(dayDate);
    dayStart.setHours(startHour, 0, 0, 0);
    const dayEnd = new Date(dayDate);
    dayEnd.setHours(endHour, 0, 0, 0);

    const visibleStart = blockStart < dayStart ? dayStart : blockStart;
    const visibleEnd = blockEnd > dayEnd ? dayEnd : blockEnd;

    const minutesFromStart = (visibleStart.getTime() - dayStart.getTime()) / (1000 * 60);
    const durationMinutes = (visibleEnd.getTime() - visibleStart.getTime()) / (1000 * 60);

    return {
      top: (minutesFromStart / slotDuration) * slotHeight,
      height: (durationMinutes / slotDuration) * slotHeight,
    };
  };

  // Noop drag handlers for CalendarEventComponent (drag disabled in week view)
  const noopDragStart = () => {};
  const noopDragEnd = () => {};

  return (
    <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-background">
      {/* Header row: time label + 7 day columns */}
      <div className="flex border-b border-border bg-muted/50 sticky top-0 z-10">
        <div className="w-16 flex-shrink-0 border-r border-border p-2 text-xs font-medium text-muted-foreground">
          Czas
        </div>
        {weekDays.map((day, i) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={i}
              className={`flex-1 min-w-[120px] border-r border-border last:border-r-0 p-2 text-sm font-medium cursor-pointer hover:bg-muted/80 transition-colors ${
                isToday ? "bg-primary/10" : ""
              }`}
              onClick={() => onDayClick(day)}
            >
              <div className={`text-center ${isToday ? "text-primary font-bold" : ""}`}>
                {DAY_NAMES[i]}
              </div>
              <div className={`text-center text-xs ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                {day.getDate()}.{String(day.getMonth() + 1).padStart(2, "0")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid body */}
      <div className="flex flex-1 overflow-auto">
        {/* Time labels */}
        <div className="w-16 flex-shrink-0 border-r border-border">
          {timeSlots.map((slot, idx) => (
            <div
              key={idx}
              className="border-b border-border last:border-b-0 px-2 py-1 text-xs text-muted-foreground text-right"
              style={{ height: slotHeight }}
            >
              {slot.displayTime}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, dayIdx) => {
          const dayEvents = eventsByDay.get(dayIdx) || [];
          const dayBlocks = blocksByDay.get(dayIdx) || [];
          const layoutItems = layoutEvents(dayEvents);
          const isToday = isSameDay(day, today);

          return (
            <div
              key={dayIdx}
              className={`flex-1 min-w-[120px] border-r border-border last:border-r-0 relative ${
                isToday ? "bg-primary/5" : ""
              }`}
            >
              {/* Slot backgrounds */}
              {timeSlots.map((slot, idx) => {
                const outside = isOutsideWorkingHours(day, slot.time);
                return (
                  <div
                    key={idx}
                    className={`border-b border-border last:border-b-0 ${
                      outside ? "bg-muted/40" : ""
                    }`}
                    style={{ height: slotHeight }}
                  >
                    {outside && (
                      <div
                        className="w-full h-full"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)",
                        }}
                      />
                    )}
                  </div>
                );
              })}

              {/* Time block overlays */}
              {dayBlocks.map((block) => {
                const { top, height } = getBlockPosition(block, day);
                if (height <= 0) return null;
                const config = getBlockStyle(block.blockType);
                return (
                  <div
                    key={`block-${block.id}-${dayIdx}`}
                    className="absolute left-0 right-0 pointer-events-none z-[1]"
                    style={{ top, height }}
                  >
                    <div
                      className="h-full mx-0.5 rounded-sm border-l-4 overflow-hidden"
                      style={{
                        backgroundColor: config.bg,
                        borderLeftColor: config.border,
                        backgroundImage: `repeating-linear-gradient(
                          135deg,
                          transparent,
                          transparent 6px,
                          ${config.stripe} 6px,
                          ${config.stripe} 12px
                        )`,
                      }}
                    >
                      <div
                        className="px-1 py-0.5 text-[10px] font-medium truncate"
                        style={{ color: config.border }}
                      >
                        {config.label}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Event overlays */}
              {layoutItems.map(({ event, col, totalCols }) => {
                const top = getEventTop(event, day);
                const height = getEventHeight(event);
                const widthPercent = 100 / totalCols;
                const leftPercent = col * widthPercent;

                return (
                  <div
                    key={event.id}
                    className="absolute z-[2]"
                    style={{
                      top,
                      height,
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                    }}
                  >
                    <CalendarEventComponent
                      event={event}
                      onDragStart={noopDragStart}
                      onDragEnd={noopDragEnd}
                      onClick={onEventClick}
                      {...(onEventCancel ? { onCancel: onEventCancel } : {})}
                      {...(onEventComplete ? { onComplete: onEventComplete } : {})}
                      colorMode={colorMode}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
