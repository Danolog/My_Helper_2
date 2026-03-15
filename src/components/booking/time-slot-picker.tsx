"use client";

import { forwardRef } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { AvailableSlotsData } from "./types";
import { formatDateDisplay, calcEndTime, getTodayStr } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TimeSlotPickerProps {
  /** Whether this step is visible (employee selected) */
  canShow: boolean;
  /** Whether the service has variants (affects step numbering) */
  hasVariants: boolean;
  /** Step number to display */
  stepNumber: number;
  selectedDate: string;
  selectedTimeSlot: string;
  slotsData: AvailableSlotsData | null;
  loadingSlots: boolean;
  effectiveDuration: number;
  onDateChange: (date: string) => void;
  onNavigateDate: (direction: number) => void;
  onTimeSlotSelect: (time: string) => void;
  onBackToEmployee: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TimeSlotPicker = forwardRef<HTMLDivElement, TimeSlotPickerProps>(
  function TimeSlotPicker(
    {
      canShow,
      stepNumber,
      selectedDate,
      selectedTimeSlot,
      slotsData,
      loadingSlots,
      effectiveDuration,
      onDateChange,
      onNavigateDate,
      onTimeSlotSelect,
      onBackToEmployee,
    },
    ref
  ) {
    const todayStr = getTodayStr();

    return (
      <Card ref={ref} className="mb-6" data-testid="booking-step-datetime">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge
                variant={selectedDate && selectedTimeSlot ? "default" : "outline"}
                className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {stepNumber}
              </Badge>
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Wybierz date i godzine</CardTitle>
            </div>
            {canShow && (
              <Button variant="ghost" size="sm" onClick={onBackToEmployee}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Zmien pracownika
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!canShow ? (
            <p className="text-muted-foreground text-sm">
              Najpierw wybierz pracownika.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Date picker */}
              <div>
                <p className="text-sm font-medium mb-2">Data</p>
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
                  <p
                    className="text-sm text-muted-foreground mt-2"
                    data-testid="selected-date-display"
                  >
                    {formatDateDisplay(selectedDate)}
                  </p>
                )}
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div>
                  <Separator className="my-2" />
                  <p className="text-sm font-medium mb-2">Godzina</p>

                  {loadingSlots ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                  ) : slotsData?.dayOff ? (
                    <div
                      className="text-center py-6"
                      data-testid="day-off-message"
                    >
                      <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">
                        {slotsData.message ||
                          "Pracownik nie pracuje w tym dniu"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Wybierz inna date.
                      </p>
                    </div>
                  ) : slotsData && slotsData.slots.length === 0 ? (
                    <div
                      className="text-center py-6"
                      data-testid="no-slots-message"
                    >
                      <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">
                        Brak wolnych terminow w tym dniu
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Wszystkie terminy sa zajete. Wybierz inna date.
                      </p>
                    </div>
                  ) : slotsData ? (
                    <div>
                      {/* Work hours info */}
                      <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>
                          Godziny pracy: {slotsData.workStart} -{" "}
                          {slotsData.workEnd}
                        </span>
                      </div>

                      {/* Blocked ranges */}
                      {slotsData.blockedRanges &&
                        slotsData.blockedRanges.length > 0 && (
                          <div
                            className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md border border-orange-200 dark:border-orange-800"
                            data-testid="blocked-ranges-info"
                          >
                            <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-1">
                              Zajete terminy:
                            </p>
                            {slotsData.blockedRanges.map((range, i) => (
                              <div
                                key={i}
                                className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1 mb-0.5"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                                {range.start} - {range.end}
                                <span className="text-orange-500">
                                  (
                                  {range.type === "appointment"
                                    ? "wizyta"
                                    : range.type === "vacation"
                                      ? "urlop"
                                      : range.type === "break"
                                        ? "przerwa"
                                        : range.label}
                                  )
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Time slot grid */}
                      <div
                        className="grid grid-cols-4 gap-2"
                        data-testid="time-slots-grid"
                      >
                        {slotsData.slots.map((slot) => (
                          <Button
                            key={slot.time}
                            variant={
                              selectedTimeSlot === slot.time
                                ? "default"
                                : "outline"
                            }
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

                      {/* Selected slot summary */}
                      {selectedTimeSlot && (
                        <div
                          className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800"
                          data-testid="selected-slot-summary"
                        >
                          <div className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium text-green-800 dark:text-green-300">
                              Wybrany termin: {selectedTimeSlot} -{" "}
                              {calcEndTime(selectedTimeSlot, effectiveDuration)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
);
