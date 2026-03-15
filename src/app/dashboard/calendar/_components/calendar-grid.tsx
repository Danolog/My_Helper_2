"use client";

import { CalendarLegend } from "@/components/calendar/calendar-legend";
import { TimeGrid } from "@/components/calendar/time-grid";
import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import { Button } from "@/components/ui/button";
import { getStartOfWeek } from "@/lib/date-utils";
import type { CalendarEvent, CalendarView, Employee, TimeBlock, WorkSchedule } from "@/types/calendar";

interface CalendarGridProps {
  currentDate: Date;
  currentView: CalendarView;
  loading: boolean;
  colorMode: "status" | "employee";
  employees: Employee[];
  filteredEmployees: Employee[];
  filteredEvents: CalendarEvent[];
  filteredTimeBlocks: TimeBlock[];
  workSchedules: WorkSchedule[];
  draggedEvent: CalendarEvent | null;
  dateDisplay: string;
  onDragStart: (event: CalendarEvent) => void;
  onDragEnd: () => void;
  onDrop: (employeeId: string, time: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  onEventCancel: (event: CalendarEvent) => void;
  onEventComplete: (event: CalendarEvent) => void;
  onDayClick: (date: Date) => void;
}

export function CalendarGrid({
  currentDate,
  currentView,
  loading,
  colorMode,
  employees,
  filteredEmployees,
  filteredEvents,
  filteredTimeBlocks,
  workSchedules,
  draggedEvent,
  dateDisplay,
  onDragStart,
  onDragEnd,
  onDrop,
  onEventClick,
  onEventCancel,
  onEventComplete,
  onDayClick,
}: CalendarGridProps) {
  return (
    <>
      {/* Current date display */}
      <div className="mb-4">
        <h2 className="text-lg font-medium capitalize">{dateDisplay}</h2>
      </div>

      {/* Legend */}
      <div className="mb-4">
        <CalendarLegend colorMode={colorMode} employees={employees} />
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex justify-center items-center h-96">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 text-center">
          <p className="text-muted-foreground mb-4">
            Brak pracownikow w salonie. Dodaj pracownikow, aby korzystac z kalendarza.
          </p>
          <Button variant="outline">Dodaj pracownika</Button>
        </div>
      ) : currentView === "day" ? (
        <TimeGrid
          date={currentDate}
          employees={filteredEmployees}
          events={filteredEvents}
          workSchedules={workSchedules}
          timeBlocks={filteredTimeBlocks}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
          onEventClick={onEventClick}
          onEventCancel={onEventCancel}
          onEventComplete={onEventComplete}
          draggedEvent={draggedEvent}
          colorMode={colorMode}
        />
      ) : (
        <WeekTimeGrid
          weekStart={getStartOfWeek(currentDate)}
          employees={filteredEmployees}
          events={filteredEvents}
          workSchedules={workSchedules}
          timeBlocks={filteredTimeBlocks}
          onEventClick={onEventClick}
          onEventCancel={onEventCancel}
          onEventComplete={onEventComplete}
          onDayClick={onDayClick}
          colorMode={colorMode}
        />
      )}
    </>
  );
}
