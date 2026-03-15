"use client";

import { Clock, Save, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DAY_NAMES } from "../_hooks/use-schedule-data";
import type { DaySchedule } from "../_hooks/use-schedule-data";

interface ScheduleGridProps {
  orderedSchedule: DaySchedule[];
  saving: boolean;
  saved: boolean;
  onTimeChange: (dayOfWeek: number, field: "startTime" | "endTime", value: string) => void;
  onDayOffToggle: (dayOfWeek: number) => void;
  onSave: () => Promise<void>;
}

export function ScheduleGrid({
  orderedSchedule,
  saving,
  saved,
  onTimeChange,
  onDayOffToggle,
  onSave,
}: ScheduleGridProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Godziny pracy</CardTitle>
            <CardDescription>
              Ustaw regularne godziny pracy dla kazdego dnia tygodnia.
              Dni oznaczone jako wolne nie beda dostepne dla rezerwacji.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {orderedSchedule.map((day) => (
            <div
              key={day.dayOfWeek}
              className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                day.isDayOff
                  ? "bg-muted/50 border-muted"
                  : "bg-background border-border"
              }`}
            >
              <div className="w-28 flex-shrink-0">
                <span className={`font-medium ${day.isDayOff ? "text-muted-foreground" : ""}`}>
                  {DAY_NAMES[day.dayOfWeek]}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onDayOffToggle(day.dayOfWeek)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  day.isDayOff
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900"
                    : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900"
                }`}
              >
                {day.isDayOff ? "Dzien wolny" : "Pracujacy"}
              </button>

              {!day.isDayOff ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    type="time"
                    value={day.startTime}
                    onChange={(e) => onTimeChange(day.dayOfWeek, "startTime", e.target.value)}
                    className="w-32"
                  />
                  <span className="text-muted-foreground">-</span>
                  <Input
                    type="time"
                    value={day.endTime}
                    onChange={(e) => onTimeChange(day.dayOfWeek, "endTime", e.target.value)}
                    className="w-32"
                  />
                </div>
              ) : (
                <div className="flex-1 text-sm text-muted-foreground italic">
                  Brak godzin pracy
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-4">
          <Button onClick={onSave} disabled={saving} className="min-w-[200px]">
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Zapisywanie...
              </>
            ) : saved ? (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Zapisano
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Zapisz harmonogram
              </>
            )}
          </Button>
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Harmonogram zostal zapisany pomyslnie
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
