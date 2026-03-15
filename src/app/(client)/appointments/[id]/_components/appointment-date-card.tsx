"use client";

import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatDate,
  formatTime,
  formatDuration,
  computeEffectiveDuration,
} from "../_types";
import type { AppointmentDetail } from "../_types";

interface AppointmentDateCardProps {
  appointment: AppointmentDetail;
}

export function AppointmentDateCard({ appointment }: AppointmentDateCardProps) {
  const effectiveDuration = computeEffectiveDuration(appointment);

  return (
    <Card className="mb-4" data-testid="appointment-detail-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarDays className="w-5 h-5 text-primary" />
          Termin wizyty
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex justify-between text-sm"
          data-testid="detail-date"
        >
          <span className="text-muted-foreground">Data:</span>
          <span className="font-medium">
            {formatDate(appointment.startTime)}
          </span>
        </div>
        <div
          className="flex justify-between text-sm"
          data-testid="detail-time"
        >
          <span className="text-muted-foreground">Godzina:</span>
          <span className="font-medium">
            {formatTime(appointment.startTime)} -{" "}
            {formatTime(appointment.endTime)}
          </span>
        </div>
        {effectiveDuration > 0 && (
          <div
            className="flex justify-between text-sm"
            data-testid="detail-duration"
          >
            <span className="text-muted-foreground">Czas trwania:</span>
            <span className="font-medium">
              {formatDuration(effectiveDuration)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
