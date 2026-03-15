"use client";

import { useRouter } from "next/navigation";
import { Clock, DollarSign, ChevronRight, Trash2, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { NO_CATEGORY } from "../_types";
import type { Service, ServiceCategory } from "../_types";

/** Format a price string to two decimal places */
function formatPrice(price: string): string {
  return parseFloat(price).toFixed(2);
}

/** Format a duration in minutes to a human-readable string */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
}

interface ServiceCardProps {
  service: Service;
  categories: ServiceCategory[];
  onAssignCategory: (serviceId: string, categoryId: string | null) => Promise<void>;
  onDelete: (service: Service) => void;
}

export function ServiceCard({
  service,
  categories,
  onAssignCategory,
  onDelete,
}: ServiceCardProps) {
  const router = useRouter();

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      data-testid={`service-card-${service.id}`}
      onClick={() => router.push(`/dashboard/services/${service.id}`)}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-base">{service.name}</span>
            <Badge variant={service.isActive ? "default" : "secondary"}>
              {service.isActive ? "Aktywna" : "Nieaktywna"}
            </Badge>
            {service.category && (
              <Badge variant="outline">{service.category.name}</Badge>
            )}
          </div>
          {service.description && (
            <p className="text-sm text-muted-foreground mb-2">
              {service.description}
            </p>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              {formatPrice(service.basePrice)} PLN
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(service.baseDuration)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Category quick-assign dropdown */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="mr-1"
          >
            <Select
              value={service.categoryId || NO_CATEGORY}
              onValueChange={(value) =>
                onAssignCategory(service.id, value === NO_CATEGORY ? null : value)
              }
            >
              <SelectTrigger
                className="h-8 w-8 p-0 border-0 bg-transparent [&>svg]:hidden"
                data-testid={`assign-category-${service.id}`}
              >
                <Tag className="h-4 w-4 text-muted-foreground" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Bez kategorii</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(service);
            }}
            data-testid={`delete-service-${service.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}
