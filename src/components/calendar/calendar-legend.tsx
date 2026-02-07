"use client";

import { STATUS_COLORS, STATUS_LABELS } from "./calendar-event";

interface CalendarLegendProps {
  colorMode: "employee" | "status";
  employees?: Array<{ id: string; firstName: string; lastName: string; color: string | null }>;
}

export function CalendarLegend({ colorMode, employees = [] }: CalendarLegendProps) {
  if (colorMode === "status") {
    return (
      <div className="flex flex-wrap gap-4 p-3 bg-muted/50 rounded-lg border border-border text-sm">
        <span className="text-muted-foreground font-medium">Legenda:</span>
        {(Object.keys(STATUS_COLORS) as Array<keyof typeof STATUS_COLORS>).map((status) => (
          <div key={status} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-sm border"
              style={{
                backgroundColor: STATUS_COLORS[status].bg,
                borderColor: STATUS_COLORS[status].border,
                backgroundImage: status === "cancelled"
                  ? "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)"
                  : undefined,
              }}
            />
            <span className="text-xs">{STATUS_LABELS[status]}</span>
          </div>
        ))}
      </div>
    );
  }

  // Employee color mode legend
  return (
    <div className="flex flex-wrap gap-4 p-3 bg-muted/50 rounded-lg border border-border text-sm">
      <span className="text-muted-foreground font-medium">Pracownicy:</span>
      {employees.map((employee) => (
        <div key={employee.id} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: employee.color || "#3b82f6" }}
          />
          <span className="text-xs">
            {employee.firstName} {employee.lastName}
          </span>
        </div>
      ))}
    </div>
  );
}
