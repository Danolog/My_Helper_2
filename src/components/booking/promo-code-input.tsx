"use client";

import { forwardRef } from "react";
import {
  Check,
  Clock,
  Scissors,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ServiceItem, ServiceVariant } from "./types";
import { formatDuration } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VariantSelectorProps {
  /** Whether this step should be shown (service selected and has variants) */
  canShow: boolean;
  selectedService: ServiceItem | null;
  selectedVariantId: string;
  onVariantSelect: (variantId: string) => void;
}

// ---------------------------------------------------------------------------
// Component — step 2 in the booking flow when the selected service has
// multiple variants (e.g. short/medium/long hair for a haircut service)
// ---------------------------------------------------------------------------

export const VariantSelector = forwardRef<HTMLDivElement, VariantSelectorProps>(
  function VariantSelector(
    { canShow, selectedService, selectedVariantId, onVariantSelect },
    ref
  ) {
    if (!canShow || !selectedService) return null;

    return (
      <Card ref={ref} className="mb-6" data-testid="booking-step-variant">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge
              variant={selectedVariantId ? "default" : "outline"}
              className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
            >
              2
            </Badge>
            <Scissors className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Wybierz wariant</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {selectedService.variants.length > 0 ? (
            <div className="space-y-2">
              {selectedService.variants.map((variant) =>
                renderVariantOption(
                  variant,
                  selectedService,
                  selectedVariantId,
                  onVariantSelect
                )
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }
);

// ---------------------------------------------------------------------------
// Helper render function for individual variant options
// ---------------------------------------------------------------------------

function renderVariantOption(
  variant: ServiceVariant,
  service: ServiceItem,
  selectedVariantId: string,
  onVariantSelect: (variantId: string) => void
) {
  const priceModifier = variant.priceModifier
    ? parseFloat(variant.priceModifier)
    : 0;
  const durationModifier = variant.durationModifier || 0;
  const totalPrice = parseFloat(service.basePrice) + priceModifier;
  const totalDuration = service.baseDuration + durationModifier;
  const isSelected = selectedVariantId === variant.id;

  return (
    <div
      key={variant.id}
      className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/10 border-primary"
          : "hover:bg-muted/50"
      }`}
      onClick={() => onVariantSelect(variant.id)}
      data-testid={`booking-variant-option-${variant.id}`}
    >
      <div>
        <p className="font-medium">{variant.name}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(totalDuration)}
          </span>
          {priceModifier !== 0 && (
            <span
              className={`text-sm ${priceModifier > 0 ? "text-red-500" : "text-green-600"}`}
            >
              ({priceModifier > 0 ? "+" : ""}
              {priceModifier.toFixed(0)} PLN)
            </span>
          )}
          {durationModifier !== 0 && (
            <span className="text-sm text-muted-foreground">
              ({durationModifier > 0 ? "+" : ""}
              {durationModifier} min)
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-semibold">
          {totalPrice.toFixed(0)} PLN
        </Badge>
        {isSelected && (
          <Check className="w-5 h-5 text-primary" />
        )}
      </div>
    </div>
  );
}
