"use client";

import Link from "next/link";
import {
  Clock,
  Scissors,
  ChevronDown,
  ChevronUp,
  Tag,
  Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SalonDetail, ServiceItem, CategorizedServiceGroup } from "../_types";

interface SalonServicesProps {
  salon: SalonDetail;
  salonId: string;
  expandedServices: Set<string>;
  onToggleService: (serviceId: string) => void;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

function ServiceCard({
  service,
  isExpanded,
  onToggle,
  salonId,
}: {
  service: ServiceItem;
  isExpanded: boolean;
  onToggle: () => void;
  salonId: string;
}) {
  const hasDetails = service.description || service.variants.length > 0;

  return (
    <div
      className={`border rounded-lg transition-all ${hasDetails ? "cursor-pointer hover:border-primary/40 hover:shadow-sm" : ""}`}
      onClick={hasDetails ? onToggle : undefined}
      data-testid={`service-${service.id}`}
    >
      <div className="flex items-center justify-between p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{service.name}</p>
            {service.variants.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {service.variants.length} wariant{service.variants.length === 1 ? "" : service.variants.length < 5 ? "y" : "ow"}
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
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-semibold whitespace-nowrap">
            {parseFloat(service.basePrice).toFixed(0)} PLN
          </Badge>
          {!hasDetails && (
            <Link
              href={`/salons/${salonId}/services/${service.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:text-primary/80"
              data-testid={`service-details-link-${service.id}`}
            >
              <Eye className="w-4 h-4" />
            </Link>
          )}
          {hasDetails && (
            <div className="text-muted-foreground">
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expandable details */}
      {isExpanded && hasDetails && (
        <div className="px-3 pb-3 border-t bg-muted/30">
          {service.description && (
            <p className="text-sm text-muted-foreground mt-2 mb-2">
              {service.description}
            </p>
          )}
          {service.variants.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Warianty
              </p>
              <div className="space-y-1.5">
                {service.variants.map((variant) => {
                  const priceModifier = variant.priceModifier
                    ? parseFloat(variant.priceModifier)
                    : 0;
                  const durationModifier = variant.durationModifier || 0;
                  const totalPrice =
                    parseFloat(service.basePrice) + priceModifier;
                  const totalDuration =
                    service.baseDuration + durationModifier;

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
                          {priceModifier !== 0 && (
                            <span
                              className={`text-xs ${priceModifier > 0 ? "text-red-500" : "text-green-600"}`}
                            >
                              ({priceModifier > 0 ? "+" : ""}
                              {priceModifier.toFixed(0)} PLN)
                            </span>
                          )}
                          {durationModifier !== 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({durationModifier > 0 ? "+" : ""}
                              {durationModifier} min)
                            </span>
                          )}
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
          )}
          <div className="mt-3 flex justify-end">
            <Link
              href={`/salons/${salonId}/services/${service.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              data-testid={`service-details-link-${service.id}`}
            >
              <Eye className="w-3.5 h-3.5" />
              Szczegoly uslugi
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Groups services by category, sorting named categories by sortOrder
 * and placing uncategorized services last.
 */
function getCategorizedServices(salon: SalonDetail): CategorizedServiceGroup[] {
  const categorizedServices: CategorizedServiceGroup[] = [];

  // Build a map of categories from the salon data
  const categoryMap = new Map<string, string>();
  if (salon.categories) {
    for (const cat of salon.categories) {
      categoryMap.set(cat.id, cat.name);
    }
  }

  // Group services
  const servicesByCategory = new Map<string | null, ServiceItem[]>();
  for (const service of salon.services) {
    const catId = service.categoryId;
    if (!servicesByCategory.has(catId)) {
      servicesByCategory.set(catId, []);
    }
    servicesByCategory.get(catId)!.push(service);
  }

  // Sort categories: named categories first (sorted by their sortOrder), then uncategorized last
  const sortedCategoryIds = Array.from(servicesByCategory.keys()).sort(
    (a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      const catA = salon.categories?.find((c) => c.id === a);
      const catB = salon.categories?.find((c) => c.id === b);
      return (catA?.sortOrder ?? 999) - (catB?.sortOrder ?? 999);
    }
  );

  for (const catId of sortedCategoryIds) {
    const servicesInCat = servicesByCategory.get(catId) || [];
    categorizedServices.push({
      categoryId: catId,
      categoryName: catId ? categoryMap.get(catId) || "Inne" : "Inne uslugi",
      services: servicesInCat,
    });
  }

  return categorizedServices;
}

export function SalonServices({
  salon,
  salonId,
  expandedServices,
  onToggleService,
}: SalonServicesProps) {
  const categorizedServices = getCategorizedServices(salon);
  const hasMultipleCategories = categorizedServices.length > 1;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scissors className="w-5 h-5" />
          Uslugi ({salon.services.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {salon.services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Brak dostepnych uslug
          </p>
        ) : hasMultipleCategories ? (
          // Show services grouped by category
          <div className="space-y-6">
            {categorizedServices.map((group) => (
              <div key={group.categoryId || "uncategorized"}>
                <div className="flex items-center gap-2 mb-3">
                  <Tag className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">
                    {group.categoryName}
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {group.services.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {group.services.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      isExpanded={expandedServices.has(service.id)}
                      onToggle={() => onToggleService(service.id)}
                      salonId={salonId}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Single category or no categories - flat list
          <div className="space-y-2">
            {salon.services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                isExpanded={expandedServices.has(service.id)}
                onToggle={() => onToggleService(service.id)}
                salonId={salonId}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
