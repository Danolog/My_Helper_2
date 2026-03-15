"use client";

import Link from "next/link";
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { ServiceItem, ServiceVariant, AssignedEmployee } from "./types";
import { formatDuration, formatDateDisplay, calcEndTime } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BookingConfirmationProps {
  salonId: string;
  salonName: string;
  selectedService: ServiceItem;
  selectedVariant: ServiceVariant | null;
  assignedEmployees: AssignedEmployee[];
  selectedEmployeeId: string;
  selectedDate: string;
  selectedTimeSlot: string;
  effectiveDuration: number;
  baseEffectivePrice: number;
  effectivePrice: number;
  bestDiscountAmount: number;
  activePromoType: "happy_hours" | "first_visit" | "none";
  happyHoursPromo: { discountPercent?: number } | null;
  firstVisitPromo: { discountPercent?: number } | null;
  depositRequired: boolean;
  depositAmount: number;
  selectedPaymentMethod: string;
  blikPhoneNumber: string;
  onReset: () => void;
}

// ---------------------------------------------------------------------------
// Component — the success screen shown after a booking is confirmed
// ---------------------------------------------------------------------------

export function BookingConfirmation({
  salonId,
  salonName,
  selectedService,
  selectedVariant,
  assignedEmployees,
  selectedEmployeeId,
  selectedDate,
  selectedTimeSlot,
  effectiveDuration,
  baseEffectivePrice,
  effectivePrice,
  bestDiscountAmount,
  activePromoType,
  happyHoursPromo,
  firstVisitPromo,
  depositRequired,
  depositAmount,
  selectedPaymentMethod,
  blikPhoneNumber,
  onReset,
}: BookingConfirmationProps) {
  const employee = assignedEmployees.find((e) => e.id === selectedEmployeeId);

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card className="text-center py-8">
        <CardContent className="space-y-4">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-bold">Wizyta zarezerwowana!</h2>
          <div className="space-y-2 text-sm max-w-sm mx-auto">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Salon:</span>
              <span className="font-medium">{salonName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Usluga:</span>
              <span className="font-medium">
                {selectedService.name}
                {selectedVariant ? ` - ${selectedVariant.name}` : ""}
              </span>
            </div>
            {employee && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pracownik:</span>
                <span className="font-medium">
                  {employee.firstName} {employee.lastName}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data:</span>
              <span className="font-medium">
                {formatDateDisplay(selectedDate)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Godzina:</span>
              <span className="font-medium">
                {selectedTimeSlot} - {calcEndTime(selectedTimeSlot, effectiveDuration)}
              </span>
            </div>
            {bestDiscountAmount > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cena regularna:</span>
                  <span className="font-medium line-through text-muted-foreground">
                    {baseEffectivePrice.toFixed(0)} PLN
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-green-600 font-medium">
                    {activePromoType === "first_visit"
                      ? `Pierwsza wizyta -${firstVisitPromo?.discountPercent}%`
                      : `Happy Hours -${happyHoursPromo?.discountPercent}%`}
                  </span>
                  <span className="font-medium text-green-600">
                    -{bestDiscountAmount.toFixed(0)} PLN
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {bestDiscountAmount > 0 ? "Cena po rabacie:" : "Cena:"}
              </span>
              <span className={`font-medium ${bestDiscountAmount > 0 ? "text-green-600 font-bold" : ""}`}>
                {effectivePrice.toFixed(0)} PLN
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Czas trwania:</span>
              <span className="font-medium">{formatDuration(effectiveDuration)}</span>
            </div>
            {depositRequired && depositAmount > 0 && (
              <>
                <Separator className="my-2" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Zadatek:</span>
                  <span className="font-medium text-green-600">{depositAmount} PLN (oplacony)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Metoda platnosci:</span>
                  <span className="font-medium">
                    {selectedPaymentMethod === "blik" ? "BLIK P2P" : "Karta"}
                  </span>
                </div>
                {selectedPaymentMethod === "blik" && blikPhoneNumber && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Telefon BLIK:</span>
                    <span className="font-medium">{blikPhoneNumber}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pozostalo do zaplaty:</span>
                  <span className="font-medium">{(effectivePrice - depositAmount).toFixed(0)} PLN</span>
                </div>
              </>
            )}
          </div>
          <Separator className="my-4" />
          {depositRequired && depositAmount > 0 && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800 mb-4">
              <ShieldCheck className="w-5 h-5 text-green-600" />
              <span className="text-sm text-green-800 dark:text-green-300">
                Zadatek {depositAmount} PLN zostal pomyslnie oplacony
                {selectedPaymentMethod === "blik" ? " przez BLIK P2P" : " karta"}.
                Wizyta jest potwierdzona.
              </span>
            </div>
          )}
          <div className="flex flex-col gap-3">
            <Button onClick={onReset} size="lg">
              <CalendarPlus className="w-5 h-5 mr-2" />
              Zarezerwuj kolejna wizyte
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/salons/${salonId}`}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Powrot do salonu
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
