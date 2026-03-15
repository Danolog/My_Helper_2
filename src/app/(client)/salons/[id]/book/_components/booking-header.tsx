"use client";

import Link from "next/link";
import { CalendarPlus, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingProgressBar } from "@/components/booking/booking-progress-bar";

interface BookingHeaderProps {
  salonId: string;
  salonName: string;
  selectedServiceId: string;
  variantStepSatisfied: boolean;
  canShowEmployeeStep: boolean;
  selectedEmployeeId: string;
  canShowDateStep: boolean;
  selectedDate: string;
  selectedTimeSlot: string;
  canShowSummaryStep: boolean;
  bookingSuccess: boolean;
}

export function BookingHeader({
  salonId,
  salonName,
  selectedServiceId,
  variantStepSatisfied,
  canShowEmployeeStep,
  selectedEmployeeId,
  canShowDateStep,
  selectedDate,
  selectedTimeSlot,
  canShowSummaryStep,
  bookingSuccess,
}: BookingHeaderProps) {
  return (
    <>
      {/* Back to salon link */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href={`/salons/${salonId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do salonu
          </Link>
        </Button>
      </div>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <CalendarPlus className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Rezerwacja wizyty</h1>
          <p className="text-muted-foreground text-sm">{salonName}</p>
        </div>
      </div>

      {/* Progress bar */}
      <BookingProgressBar
        steps={[
          {
            label: "Usluga",
            completed: selectedServiceId !== "" && variantStepSatisfied,
            active: selectedServiceId === "" || !variantStepSatisfied,
          },
          {
            label: "Pracownik",
            completed: selectedEmployeeId !== "",
            active: canShowEmployeeStep && selectedEmployeeId === "",
          },
          {
            label: "Termin",
            completed: selectedDate !== "" && selectedTimeSlot !== "",
            active:
              canShowDateStep &&
              (selectedDate === "" || selectedTimeSlot === ""),
          },
          {
            label: "Potwierdzenie",
            completed: bookingSuccess,
            active: canShowSummaryStep && !bookingSuccess,
          },
        ]}
      />
    </>
  );
}
