"use client";

import {
  FileText,
  Wallet,
  ShieldCheck,
  CreditCard,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { computeEffectivePrice } from "../_types";
import type { AppointmentDetail } from "../_types";

interface ReceiptCardProps {
  appointment: AppointmentDetail;
}

export function ReceiptCard({ appointment }: ReceiptCardProps) {
  const effectivePrice = computeEffectivePrice(appointment);
  const basePrice = appointment.servicePrice
    ? parseFloat(appointment.servicePrice)
    : 0;
  const variantPriceModifier = appointment.variantPriceModifier
    ? parseFloat(appointment.variantPriceModifier)
    : 0;

  return (
    <Card className="mb-4" data-testid="receipt-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="w-5 h-5 text-primary" />
          Podsumowanie kosztow
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {appointment.serviceName}
            {appointment.variantName ? ` - ${appointment.variantName}` : ""}
          </span>
          <span className="font-medium">
            {effectivePrice.toFixed(2)} PLN
          </span>
        </div>
        {appointment.variantPriceModifier && variantPriceModifier !== 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              Cena bazowa: {basePrice.toFixed(2)} PLN + wariant:{" "}
              {variantPriceModifier > 0 ? "+" : ""}
              {variantPriceModifier.toFixed(2)} PLN
            </span>
          </div>
        )}

        {/* Deposit info */}
        {appointment.depositAmount &&
          parseFloat(appointment.depositAmount) > 0 && (
            <>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Wallet className="w-3 h-3" />
                  Zadatek:
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                  </span>
                  {appointment.depositPaid ? (
                    <Badge
                      variant="outline"
                      className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300"
                    >
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Oplacony
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                    >
                      Oczekujacy
                    </Badge>
                  )}
                </div>
              </div>
              {appointment.depositPaid && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Do zaplaty w salonie:
                  </span>
                  <span className="font-semibold">
                    {(
                      effectivePrice - parseFloat(appointment.depositAmount)
                    ).toFixed(2)}{" "}
                    PLN
                  </span>
                </div>
              )}
            </>
          )}

        <Separator />
        <div
          className="flex justify-between text-base font-semibold"
          data-testid="detail-total-price"
        >
          <span>Razem:</span>
          <span>{effectivePrice.toFixed(2)} PLN</span>
        </div>

        {/* Deposit payment details */}
        {appointment.depositPayment && (
          <DepositPaymentDetails depositPayment={appointment.depositPayment} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Private sub-component for deposit payment details
// ---------------------------------------------------------------------------

interface DepositPaymentDetailsProps {
  depositPayment: NonNullable<AppointmentDetail["depositPayment"]>;
}

function DepositPaymentDetails({
  depositPayment,
}: DepositPaymentDetailsProps) {
  return (
    <div className="mt-3 p-3 bg-muted/50 rounded-md">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Platnosc zadatku:
      </p>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Metoda:</span>
          <span className="flex items-center gap-1">
            <CreditCard className="w-3 h-3" />
            {depositPayment.paymentMethod === "stripe" ? "Karta" : "BLIK P2P"}
          </span>
        </div>
        {depositPayment.paymentMethod === "blik" &&
          depositPayment.blikPhoneNumber && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Telefon BLIK:</span>
              <span>{depositPayment.blikPhoneNumber}</span>
            </div>
          )}
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Status:</span>
          <span
            className={
              depositPayment.status === "succeeded"
                ? "text-green-600"
                : depositPayment.status === "refunded"
                  ? "text-blue-600"
                  : depositPayment.status === "forfeited"
                    ? "text-red-600 font-medium"
                    : ""
            }
          >
            {depositPayment.status === "succeeded"
              ? "Zrealizowana"
              : depositPayment.status === "refunded"
                ? "Zwrocona"
                : depositPayment.status === "forfeited"
                  ? "Przepadek (zatrzymana przez salon)"
                  : depositPayment.status}
          </span>
        </div>
        {depositPayment.paidAt && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Data platnosci:</span>
            <span>
              {new Date(depositPayment.paidAt).toLocaleDateString("pl-PL")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
