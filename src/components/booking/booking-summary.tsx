"use client";

import { forwardRef } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  Clock,
  CreditCard,
  Loader2,
  Phone,
  Smartphone,
  UserPlus,
  Wallet,
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
import type { AssignedEmployee, ServiceItem, ServiceVariant } from "./types";
import { formatDuration, formatDateDisplay, calcEndTime } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PromotionInfo {
  activePromoType: "happy_hours" | "first_visit" | "none";
  bestDiscountAmount: number;
  baseEffectivePrice: number;
  effectivePrice: number;
  happyHoursPromo: {
    discountPercent?: number;
    promotionName?: string;
    reason?: string;
  } | null;
  firstVisitPromo: {
    discountPercent?: number;
    promotionName?: string;
    reason?: string;
  } | null;
}

interface DepositInfo {
  depositRequired: boolean;
  depositAmount: number;
  depositPercentage: number;
}

interface GuestInfo {
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  onGuestNameChange: (value: string) => void;
  onGuestPhoneChange: (value: string) => void;
  onGuestEmailChange: (value: string) => void;
}

interface PaymentInfo {
  selectedPaymentMethod: string;
  blikPhoneNumber: string;
  blikPhoneError: string;
  onPaymentMethodChange: (method: string) => void;
  onBlikPhoneChange: (value: string) => void;
  onBlikPhoneErrorClear: () => void;
}

interface BookingSummaryProps {
  canShow: boolean;
  hasVariants: boolean;
  stepNumber: number;
  salon: { name: string };
  selectedService: ServiceItem | null;
  selectedVariant: ServiceVariant | null;
  assignedEmployees: AssignedEmployee[];
  selectedEmployeeId: string;
  selectedDate: string;
  selectedTimeSlot: string;
  effectiveDuration: number;
  isLoggedIn: boolean;
  isBooking: boolean;
  isProcessingPayment: boolean;
  promotion: PromotionInfo;
  deposit: DepositInfo;
  guest: GuestInfo;
  payment: PaymentInfo;
  onBackToDateTime: () => void;
  onBook: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BookingSummary = forwardRef<HTMLDivElement, BookingSummaryProps>(
  function BookingSummary(
    {
      canShow,
      stepNumber,
      salon,
      selectedService,
      selectedVariant,
      assignedEmployees,
      selectedEmployeeId,
      selectedDate,
      selectedTimeSlot,
      effectiveDuration,
      isLoggedIn,
      isBooking,
      isProcessingPayment,
      promotion,
      deposit,
      guest,
      payment,
      onBackToDateTime,
      onBook,
    },
    ref
  ) {
    const {
      activePromoType,
      bestDiscountAmount,
      baseEffectivePrice,
      effectivePrice,
      happyHoursPromo,
      firstVisitPromo,
    } = promotion;

    const { depositRequired, depositAmount, depositPercentage } = deposit;

    return (
      <Card
        ref={ref}
        className={`mb-6 ${canShow ? "border-primary" : ""}`}
        data-testid="booking-step-summary"
      >
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge
                variant={canShow ? "default" : "outline"}
                className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {stepNumber}
              </Badge>
              <Check className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Podsumowanie i potwierdzenie</CardTitle>
            </div>
            {canShow && (
              <Button variant="ghost" size="sm" onClick={onBackToDateTime}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Zmien termin
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!canShow ? (
            <p className="text-muted-foreground text-sm">
              Wypelnij wszystkie poprzednie kroki, aby zobaczyc podsumowanie.
            </p>
          ) : selectedService ? (
            <div>
              {/* Summary details */}
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Salon:</span>
                  <span className="font-medium">{salon.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Usluga:</span>
                  <span className="font-medium">
                    {selectedService.name}
                    {selectedVariant ? ` - ${selectedVariant.name}` : ""}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pracownik:</span>
                  <span className="font-medium">
                    {(() => {
                      const emp = assignedEmployees.find(
                        (e) => e.id === selectedEmployeeId
                      );
                      return emp
                        ? `${emp.firstName} ${emp.lastName}`
                        : "";
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Data:</span>
                  <span className="font-medium">
                    {formatDateDisplay(selectedDate)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Godzina:</span>
                  <span className="font-medium">
                    {selectedTimeSlot} -{" "}
                    {calcEndTime(selectedTimeSlot, effectiveDuration)}
                  </span>
                </div>
                {/* Discount display */}
                {bestDiscountAmount > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Cena regularna:</span>
                      <span className="font-medium line-through text-muted-foreground">
                        {baseEffectivePrice.toFixed(0)} PLN
                      </span>
                    </div>
                    <div className="flex justify-between text-sm" data-testid="discount-row">
                      <span className="text-green-600 font-medium flex items-center gap-1">
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
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {bestDiscountAmount > 0 ? "Cena po rabacie:" : "Cena:"}
                  </span>
                  <span className={`font-medium ${bestDiscountAmount > 0 ? "text-green-600 font-bold" : ""}`}>
                    {effectivePrice.toFixed(0)} PLN
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Czas trwania:</span>
                  <span className="font-medium">
                    {formatDuration(effectiveDuration)}
                  </span>
                </div>
              </div>

              {/* Promotion info banner */}
              {bestDiscountAmount > 0 && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 mb-4" data-testid="promotion-banner">
                  <div className="flex items-center gap-2">
                    {activePromoType === "first_visit" ? (
                      <UserPlus className="w-5 h-5 text-green-600" />
                    ) : (
                      <Clock className="w-5 h-5 text-green-600" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                        {activePromoType === "first_visit"
                          ? (firstVisitPromo?.promotionName || "Znizka na pierwsza wizyte")
                          : (happyHoursPromo?.promotionName || "Happy Hours")}
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400">
                        {activePromoType === "first_visit"
                          ? (firstVisitPromo?.reason || `Znizka ${firstVisitPromo?.discountPercent}% na pierwsza wizyte!`)
                          : (happyHoursPromo?.reason || `Happy Hours -${happyHoursPromo?.discountPercent}%`)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Deposit payment section */}
              {depositRequired && depositAmount > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800" data-testid="deposit-info-section">
                    <div className="flex items-center gap-2 mb-3">
                      <Wallet className="w-5 h-5 text-amber-600" />
                      <span className="font-semibold text-amber-800 dark:text-amber-300">
                        Wymagany zadatek
                      </span>
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-700 dark:text-amber-400">Kwota zadatku ({depositPercentage}%):</span>
                        <span className="font-bold text-amber-800 dark:text-amber-200" data-testid="deposit-amount-display">
                          {depositAmount} PLN
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-700 dark:text-amber-400">Pozostalo do zaplaty w salonie:</span>
                        <span className="font-medium text-amber-800 dark:text-amber-200">
                          {(effectivePrice - depositAmount).toFixed(0)} PLN
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                      Zadatek jest wymagany do potwierdzenia rezerwacji. Pozostala kwota platna w salonie.
                    </p>

                    {/* Payment method selection */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Metoda platnosci:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            payment.selectedPaymentMethod === "stripe"
                              ? "bg-primary/10 border-primary"
                              : "bg-white dark:bg-background hover:bg-muted/50"
                          }`}
                          onClick={() => {
                            payment.onPaymentMethodChange("stripe");
                            payment.onBlikPhoneErrorClear();
                          }}
                          data-testid="payment-method-stripe"
                        >
                          <CreditCard className="w-5 h-5 text-primary" />
                          <div>
                            <p className="text-sm font-medium">Karta</p>
                            <p className="text-xs text-muted-foreground">Visa, Mastercard</p>
                          </div>
                          {payment.selectedPaymentMethod === "stripe" && (
                            <Check className="w-4 h-4 text-primary ml-auto" />
                          )}
                        </div>
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            payment.selectedPaymentMethod === "blik"
                              ? "bg-primary/10 border-primary"
                              : "bg-white dark:bg-background hover:bg-muted/50"
                          }`}
                          onClick={() => payment.onPaymentMethodChange("blik")}
                          data-testid="payment-method-blik"
                        >
                          <Smartphone className="w-5 h-5 text-pink-600" />
                          <div>
                            <p className="text-sm font-medium">BLIK P2P</p>
                            <p className="text-xs text-muted-foreground">Platnosc na telefon</p>
                          </div>
                          {payment.selectedPaymentMethod === "blik" && (
                            <Check className="w-4 h-4 text-primary ml-auto" />
                          )}
                        </div>
                      </div>

                      {/* Blik P2P phone number input */}
                      {payment.selectedPaymentMethod === "blik" && (
                        <div className="mt-3 p-3 bg-pink-50 dark:bg-pink-900/20 rounded-lg border border-pink-200 dark:border-pink-800" data-testid="blik-phone-section">
                          <div className="flex items-center gap-2 mb-2">
                            <Phone className="w-4 h-4 text-pink-600" />
                            <p className="text-sm font-medium text-pink-800 dark:text-pink-300">Numer telefonu do platnosci BLIK</p>
                          </div>
                          <p className="text-xs text-pink-600 dark:text-pink-400 mb-2">
                            Podaj numer telefonu, na ktory zostanie wyslane zadanie platnosci BLIK P2P.
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-pink-700 dark:text-pink-300 whitespace-nowrap">+48</span>
                            <Input
                              type="tel"
                              placeholder="123 456 789"
                              value={payment.blikPhoneNumber}
                              onChange={(e) => {
                                payment.onBlikPhoneChange(e.target.value);
                                payment.onBlikPhoneErrorClear();
                              }}
                              className={`flex-1 ${payment.blikPhoneError ? "border-red-500" : ""}`}
                              maxLength={15}
                              data-testid="blik-phone-input"
                            />
                          </div>
                          {payment.blikPhoneError && (
                            <p className="text-xs text-red-500 mt-1" data-testid="blik-phone-error">
                              {payment.blikPhoneError}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Guest info form - shown when not logged in */}
              {!isLoggedIn && (
                <div className="space-y-4 mb-4">
                  <Separator />
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <UserPlus className="h-5 w-5" />
                    Dane kontaktowe
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Podaj swoje dane, abysmy mogli potwierdzic rezerwacje.
                  </p>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Imie *</label>
                    <Input
                      value={guest.guestName}
                      onChange={(e) => guest.onGuestNameChange(e.target.value)}
                      placeholder="Twoje imie"
                      required
                      aria-invalid={guest.guestName.length > 0 && guest.guestName.trim().length < 2}
                    />
                    {guest.guestName.length > 0 && guest.guestName.trim().length < 2 && (
                      <p className="text-xs text-destructive mt-1">Imie musi miec co najmniej 2 znaki.</p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Telefon *</label>
                    <Input
                      value={guest.guestPhone}
                      onChange={(e) => guest.onGuestPhoneChange(e.target.value)}
                      placeholder="+48 123 456 789"
                      type="tel"
                      required
                      aria-invalid={guest.guestPhone.length > 0 && guest.guestPhone.replace(/\D/g, "").length < 9}
                    />
                    {guest.guestPhone.length > 0 && guest.guestPhone.replace(/\D/g, "").length < 9 && (
                      <p className="text-xs text-destructive mt-1">Podaj poprawny numer telefonu (min. 9 cyfr).</p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1 block">Email (opcjonalnie)</label>
                    <Input
                      value={guest.guestEmail}
                      onChange={(e) => guest.onGuestEmailChange(e.target.value)}
                      placeholder="twoj@email.pl"
                      type="email"
                      aria-invalid={guest.guestEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.guestEmail)}
                    />
                    {guest.guestEmail.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.guestEmail) && (
                      <p className="text-xs text-destructive mt-1">Podaj poprawny adres email.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Book button */}
              <Button
                className="w-full"
                size="lg"
                onClick={onBook}
                disabled={isBooking || isProcessingPayment}
                data-testid="book-appointment-btn"
              >
                {isBooking || isProcessingPayment ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isProcessingPayment ? "Przetwarzanie platnosci..." : "Rezerwowanie..."}
                  </div>
                ) : depositRequired && depositAmount > 0 ? (
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Zaplac zadatek {depositAmount} PLN i zarezerwuj
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <CalendarPlus className="h-5 w-5" />
                    Potwierdz rezerwacje
                  </div>
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }
);
