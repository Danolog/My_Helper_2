"use client";

import { useMemo } from "react";
import { CalendarEventComponent } from "./calendar-event";
import type { CalendarEvent, Employee, TimeSlot } from "@/types/calendar";

interface TimeGridProps {
  date: Date;
  employees: Employee[];
  events: CalendarEvent[];
  onDragStart: (event: CalendarEvent) => void;
  onDragEnd: () => void;
  onDrop: (employeeId: string, time: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  draggedEvent: CalendarEvent | null;
  startHour?: number;
  endHour?: number;
  slotDuration?: number; // in minutes
  colorMode?: "employee" | "status"; // Color appointments by employee or status
}

export function TimeGrid({
  date,
  employees,
  events,
  onDragStart,
  onDragEnd,
  onDrop,
  onEventClick,
  draggedEvent,
  startHour = 8,
  endHour = 20,
  slotDuration = 30,
  colorMode = "status",
}: TimeGridProps) {
  // Generate time slots
  const timeSlots: TimeSlot[] = useMemo(() => {
    const slots: TimeSlot[] = [];
    const slotStart = new Date(date);
    slotStart.setHours(startHour, 0, 0, 0);
    const slotEnd = new Date(date);
    slotEnd.setHours(endHour, 0, 0, 0);

    let current = new Date(slotStart);
    while (current < slotEnd) {
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
  }, [date, startHour, endHour, slotDuration]);

  // Calculate slot height (30 min = 40px)
  const slotHeight = (slotDuration / 30) * 40;

  // Get events for a specific employee
  const getEmployeeEvents = (employeeId: string) => {
    return events.filter((event) => event.employeeId === employeeId);
  };

  // Calculate event position
  const getEventPosition = (event: CalendarEvent) => {
    const eventStart = new Date(event.start);
    const dayStart = new Date(date);
    dayStart.setHours(startHour, 0, 0, 0);

    const minutesFromStart = (eventStart.getTime() - dayStart.getTime()) / (1000 * 60);
    const top = (minutesFromStart / slotDuration) * slotHeight;

    return { top };
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, employeeId: string, slot: TimeSlot) => {
    e.preventDefault();
    onDrop(employeeId, slot.time);
  };

  return (
    <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-background">
      {/* Header with employee names */}
      <div className="flex border-b border-border bg-muted/50 sticky top-0 z-10">
        <div className="w-20 flex-shrink-0 border-r border-border p-2 text-xs font-medium text-muted-foreground">
          Czas
        </div>
        {employees.map((employee) => (
          <div
            key={employee.id}
            className="flex-1 min-w-[150px] border-r border-border last:border-r-0 p-2 text-sm font-medium truncate"
            style={{ borderTopColor: employee.color || "#3b82f6", borderTopWidth: 3 }}
          >
            {employee.firstName} {employee.lastName}
          </div>
        ))}
      </div>

      {/* Time slots grid */}
      <div className="flex flex-1 overflow-auto">
        {/* Time labels column */}
        <div className="w-20 flex-shrink-0 border-r border-border">
          {timeSlots.map((slot, index) => (
            <div
              key={index}
              className="border-b border-border last:border-b-0 px-2 py-1 text-xs text-muted-foreground text-right"
              style={{ height: slotHeight }}
            >
              {slot.displayTime}
            </div>
          ))}
        </div>

        {/* Employee columns */}
        {employees.map((employee) => {
          const employeeEvents = getEmployeeEvents(employee.id);

          return (
            <div
              key={employee.id}
              className="flex-1 min-w-[150px] border-r border-border last:border-r-0 relative"
            >
              {/* Time slots */}
              {timeSlots.map((slot, index) => (
                <div
                  key={index}
                  className={`
                    border-b border-border last:border-b-0 relative
                    ${draggedEvent ? "hover:bg-primary/10" : ""}
                    transition-colors
                  `}
                  style={{ height: slotHeight }}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, employee.id, slot)}
                  data-employee-id={employee.id}
                  data-time={slot.time.toISOString()}
                />
              ))}

              {/* Events overlay */}
              {employeeEvents.map((event) => {
                const { top } = getEventPosition(event);
                return (
                  <div
                    key={event.id}
                    className="absolute left-0 right-0"
                    style={{ top }}
                  >
                    <CalendarEventComponent
                      event={event}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      onClick={onEventClick}
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
