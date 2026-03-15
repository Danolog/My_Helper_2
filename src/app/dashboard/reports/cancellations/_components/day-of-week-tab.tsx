"use client";

import { Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportData } from "../_types";
import { getRateColor, getRateBadge } from "../_types";

interface DayOfWeekTabProps {
  reportData: ReportData;
}

export function DayOfWeekTab({ reportData }: DayOfWeekTabProps) {
  if (reportData.byDayOfWeek.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Anulacje wg dnia tygodnia
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxTotal = Math.max(
    ...reportData.byDayOfWeek.map((d) => d.total),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Anulacje wg dnia tygodnia
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {reportData.byDayOfWeek.map((day) => (
            <div key={day.dayOfWeek} className="flex items-center gap-4">
              <span className="text-sm font-medium w-28 shrink-0">
                {day.dayLabel}
              </span>
              <div className="flex-1 bg-muted rounded-full h-8 relative overflow-hidden">
                <div
                  className="bg-blue-200 h-8 rounded-full absolute top-0 left-0"
                  style={{
                    width: `${Math.max((day.total / maxTotal) * 100, 2)}%`,
                  }}
                />
                <div
                  className="bg-red-500 h-8 rounded-full absolute top-0 left-0 flex items-center"
                  style={{
                    width: `${Math.max((day.cancelled / maxTotal) * 100, day.cancelled > 0 ? 2 : 0)}%`,
                  }}
                >
                  {day.cancelled > 0 &&
                    (day.cancelled / maxTotal) * 100 > 8 && (
                      <span className="text-xs text-white font-medium pl-2">
                        {day.cancelled}
                      </span>
                    )}
                </div>
              </div>
              <div className="text-sm w-20 text-right shrink-0">
                {day.cancelled}/{day.total}
              </div>
              <Badge
                variant={getRateBadge(day.rate)}
                className="shrink-0 w-16 justify-center"
              >
                <span className={getRateColor(day.rate)}>{day.rate}%</span>
              </Badge>
            </div>
          ))}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-blue-200" />
              Laczne wizyty
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-red-500" />
              Anulowane + nieobecnosci
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
