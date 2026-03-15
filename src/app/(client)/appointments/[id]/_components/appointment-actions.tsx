"use client";

import Link from "next/link";
import {
  Ban,
  CalendarX,
  CalendarDays,
  ArrowLeft,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AppointmentDetail } from "../_types";

interface AppointmentActionsProps {
  appointment: AppointmentDetail;
  canCancel: boolean;
  onOpenCancelDialog: () => void;
}

export function AppointmentActions({
  appointment,
  canCancel,
  onOpenCancelDialog,
}: AppointmentActionsProps) {
  return (
    <div className="flex flex-col gap-3 mt-6">
      {/* Cancel button - only for upcoming appointments */}
      {canCancel && (
        <Button
          variant="destructive"
          onClick={onOpenCancelDialog}
          data-testid="cancel-appointment-btn"
        >
          <Ban className="w-4 h-4 mr-2" />
          Anuluj wizyte
        </Button>
      )}

      {/* Cancelled status message */}
      {appointment.status === "cancelled" && (
        <CancelledStatusCard appointment={appointment} />
      )}

      <Button asChild variant="outline">
        <Link href={`/salons/${appointment.salonId}/book`}>
          <CalendarDays className="w-4 h-4 mr-2" />
          Zarezerwuj ponownie w tym salonie
        </Link>
      </Button>
      <Button asChild variant="ghost">
        <Link href="/appointments">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Powrot do moich wizyt
        </Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Private sub-component for cancelled appointment status
// ---------------------------------------------------------------------------

function CancelledStatusCard({
  appointment,
}: {
  appointment: AppointmentDetail;
}) {
  return (
    <Card
      className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
      data-testid="cancelled-status-card"
    >
      <CardContent className="py-4">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <CalendarX className="w-5 h-5" />
          <span className="font-medium">Ta wizyta zostala anulowana</span>
        </div>

        {/* Show forfeited deposit info */}
        {appointment.depositPayment?.status === "forfeited" &&
          appointment.depositAmount && (
            <div
              className="mt-3 p-3 rounded-md bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800"
              data-testid="forfeited-deposit-info"
            >
              <div className="flex items-start gap-2">
                <DollarSign className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-red-700 dark:text-red-400">
                    Zadatek przepadl:{" "}
                    {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                  </p>
                  <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                    Anulacja mniej niz 24h przed wizyta - zadatek nie podlega
                    zwrotowi i zostaje zatrzymany przez salon.
                  </p>
                </div>
              </div>
            </div>
          )}

        {/* Show refunded deposit info */}
        {appointment.depositPayment?.status === "refunded" &&
          appointment.depositAmount && (
            <div
              className="mt-3 p-3 rounded-md bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
              data-testid="refunded-deposit-info"
            >
              <div className="flex items-start gap-2">
                <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-blue-700 dark:text-blue-400">
                    Zadatek zwrocony:{" "}
                    {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                  </p>
                  <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                    Zwrot zostanie przetworzony w ciagu 5-10 dni roboczych.
                  </p>
                </div>
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
