"use client";

import { Calendar, Clock, Scissors, User, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStatusLabel, getStatusVariant, formatDuration } from "./utils";
import type { AppointmentDetail } from "./types";

interface AppointmentInfoCardProps {
  appointment: AppointmentDetail;
}

export function AppointmentInfoCard({ appointment }: AppointmentInfoCardProps) {
  const startDate = new Date(appointment.startTime);
  const endDate = new Date(appointment.endTime);
  const durationMin = Math.round(
    (endDate.getTime() - startDate.getTime()) / 60000
  );

  return (
    <>
      {/* Allergy warning */}
      {appointment.client?.allergies && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
          data-testid="allergy-warning"
        >
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">
              Uwaga - alergie klienta
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
              {appointment.client.allergies}
            </p>
          </div>
        </div>
      )}

      {/* Appointment info */}
      <Card className="mb-6" data-testid="appointment-info-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Informacje o wizycie</CardTitle>
            <Badge variant={getStatusVariant(appointment.status)} data-testid="appointment-status">
              {getStatusLabel(appointment.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Data i godzina
              </p>
              <p className="text-sm flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-primary" />
                {startDate.toLocaleDateString("pl-PL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <p className="text-sm flex items-center gap-1.5 mt-1">
                <Clock className="h-4 w-4 text-primary" />
                {startDate.toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" - "}
                {endDate.toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="text-muted-foreground">
                  ({formatDuration(durationMin)})
                </span>
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Usluga
              </p>
              {appointment.service ? (
                <div>
                  <p className="text-sm flex items-center gap-1.5">
                    <Scissors className="h-4 w-4 text-primary" />
                    {appointment.service.name}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {parseFloat(appointment.service.basePrice).toFixed(2)} PLN |{" "}
                    {formatDuration(appointment.service.baseDuration)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak uslugi</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Klient
              </p>
              {appointment.client ? (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  <a
                    href={`/dashboard/clients/${appointment.client.id}`}
                    className="text-primary hover:underline"
                    data-testid="client-link"
                  >
                    {appointment.client.firstName} {appointment.client.lastName}
                  </a>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak klienta</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Pracownik
              </p>
              {appointment.employee ? (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  {appointment.employee.firstName} {appointment.employee.lastName}
                  {appointment.employee.color && (
                    <span
                      className="inline-block w-3 h-3 rounded-full border"
                      style={{ backgroundColor: appointment.employee.color }}
                    />
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak pracownika</p>
              )}
            </div>

          </div>
        </CardContent>
      </Card>
    </>
  );
}
