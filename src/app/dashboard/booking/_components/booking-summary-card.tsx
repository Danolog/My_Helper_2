"use client";

import { CalendarPlus, Gift, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateDisplay, calculateEndTime } from "../_types";
import type { Service, Client, Employee, PromotionCheck, PromoCodeValidation } from "../_types";

interface PromoCodeDiscount {
  discountAmount: number;
  finalPrice: number;
  originalPrice: number;
  discountType: string | undefined;
  discountValue: number | undefined;
}

interface BookingSummaryCardProps {
  selectedService: Service;
  selectedClient: Client | null;
  availableEmployees: Employee[];
  selectedEmployeeId: string;
  selectedDate: string;
  selectedTimeSlot: string;
  promoCheck: PromotionCheck | null;
  promoCodeValidation: PromoCodeValidation | null;
  isBooking: boolean;
  getPromoCodeDiscount: () => PromoCodeDiscount | null;
  onBookAppointment: () => void;
}

export function BookingSummaryCard({
  selectedService,
  selectedClient,
  availableEmployees,
  selectedEmployeeId,
  selectedDate,
  selectedTimeSlot,
  promoCheck,
  promoCodeValidation,
  isBooking,
  getPromoCodeDiscount,
  onBookAppointment,
}: BookingSummaryCardProps) {
  const promoDiscount = getPromoCodeDiscount();
  const employee = availableEmployees.find((e) => e.id === selectedEmployeeId);
  const endTimeStr = calculateEndTime(selectedTimeSlot, selectedService.baseDuration);

  return (
    <Card className="mb-6 border-primary" data-testid="booking-summary-section">
      <CardHeader>
        <CardTitle className="text-lg">Podsumowanie rezerwacji</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4">
          {selectedClient && (
            <SummaryRow label="Klient" value={`${selectedClient.firstName} ${selectedClient.lastName}`} />
          )}
          <SummaryRow label="Usluga" value={selectedService.name} />
          <SummaryRow
            label="Pracownik"
            value={employee ? `${employee.firstName} ${employee.lastName}` : ""}
          />
          <SummaryRow label="Data" value={formatDateDisplay(selectedDate)} />
          <SummaryRow label="Godzina" value={`${selectedTimeSlot} - ${endTimeStr}`} />

          {/* Price row with possible discount */}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Cena:</span>
            <PriceDisplay
              selectedService={selectedService}
              promoDiscount={promoDiscount}
              promoCheck={promoCheck}
            />
          </div>

          {/* Promo code discount row */}
          {promoDiscount && (
            <div className="flex justify-between text-sm" data-testid="promo-code-discount-row">
              <span className="text-green-600 flex items-center gap-1">
                <Tag className="h-3 w-3" />
                Kod: {promoCodeValidation?.code}
              </span>
              <span className="font-medium text-green-600">
                -{promoDiscount.discountAmount.toFixed(2)} PLN
                {promoDiscount.discountType === "percentage" ? ` (${promoDiscount.discountValue}%)` : ""}
              </span>
            </div>
          )}

          {/* 2+1 promotion discount row */}
          {promoCheck?.eligible && !promoDiscount && (
            <div className="flex justify-between text-sm" data-testid="promo-discount-row">
              <span className="text-green-600 flex items-center gap-1">
                <Gift className="h-3 w-3" />
                Promocja 2+1:
              </span>
              <span className="font-medium text-green-600">
                -{promoCheck.discountAmount?.toFixed(2)} PLN ({promoCheck.discountPercent}%)
              </span>
            </div>
          )}

          <SummaryRow label="Czas trwania" value={`${selectedService.baseDuration} min`} />
        </div>
        <Button
          className="w-full"
          size="lg"
          onClick={onBookAppointment}
          disabled={isBooking}
          data-testid="book-appointment-btn"
        >
          {isBooking ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              Rezerwowanie...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5" />
              Zarezerwuj wizyte
            </div>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PriceDisplay({
  selectedService,
  promoDiscount,
  promoCheck,
}: {
  selectedService: Service;
  promoDiscount: PromoCodeDiscount | null;
  promoCheck: PromotionCheck | null;
}) {
  if (promoDiscount) {
    return (
      <div className="text-right">
        <span className="font-medium line-through text-muted-foreground mr-2">
          {promoDiscount.originalPrice.toFixed(2)} PLN
        </span>
        <span className="font-bold text-green-600" data-testid="discounted-price">
          {promoDiscount.finalPrice.toFixed(2)} PLN
        </span>
      </div>
    );
  }
  if (promoCheck?.eligible) {
    return (
      <div className="text-right">
        <span className="font-medium line-through text-muted-foreground mr-2">
          {parseFloat(selectedService.basePrice).toFixed(2)} PLN
        </span>
        <span className="font-bold text-green-600" data-testid="discounted-price">
          {promoCheck.finalPrice?.toFixed(2)} PLN
        </span>
      </div>
    );
  }
  return (
    <span className="font-medium">{parseFloat(selectedService.basePrice).toFixed(2)} PLN</span>
  );
}
