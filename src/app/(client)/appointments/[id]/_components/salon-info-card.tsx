"use client";

import Link from "next/link";
import { MapPin, Phone, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppointmentDetail } from "../_types";

interface SalonInfoCardProps {
  appointment: AppointmentDetail;
}

export function SalonInfoCard({ appointment }: SalonInfoCardProps) {
  return (
    <Card className="mb-4" data-testid="salon-detail-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MapPin className="w-5 h-5 text-primary" />
          Salon
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex justify-between text-sm"
          data-testid="detail-salon"
        >
          <span className="text-muted-foreground">Nazwa:</span>
          <Link
            href={`/salons/${appointment.salonId}`}
            className="font-medium text-primary hover:underline"
          >
            {appointment.salonName}
          </Link>
        </div>
        {appointment.salonAddress && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Adres:</span>
            <span className="font-medium text-right max-w-[200px]">
              {appointment.salonAddress}
            </span>
          </div>
        )}
        {appointment.salonPhone && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Telefon:</span>
            <a
              href={`tel:${appointment.salonPhone}`}
              className="font-medium flex items-center gap-1 text-primary hover:underline"
            >
              <Phone className="w-3 h-3" />
              {appointment.salonPhone}
            </a>
          </div>
        )}
        {appointment.salonEmail && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email:</span>
            <a
              href={`mailto:${appointment.salonEmail}`}
              className="font-medium flex items-center gap-1 text-primary hover:underline"
            >
              <Mail className="w-3 h-3" />
              {appointment.salonEmail}
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
