"use client";

import { Clock, AlertCircle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateEndTime } from "../_types";
import type { AvailableSlotsData, Service } from "../_types";

interface TimeSlotsCardProps {
  stepNumber: number;
  slotsData: AvailableSlotsData | null;
  loadingSlots: boolean;
  selectedDate: string;
  selectedEmployeeId: string;
  selectedTimeSlot: string;
  selectedService: Service | null;
  onTimeSlotSelect: (time: string) => void;
}

export function TimeSlotsCard({
  stepNumber,
  slotsData,
  loadingSlots,
  selectedDate,
  selectedEmployeeId,
  selectedTimeSlot,
  selectedService,
  onTimeSlotSelect,
}: TimeSlotsCardProps) {
  return (
    <Card className="mb-6" data-testid="booking-slots-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">{stepNumber}. Wybierz godzine</CardTitle>
          {slotsData && !slotsData.dayOff && (
            <Badge variant="outline" data-testid="available-slots-count">
              {slotsData.slots.length} wolnych terminow
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!selectedDate || !selectedEmployeeId ? (
          <p className="text-muted-foreground text-sm" data-testid="select-date-first-message">
            Wybierz pracownika i date, aby zobaczyc dostepne godziny.
          </p>
        ) : loadingSlots ? (
          <div className="flex justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : slotsData?.dayOff ? (
          <DayOffMessage message={slotsData.message} />
        ) : slotsData && slotsData.slots.length === 0 ? (
          <NoSlotsMessage blockedRanges={slotsData.blockedRanges} />
        ) : slotsData ? (
          <div>
            {/* Work hours info */}
            <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>Godziny pracy: {slotsData.workStart} - {slotsData.workEnd}</span>
            </div>

            {/* Blocked ranges info */}
            {slotsData.blockedRanges && slotsData.blockedRanges.length > 0 && (
              <BlockedRangesInfo blockedRanges={slotsData.blockedRanges} />
            )}

            {/* Time slot grid */}
            <div className="grid grid-cols-4 gap-2" data-testid="time-slots-grid">
              {slotsData.slots.map((slot) => (
                <Button
                  key={slot.time}
                  variant={selectedTimeSlot === slot.time ? "default" : "outline"}
                  size="sm"
                  className={`text-sm ${
                    selectedTimeSlot === slot.time
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-primary/10"
                  }`}
                  onClick={() => onTimeSlotSelect(slot.time)}
                  data-testid={`time-slot-${slot.time}`}
                >
                  {slot.time}
                </Button>
              ))}
            </div>

            {selectedTimeSlot && selectedService && (
              <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800" data-testid="selected-slot-summary">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-800 dark:text-green-300">
                    Wybrany termin: {selectedTimeSlot} - {calculateEndTime(selectedTimeSlot, selectedService.baseDuration)}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DayOffMessage({ message }: { message?: string | undefined }) {
  return (
    <div className="text-center py-6" data-testid="day-off-message">
      <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
      <p className="text-muted-foreground font-medium">
        {message || "Pracownik nie pracuje w tym dniu"}
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Wybierz inna date
      </p>
    </div>
  );
}

function NoSlotsMessage({ blockedRanges }: { blockedRanges?: AvailableSlotsData["blockedRanges"] }) {
  return (
    <div className="text-center py-6" data-testid="no-slots-message">
      <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
      <p className="text-muted-foreground font-medium">
        Brak wolnych terminow w tym dniu
      </p>
      <p className="text-sm text-muted-foreground mt-1">
        Wszystkie terminy sa zajete. Wybierz inna date.
      </p>
      {blockedRanges && blockedRanges.length > 0 && (
        <div className="mt-4 text-left">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Zajete terminy:</p>
          {blockedRanges.map((range, i) => (
            <div key={i} className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
              {range.start} - {range.end} ({range.type === "appointment" ? "wizyta" : range.label})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BlockedRangesInfo({ blockedRanges }: { blockedRanges: NonNullable<AvailableSlotsData["blockedRanges"]> }) {
  return (
    <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md border border-orange-200 dark:border-orange-800" data-testid="blocked-ranges-info">
      <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-1">Zajete terminy:</p>
      {blockedRanges.map((range, i) => (
        <div key={i} className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1 mb-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
          {range.start} - {range.end}
          <span className="text-orange-500">
            ({range.type === "appointment" ? "wizyta" : range.type === "vacation" ? "urlop" : range.type === "break" ? "przerwa" : range.label})
          </span>
        </div>
      ))}
    </div>
  );
}
