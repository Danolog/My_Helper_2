"use client";

import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportData } from "../_types";
import { getRateColor, getRateBadge, formatDateShort } from "../_types";

interface TrendTabProps {
  reportData: ReportData;
}

export function TrendTab({ reportData }: TrendTabProps) {
  if (reportData.trend.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Trend dzienny
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <TrendingDown className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const maxTrendTotal = Math.max(
    ...reportData.trend.map((t) => t.total),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingDown className="h-5 w-5" />
          Trend dzienny
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          {/* Bar chart */}
          <div className="space-y-2 mb-6">
            {reportData.trend.map((point) => {
              const lostCount = point.cancelled + point.noShow;
              return (
                <div key={point.date} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                    {formatDateShort(point.date)}
                  </span>
                  <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                    <div
                      className="bg-blue-300 h-6 rounded-full absolute top-0 left-0"
                      style={{
                        width: `${Math.max((point.total / maxTrendTotal) * 100, 2)}%`,
                      }}
                    />
                    <div
                      className="bg-red-500 h-6 rounded-full absolute top-0 left-0 flex items-center"
                      style={{
                        width: `${Math.max((lostCount / maxTrendTotal) * 100, lostCount > 0 ? 2 : 0)}%`,
                      }}
                    >
                      {lostCount > 0 &&
                        (lostCount / maxTrendTotal) * 100 > 10 && (
                          <span className="text-xs text-white font-medium pl-2">
                            {lostCount}
                          </span>
                        )}
                    </div>
                  </div>
                  <span className="text-sm w-16 text-right shrink-0">
                    {lostCount}/{point.total}
                  </span>
                  <Badge
                    variant={getRateBadge(point.rate)}
                    className="shrink-0 w-16 justify-center"
                  >
                    <span className={getRateColor(point.rate)}>
                      {point.rate}%
                    </span>
                  </Badge>
                </div>
              );
            })}
          </div>

          {/* Detailed table */}
          <div className="overflow-x-auto border-t pt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">Data</th>
                  <th className="text-right py-2 px-2 font-medium">Laczne</th>
                  <th className="text-right py-2 px-2 font-medium">
                    Anulowane
                  </th>
                  <th className="text-right py-2 px-2 font-medium">
                    Nieobecnosci
                  </th>
                  <th className="text-right py-2 px-2 font-medium">
                    Wskaznik
                  </th>
                  <th className="text-right py-2 px-2 font-medium">
                    Strata netto
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.trend.map((point) => (
                  <tr
                    key={point.date}
                    className="border-b hover:bg-muted/50"
                  >
                    <td className="py-2 px-2">
                      {new Date(
                        point.date + "T12:00:00",
                      ).toLocaleDateString("pl-PL", {
                        weekday: "short",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </td>
                    <td className="py-2 px-2 text-right">{point.total}</td>
                    <td className="py-2 px-2 text-right text-orange-600">
                      {point.cancelled}
                    </td>
                    <td className="py-2 px-2 text-right text-red-600">
                      {point.noShow}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className={getRateColor(point.rate)}>
                        {point.rate}%
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-medium text-red-700">
                      {parseFloat(point.netLostRevenue).toFixed(2)} PLN
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-2 px-2">RAZEM</td>
                  <td className="py-2 px-2 text-right">
                    {reportData.summary.totalAppointments}
                  </td>
                  <td className="py-2 px-2 text-right text-orange-600">
                    {reportData.summary.cancelledCount}
                  </td>
                  <td className="py-2 px-2 text-right text-red-600">
                    {reportData.summary.noShowCount}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span
                      className={getRateColor(
                        reportData.summary.cancellationRate,
                      )}
                    >
                      {reportData.summary.cancellationRate}%
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right text-red-700">
                    {parseFloat(reportData.summary.netLostRevenue).toFixed(2)}{" "}
                    PLN
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
