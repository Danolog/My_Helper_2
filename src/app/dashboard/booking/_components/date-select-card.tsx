"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateDisplay, getTodayStr } from "../_types";

interface DateSelectCardProps {
  stepNumber: number;
  selectedDate: string;
  selectedEmployeeId: string;
  onDateChange: (date: string) => void;
  onNavigateDate: (direction: number) => void;
}

export function DateSelectCard({
  stepNumber,
  selectedDate,
  selectedEmployeeId,
  onDateChange,
  onNavigateDate,
}: DateSelectCardProps) {
  const todayStr = getTodayStr();

  return (
    <Card className="mb-6" data-testid="booking-date-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">{stepNumber}. Wybierz date</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {!selectedEmployeeId ? (
          <p className="text-muted-foreground text-sm" data-testid="select-employee-first-message">
            Najpierw wybierz pracownika, aby zobaczyc dostepne daty.
          </p>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => onNavigateDate(-1)}
                disabled={!selectedDate || selectedDate <= todayStr}
                data-testid="date-prev-btn"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Input
                type="date"
                value={selectedDate}
                min={todayStr}
                onChange={(e) => onDateChange(e.target.value)}
                className="flex-1"
                data-testid="booking-date-input"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => onNavigateDate(1)}
                disabled={!selectedDate}
                data-testid="date-next-btn"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {selectedDate && (
              <p className="text-sm text-muted-foreground mt-2" data-testid="selected-date-display">
                {formatDateDisplay(selectedDate)}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
