"use client";

import { Scissors, Gift } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Service, PromotionCheck } from "../_types";

interface ServiceSelectCardProps {
  services: Service[];
  selectedServiceId: string;
  selectedService: Service | null;
  loadingServices: boolean;
  selectedClientId: string;
  promoCheck: PromotionCheck | null;
  loadingPromo: boolean;
  onServiceChange: (serviceId: string) => void;
}

export function ServiceSelectCard({
  services,
  selectedServiceId,
  selectedService,
  loadingServices,
  selectedClientId,
  promoCheck,
  loadingPromo,
  onServiceChange,
}: ServiceSelectCardProps) {
  return (
    <Card className="mb-6" data-testid="booking-service-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Scissors className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">2. Wybierz usluge</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loadingServices ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <Select
            value={selectedServiceId}
            onValueChange={onServiceChange}
          >
            <SelectTrigger data-testid="booking-service-select">
              <SelectValue placeholder="Wybierz usluge..." />
            </SelectTrigger>
            <SelectContent>
              {services.map((svc) => (
                <SelectItem key={svc.id} value={svc.id}>
                  {svc.name} - {parseFloat(svc.basePrice).toFixed(2)} PLN ({svc.baseDuration} min)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {selectedService && (
          <div className="mt-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{selectedService.name}</span>
            {" "}&bull;{" "}
            {parseFloat(selectedService.basePrice).toFixed(2)} PLN
            {" "}&bull;{" "}
            {selectedService.baseDuration} min
          </div>
        )}
        {/* Promotion loading indicator */}
        {loadingPromo && selectedClientId && selectedServiceId && (
          <div className="flex items-center gap-2 mt-3 p-3 rounded-md border bg-muted/50">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
            <span className="text-sm text-muted-foreground">Sprawdzanie promocji...</span>
          </div>
        )}
        {/* Promotion check result */}
        {promoCheck && !loadingPromo && selectedClientId && selectedServiceId && (
          <PromotionIndicator promoCheck={promoCheck} />
        )}
      </CardContent>
    </Card>
  );
}

/** Displays promotion eligibility status beneath the service selector */
function PromotionIndicator({ promoCheck }: { promoCheck: PromotionCheck }) {
  return (
    <div
      className={`flex items-start gap-2 mt-3 p-3 rounded-md border ${
        promoCheck.eligible
          ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
          : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
      }`}
      data-testid="promo-check-indicator"
    >
      <Gift className={`h-4 w-4 shrink-0 mt-0.5 ${promoCheck.eligible ? "text-green-600" : "text-blue-500"}`} />
      <div className="text-sm">
        {promoCheck.eligible ? (
          <>
            <p className="font-semibold text-green-800 dark:text-green-300">
              Promocja 2+1: {promoCheck.discountPercent}% znizki!
            </p>
            <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
              {promoCheck.promotionName} - Cena po rabacie:{" "}
              <span className="font-bold">{promoCheck.finalPrice?.toFixed(2)} PLN</span>
              {" "}(zamiast {promoCheck.originalPrice?.toFixed(2)} PLN)
            </p>
          </>
        ) : promoCheck.remainingForPromo !== undefined ? (
          <>
            <p className="text-blue-800 dark:text-blue-300">
              Promocja 2+1 dostepna!
            </p>
            <p className="text-blue-700 dark:text-blue-400 text-xs mt-0.5">
              Jeszcze {promoCheck.remainingForPromo} wizyt(y) do darmowej uslugi
              {promoCheck.promotionName ? ` (${promoCheck.promotionName})` : ""}
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
