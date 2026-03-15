"use client";

import { Scissors } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppointmentDetail } from "../_types";

interface ServiceInfoCardProps {
  appointment: AppointmentDetail;
}

export function ServiceInfoCard({ appointment }: ServiceInfoCardProps) {
  return (
    <Card className="mb-4" data-testid="service-detail-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scissors className="w-5 h-5 text-primary" />
          Usluga
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex justify-between text-sm"
          data-testid="detail-service"
        >
          <span className="text-muted-foreground">Usluga:</span>
          <span className="font-medium">{appointment.serviceName}</span>
        </div>
        {appointment.variantName && (
          <div
            className="flex justify-between text-sm"
            data-testid="detail-variant"
          >
            <span className="text-muted-foreground">Wariant:</span>
            <span className="font-medium">{appointment.variantName}</span>
          </div>
        )}
        {appointment.serviceDescription && (
          <div className="text-sm" data-testid="detail-service-desc">
            <span className="text-muted-foreground">Opis: </span>
            <span>{appointment.serviceDescription}</span>
          </div>
        )}
        <div
          className="flex justify-between text-sm"
          data-testid="detail-employee"
        >
          <span className="text-muted-foreground">Pracownik:</span>
          <div className="flex items-center gap-1.5">
            {appointment.employeeColor && (
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: appointment.employeeColor }}
              />
            )}
            <span className="font-medium">{appointment.employeeName}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
