"use client";

import {
  BarChart3,
  XCircle,
  Percent,
  DollarSign,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";
import { getRateColor } from "../_types";
import { DeltaIndicator } from "./delta-indicator";

interface SummaryCardsProps {
  reportData: ReportData;
}

export function SummaryCards({ reportData }: SummaryCardsProps) {
  const { summary, comparison } = reportData;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Total appointments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Laczna liczba wizyt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            {summary.totalAppointments}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Zrealizowanych: {summary.completedCount}
          </p>
          {comparison && (
            <div className="mt-1">
              <DeltaIndicator
                value={comparison.deltas.totalAppointments}
                invertColors
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancellations + no-shows */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Anulowane + nieobecnosci
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1">
            <XCircle className="h-5 w-5 text-red-600" />
            {summary.cancellationCount}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {summary.cancelledCount} anulowanych, {summary.noShowCount}{" "}
            nieobecnosci
          </p>
          {comparison && (
            <div className="mt-1">
              <DeltaIndicator value={comparison.deltas.cancellationCount} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancellation rate */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Wskaznik anulacji
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold flex items-center gap-1 ${getRateColor(summary.cancellationRate)}`}
          >
            <Percent className="h-5 w-5" />
            {summary.cancellationRate}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {parseFloat(summary.cancellationRate) < 10
              ? "Dobry wynik"
              : parseFloat(summary.cancellationRate) < 20
                ? "Do poprawy"
                : "Wymaga uwagi"}
          </p>
          {comparison && (
            <div className="mt-1">
              <DeltaIndicator
                value={parseFloat(comparison.deltas.cancellationRate)}
              />
              <span className="text-xs text-muted-foreground ml-1">pp</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Net lost revenue */}
      <Card className="border-red-200 bg-red-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-red-700">
            Rzeczywisty utracony przychod
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1 text-red-600">
            <DollarSign className="h-5 w-5" />
            {parseFloat(summary.netLostRevenue).toFixed(2)} PLN
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Po uwzglednieniu {summary.replacedCount} zastepstw
          </p>
          {comparison && (
            <div className="mt-1">
              <DeltaIndicator
                value={parseFloat(comparison.deltas.netLostRevenue)}
              />
              <span className="text-xs text-muted-foreground ml-1">PLN</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
