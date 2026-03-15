"use client";

import { RefreshCw, CheckCircle, Ban, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppointmentDetail, RefundStatus } from "./types";

interface AppointmentRefundStatusProps {
  appointment: AppointmentDetail;
  refundStatus: RefundStatus | null;
}

/**
 * Renders the refund status card for cancelled appointments with deposits,
 * and the deposit info card for non-cancelled appointments with deposits.
 */
export function AppointmentRefundStatus({
  appointment,
  refundStatus,
}: AppointmentRefundStatusProps) {
  return (
    <>
      {/* Refund Status Section (shown for cancelled appointments with deposits) */}
      {appointment.status === "cancelled" && refundStatus && refundStatus.hasDeposit && (
        <Card className="mb-6" data-testid="refund-status-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">
                {refundStatus.refundStatus === "forfeited" ? "Zadatek - przepadek" : "Status zwrotu zadatku"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className={`p-4 rounded-lg border ${
                refundStatus.refundStatus === "refunded"
                  ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
                  : refundStatus.refundStatus === "forfeited"
                    ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                    : refundStatus.paymentStatus === "succeeded" && !appointment.depositPaid
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
                      : "bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700"
              }`}
            >
              <div className="flex items-start gap-3">
                {refundStatus.refundStatus === "refunded" ? (
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                ) : refundStatus.refundStatus === "forfeited" ? (
                  <Ban className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                ) : (
                  <Ban className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                )}
                <div className="space-y-2 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold" data-testid="refund-status-label">
                      {refundStatus.refundStatus === "refunded"
                        ? "Zwrot zrealizowany"
                        : refundStatus.refundStatus === "forfeited"
                          ? "Zadatek przepadl - zatrzymany przez salon"
                          : "Zadatek zatrzymany"}
                    </p>
                    <Badge
                      variant={refundStatus.refundStatus === "refunded" ? "default" : "destructive"}
                      data-testid="refund-status-badge"
                    >
                      {refundStatus.refundStatus === "refunded"
                        ? "Zwrocono"
                        : refundStatus.refundStatus === "forfeited"
                          ? "Przepadek"
                          : "Brak zwrotu"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Kwota zadatku: </span>
                      <span className="font-medium" data-testid="refund-amount">
                        {refundStatus.depositAmount?.toFixed(2)} PLN
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Metoda platnosci: </span>
                      <span className="font-medium">
                        {refundStatus.paymentMethod === "stripe" ? "Karta (Stripe)" : "BLIK P2P"}
                      </span>
                    </div>
                    {refundStatus.refundedAt && (
                      <div>
                        <span className="text-muted-foreground">Data zwrotu: </span>
                        <span className="font-medium" data-testid="refund-date">
                          {new Date(refundStatus.refundedAt).toLocaleDateString("pl-PL", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    )}
                    {refundStatus.stripeRefundId && (
                      <div>
                        <span className="text-muted-foreground">ID zwrotu: </span>
                        <span className="font-mono text-xs" data-testid="refund-id">
                          {refundStatus.stripeRefundId}
                        </span>
                      </div>
                    )}
                  </div>
                  {refundStatus.refundReason && (
                    <p className="text-sm text-muted-foreground mt-1" data-testid="refund-reason">
                      Powod: {refundStatus.refundReason}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deposit Info for non-cancelled appointments */}
      {appointment.status !== "cancelled" && appointment.depositAmount && parseFloat(appointment.depositAmount) > 0 && (
        <Card className="mb-6" data-testid="deposit-info-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Zadatek</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div>
                <span className="text-muted-foreground text-sm">Kwota: </span>
                <span className="font-semibold">{parseFloat(appointment.depositAmount).toFixed(2)} PLN</span>
              </div>
              <Badge variant={appointment.depositPaid ? "default" : "outline"} data-testid="deposit-paid-badge">
                {appointment.depositPaid ? "Oplacony" : "Nieoplacony"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
