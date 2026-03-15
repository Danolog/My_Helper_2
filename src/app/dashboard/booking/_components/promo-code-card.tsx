"use client";

import { Tag, Check, AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PromoCodeValidation } from "../_types";

interface PromoCodeDiscount {
  discountAmount: number;
  finalPrice: number;
  originalPrice: number;
  discountType: string | undefined;
  discountValue: number | undefined;
}

interface PromoCodeCardProps {
  promoCodeInput: string;
  promoCodeValidation: PromoCodeValidation | null;
  validatingPromoCode: boolean;
  selectedServiceId: string;
  onPromoCodeInputChange: (value: string) => void;
  onValidatePromoCode: () => void;
  onClearPromoCode: () => void;
  getPromoCodeDiscount: () => PromoCodeDiscount | null;
}

export function PromoCodeCard({
  promoCodeInput,
  promoCodeValidation,
  validatingPromoCode,
  selectedServiceId,
  onPromoCodeInputChange,
  onValidatePromoCode,
  onClearPromoCode,
  getPromoCodeDiscount,
}: PromoCodeCardProps) {
  return (
    <Card className="mb-6" data-testid="booking-promo-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">6. Kod promocyjny (opcjonalnie)</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Wpisz kod promocyjny..."
            value={promoCodeInput}
            onChange={(e) => onPromoCodeInputChange(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onValidatePromoCode();
              }
            }}
            disabled={validatingPromoCode || (promoCodeValidation?.valid === true)}
            className="flex-1"
            data-testid="promo-code-input"
          />
          {promoCodeValidation?.valid ? (
            <Button
              variant="outline"
              onClick={onClearPromoCode}
              data-testid="promo-code-clear-btn"
            >
              <X className="h-4 w-4 mr-1" />
              Usun
            </Button>
          ) : (
            <Button
              onClick={onValidatePromoCode}
              disabled={validatingPromoCode || !promoCodeInput.trim()}
              data-testid="promo-code-apply-btn"
            >
              {validatingPromoCode ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Zastosuj
            </Button>
          )}
        </div>

        {/* Promo code validation result */}
        {promoCodeValidation && (
          <PromoCodeResult
            validation={promoCodeValidation}
            selectedServiceId={selectedServiceId}
            getPromoCodeDiscount={getPromoCodeDiscount}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PromoCodeResult({
  validation,
  selectedServiceId,
  getPromoCodeDiscount,
}: {
  validation: PromoCodeValidation;
  selectedServiceId: string;
  getPromoCodeDiscount: () => PromoCodeDiscount | null;
}) {
  return (
    <div
      className={`mt-3 p-3 rounded-md border ${
        validation.valid
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
          : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
      }`}
      data-testid="promo-code-result"
    >
      {validation.valid ? (
        <div className="flex items-start gap-2">
          <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-green-800 dark:text-green-300">
              Kod &quot;{validation.code}&quot; zastosowany!
            </p>
            {validation.promotionName && (
              <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
                {validation.promotionName}
                {validation.discountType === "percentage" && validation.discountValue
                  ? ` - ${validation.discountValue}% znizki`
                  : validation.discountType === "fixed" && validation.discountValue
                    ? ` - ${validation.discountValue.toFixed(2)} PLN znizki`
                    : ""}
              </p>
            )}
            {validation.usageLimit != null && (
              <p className="text-green-600 dark:text-green-500 text-xs mt-0.5">
                Uzyto: {validation.usedCount || 0}/{validation.usageLimit}
              </p>
            )}
            {/* Show if service is not eligible */}
            {(() => {
              const discount = getPromoCodeDiscount();
              if (!discount && selectedServiceId) {
                return (
                  <p className="text-orange-600 dark:text-orange-400 text-xs mt-1">
                    <AlertCircle className="h-3 w-3 inline mr-1" />
                    Ta usluga nie kwalifikuje sie do tej promocji
                  </p>
                );
              }
              return null;
            })()}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-red-800 dark:text-red-300" data-testid="promo-error-title">
              {validation.errorType === "expired"
                ? "Kod wygasl"
                : validation.errorType === "usage_limit"
                  ? "Limit uzycia wyczerpany"
                  : validation.errorType === "promotion_inactive"
                    ? "Promocja nieaktywna"
                    : validation.errorType === "promotion_not_started"
                      ? "Promocja jeszcze nie rozpoczeta"
                      : validation.errorType === "promotion_ended"
                        ? "Promocja zakonczona"
                        : "Nieprawidlowy kod"}
            </p>
            <p className="text-red-700 dark:text-red-400 text-xs mt-0.5" data-testid="promo-error-reason">
              {validation.reason || "Kod nie istnieje lub jest niewazny"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
