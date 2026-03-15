"use client";

import {
  Minus,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComparisonData } from "../_types";

/** Metrics where an increase is considered negative (bad). */
const INVERSE_METRICS = new Set(["totalCancellations", "cancellationRate"]);

function getChangeColor(
  direction: "up" | "down" | "neutral",
  metricKey: string
): string {
  if (direction === "neutral") return "text-gray-500";
  const isInverse = INVERSE_METRICS.has(metricKey);
  if (direction === "up") {
    return isInverse ? "text-red-600" : "text-green-600";
  }
  return isInverse ? "text-green-600" : "text-red-600";
}

function getChangeIcon(direction: "up" | "down" | "neutral") {
  if (direction === "up") return ArrowUpRight;
  if (direction === "down") return ArrowDownRight;
  return Minus;
}

interface YearlyComparisonTableProps {
  comparisonData: ComparisonData;
}

export function YearlyComparisonTable({ comparisonData }: YearlyComparisonTableProps) {
  return (
    <>
      {/* Monthly breakdown comparison table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            Porownanie miesiac po miesiacu
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Miesiac</th>
                  <th className="text-right py-2 px-3 font-medium">
                    Przychod {comparisonData.year1.label}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">
                    Przychod {comparisonData.year2.label}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">Zmiana %</th>
                  <th className="text-right py-2 px-3 font-medium">
                    Wizyty {comparisonData.year1.label}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">
                    Wizyty {comparisonData.year2.label}
                  </th>
                  <th className="text-right py-2 px-3 font-medium">Zmiana %</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.monthlyComparison.map((entry) => {
                  const revColor = getChangeColor(entry.revenueChange.direction, "revenue");
                  const apptColor = getChangeColor(entry.appointmentsChange.direction, "appointments");
                  const RevIcon = getChangeIcon(entry.revenueChange.direction);
                  const ApptIcon = getChangeIcon(entry.appointmentsChange.direction);

                  return (
                    <tr key={entry.month} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 px-3 font-medium">{entry.monthLabel}</td>
                      <td className="py-2 px-3 text-right">
                        {parseFloat(entry.year1Revenue).toFixed(2)} PLN
                      </td>
                      <td className="py-2 px-3 text-right">
                        {parseFloat(entry.year2Revenue).toFixed(2)} PLN
                      </td>
                      <td className={`py-2 px-3 text-right ${revColor}`}>
                        <span className="inline-flex items-center gap-0.5">
                          <RevIcon className="h-3 w-3" />
                          {entry.revenueChange.percent}%
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        {entry.year1Appointments}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {entry.year2Appointments}
                      </td>
                      <td className={`py-2 px-3 text-right ${apptColor}`}>
                        <span className="inline-flex items-center gap-0.5">
                          <ApptIcon className="h-3 w-3" />
                          {entry.appointmentsChange.percent}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Empty state */}
      {comparisonData.year1.metrics.totalAppointments === 0 &&
        comparisonData.year2.metrics.totalAppointments === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-lg font-medium">
                  Brak danych do porownania
                </p>
                <p className="text-sm mt-1">
                  Nie znaleziono wizyt w wybranych latach. Zmien zakres
                  lat lub sprawdz czy istnieja ukonczone wizyty.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
    </>
  );
}
