"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Clock } from "lucide-react";
import type { ServiceDetail } from "../_types";
import { formatPrice, formatDuration } from "../_types";

interface ServiceDetailsCardProps {
  service: ServiceDetail;
}

export function ServiceDetailsCard({ service }: ServiceDetailsCardProps) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">Szczegoly uslugi</CardTitle>
      </CardHeader>
      <CardContent>
        {service.description && (
          <p className="text-muted-foreground mb-4">{service.description}</p>
        )}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium" data-testid="service-base-price">
              {formatPrice(service.basePrice)} PLN
            </span>
            <span className="text-sm text-muted-foreground">(cena bazowa)</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium" data-testid="service-base-duration">
              {formatDuration(service.baseDuration)}
            </span>
            <span className="text-sm text-muted-foreground">
              (czas bazowy)
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
