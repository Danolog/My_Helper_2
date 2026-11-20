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
import { isBlikDepositFlow } from "@/lib/features";
import { formatDuration, formatDateDisplay, calcEndTime } from "./types";
import type { ServiceItem, ServiceVariant, AssignedEmployee } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Transfer details for a BLIK deposit, taken only from the server's 201
 * response. Declared structurally here so a shared component does not import
 * types from an app route.
 */
interface BlikDepositInstructions {
  depositAmount: number;
  phone: string;
  recipient: string;
  title: string;
}

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
  blikInstructions: BlikDepositInstructions | null;
  isLoggedIn: boolean;
  onReset: () => void;
}

// ---------------------------------------------------------------------------
// Component — the success screen shown after a booking is made
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
  blikInstructions,
  isLoggedIn,
  onReset,
}: BookingConfirmationProps) {
  const employee = assignedEmployees.find((e) => e.id === selectedEmployeeId);
  // The branch follows the switch and the derived deposit, not the mere
  // presence of instructions: a 201 without valid transfer details must not
  // fall into the online branch and claim the deposit was paid.
  const blikDeposit = isBlikDepositFlow() && depositRequired && depositAmount > 0;

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
            {!blikDeposit && depositRequired && depositAmount > 0 && (
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
            {blikDeposit && (
              <>
                <Separator className="my-2" />
                {blikInstructions ? (
                  <div className="space-y-2" data-testid="blik-instructions">
                    <p className="font-semibold text-left">Zadatek do wplaty BLIK-iem</p>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Kwota:</span>
                      {/* Amount from the server's 201, never the client-side estimate. */}
                      <span className="font-medium" data-testid="blik-amount">
                        {blikInstructions.depositAmount.toFixed(2)} PLN
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Numer telefonu:</span>
                      <span className="font-medium" data-testid="blik-phone">{blikInstructions.phone}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Odbiorca:</span>
                      <span className="font-medium" data-testid="blik-recipient">{blikInstructions.recipient}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tytul przelewu:</span>
                      <span className="font-medium" data-testid="blik-title">{blikInstructions.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pozostalo do zaplaty w salonie:</span>
                      <span className="font-medium">
                        {(effectivePrice - blikInstructions.depositAmount).toFixed(0)} PLN
                      </span>
                    </div>
                    <p className="text-left">Salon oznaczy zadatek jako wplacony po otrzymaniu przelewu.</p>
                  </div>
                ) : (
                  // Also reached by a plain booking after DEPOSIT_NOT_APPLICABLE,
                  // so the text must stay true when no deposit was due.
                  <p className="text-left" data-testid="blik-instructions-missing">
                    Nie udalo sie wyswietlic danych przelewu zadatku. Jesli salon wymaga zadatku, skontaktuj sie z salonem.
                  </p>
                )}
                <p className="text-left" data-testid="blik-refund-notice">
                  Zadatek rozliczany poza MyHelper — zwrot ustala salon.
                </p>
                {/* Guests get no SMS sentence: delivery is not guaranteed. */}
                {isLoggedIn && blikInstructions && (
                  <p className="text-left" data-testid="blik-save-notice">
                    Zapisz dane przelewu — nie wyslemy ich SMS-em.
                  </p>
                )}
              </>
            )}
          </div>
          <Separator className="my-4" />
          {!blikDeposit && depositRequired && depositAmount > 0 && (
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
