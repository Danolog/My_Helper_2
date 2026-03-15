"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Scissors,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_DEPOSIT_PERCENTAGE } from "@/lib/constants";
import type { ServiceItem, ServiceCategory, ServiceVariant } from "./types";
import { formatDuration } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CategorizedGroup {
  categoryId: string | null;
  categoryName: string;
  services: ServiceItem[];
}

interface ServiceSelectorProps {
  services: ServiceItem[];
  categories: ServiceCategory[];
  selectedServiceId: string;
  expandedServices: Set<string>;
  onServiceSelect: (serviceId: string) => void;
  onToggleExpanded: (serviceId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCategorizedServices(
  services: ServiceItem[],
  categories: ServiceCategory[]
): CategorizedGroup[] {
  const categoryMap = new Map<string, string>();
  for (const cat of categories) {
    categoryMap.set(cat.id, cat.name);
  }

  const servicesByCategory = new Map<string | null, ServiceItem[]>();
  for (const service of services) {
    const catId = service.categoryId;
    if (!servicesByCategory.has(catId)) {
      servicesByCategory.set(catId, []);
    }
    servicesByCategory.get(catId)!.push(service);
  }

  const sortedCategoryIds = Array.from(servicesByCategory.keys()).sort(
    (a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      const catA = categories.find((c) => c.id === a);
      const catB = categories.find((c) => c.id === b);
      return (catA?.sortOrder ?? 999) - (catB?.sortOrder ?? 999);
    }
  );

  return sortedCategoryIds.map((catId) => ({
    categoryId: catId,
    categoryName: catId ? categoryMap.get(catId) || "Inne" : "Inne uslugi",
    services: servicesByCategory.get(catId) || [],
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ServiceSelector({
  services,
  categories,
  selectedServiceId,
  expandedServices,
  onServiceSelect,
  onToggleExpanded,
}: ServiceSelectorProps) {
  const categorizedServices = buildCategorizedServices(services, categories);
  const hasMultipleCategories = categorizedServices.length > 1;

  function renderServiceOption(service: ServiceItem) {
    const isSelected = selectedServiceId === service.id;
    const isExpanded = expandedServices.has(service.id);
    const hasServiceVariants = service.variants.length > 0;
    return (
      <div
        key={service.id}
        className={`border rounded-lg transition-all ${
          isSelected
            ? "bg-primary/10 border-primary"
            : "hover:bg-muted/50 cursor-pointer"
        }`}
        data-testid={`booking-service-option-${service.id}`}
      >
        <div
          className="flex items-center justify-between p-3 cursor-pointer"
          onClick={() => onServiceSelect(service.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm">{service.name}</p>
              {hasServiceVariants && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {service.variants.length}{" "}
                  {service.variants.length === 1
                    ? "wariant"
                    : service.variants.length < 5
                      ? "warianty"
                      : "wariantow"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatDuration(service.baseDuration)}
                </span>
              </div>
              {service.depositRequired && (
                <div className="flex items-center gap-1">
                  <CreditCard className="w-3 h-3 text-amber-500" />
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    Zadatek {service.depositPercentage ?? DEFAULT_DEPOSIT_PERCENTAGE}%
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-semibold whitespace-nowrap">
              {parseFloat(service.basePrice).toFixed(0)} PLN
            </Badge>
            {isSelected && <Check className="w-5 h-5 text-primary" />}
            {hasServiceVariants && (
              <button
                type="button"
                className="text-muted-foreground p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpanded(service.id);
                }}
              >
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Show variants preview when expanded */}
        {isExpanded && hasServiceVariants && (
          <VariantPreview
            variants={service.variants}
            basePrice={service.basePrice}
            baseDuration={service.baseDuration}
          />
        )}
      </div>
    );
  }

  return (
    <Card className="mb-6" data-testid="booking-step-service">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge
            variant={selectedServiceId ? "default" : "outline"}
            className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
          >
            1
          </Badge>
          <Scissors className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Wybierz usluge</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Brak dostepnych uslug w tym salonie.
          </p>
        ) : hasMultipleCategories ? (
          <div className="space-y-5">
            {categorizedServices.map((group) => (
              <div key={group.categoryId || "uncategorized"}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {group.categoryName}
                </p>
                <div className="space-y-2">
                  {group.services.map((service) =>
                    renderServiceOption(service)
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {services.map((service) => renderServiceOption(service))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Variant preview sub-component (shown when a service row is expanded)
// ---------------------------------------------------------------------------

function VariantPreview({
  variants,
  basePrice,
  baseDuration,
}: {
  variants: ServiceVariant[];
  basePrice: string;
  baseDuration: number;
}) {
  return (
    <div className="px-3 pb-3 border-t bg-muted/30">
      <p className="text-xs font-medium text-muted-foreground mt-2 mb-1.5 uppercase tracking-wider">
        Warianty (wybierzesz w nastepnym kroku)
      </p>
      <div className="space-y-1.5">
        {variants.map((variant) => {
          const priceModifier = variant.priceModifier
            ? parseFloat(variant.priceModifier)
            : 0;
          const durationModifier = variant.durationModifier || 0;
          const totalPrice = parseFloat(basePrice) + priceModifier;
          const totalDuration = baseDuration + durationModifier;

          return (
            <div
              key={variant.id}
              className="flex items-center justify-between py-1.5 px-2 rounded bg-background text-sm"
            >
              <div>
                <span className="font-medium">{variant.name}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(totalDuration)}
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="text-xs">
                {totalPrice.toFixed(0)} PLN
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
