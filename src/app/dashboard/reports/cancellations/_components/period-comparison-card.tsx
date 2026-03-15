"use client";

import { TrendingUp, TrendingDown, Minus, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface PeriodComparisonCardProps {
  reportData: ReportData;
}

export function PeriodComparisonCard({
  reportData,
}: PeriodComparisonCardProps) {
  const { comparison } = reportData;
  if (!comparison) return null;

  const deltaNetLost = parseFloat(comparison.deltas.netLostRevenue);

  return (
    <Card className="mb-6 border-blue-200 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Scale className="h-5 w-5 text-blue-600" />
          Porownanie okresow
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Current period */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">Biezacy okres</p>
            <p className="text-sm font-medium">
              {reportData.filters.dateFrom} - {reportData.filters.dateTo}
            </p>
            <p className="text-lg font-bold text-red-600 mt-1">
              {parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN
            </p>
            <p className="text-xs text-muted-foreground">
              {reportData.summary.cancellationCount} anulacji (
              {reportData.summary.cancellationRate}%)
            </p>
          </div>

          {/* Comparison period */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Okres porownawczy
            </p>
            <p className="text-sm font-medium">
              {comparison.period.dateFrom} - {comparison.period.dateTo}
            </p>
            <p className="text-lg font-bold text-red-600 mt-1">
              {parseFloat(comparison.summary.netLostRevenue).toFixed(2)} PLN
            </p>
            <p className="text-xs text-muted-foreground">
              {comparison.summary.cancellationCount} anulacji (
              {comparison.summary.cancellationRate}%)
            </p>
          </div>

          {/* Delta */}
          <div>
            <p className="text-sm text-muted-foreground mb-1">Zmiana</p>
            <div className="flex items-center gap-2 mt-1">
              {deltaNetLost > 0 ? (
                <TrendingUp className="h-5 w-5 text-red-600" />
              ) : deltaNetLost < 0 ? (
                <TrendingDown className="h-5 w-5 text-green-600" />
              ) : (
                <Minus className="h-5 w-5 text-muted-foreground" />
              )}
              <span
                className={`text-lg font-bold ${
                  deltaNetLost > 0
                    ? "text-red-600"
                    : deltaNetLost < 0
                      ? "text-green-600"
                      : "text-muted-foreground"
                }`}
              >
                {deltaNetLost > 0 ? "+" : ""}
                {deltaNetLost.toFixed(2)} PLN
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {comparison.deltas.netLostRevenuePercent}% zmiana utraconego
              przychodu
            </p>
            <p className="text-xs text-muted-foreground">
              {parseFloat(comparison.deltas.cancellationRate) > 0 ? "+" : ""}
              {comparison.deltas.cancellationRate} pp zmiana wskaznika anulacji
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
