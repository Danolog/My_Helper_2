"use client";

import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReportData } from "../_types";

interface TrendTabProps {
  reportData: ReportData;
}

/** Format a date string as dd.mm for trend bar labels */
function formatDateShort(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function TrendTab({ reportData }: TrendTabProps) {
  // Calculate max revenue for bar chart scaling
  const maxTrendRevenue = Math.max(
    ...reportData.trend.map((t) => parseFloat(t.revenue)),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Trend dzienny
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reportData.trend.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
          </div>
        ) : (
          <div>
            {/* Simple bar chart */}
            <div className="space-y-2 mb-6">
              {reportData.trend.map((point) => (
                <div
                  key={point.date}
                  className="flex items-center gap-3"
                >
                  <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                    {formatDateShort(point.date)}
                  </span>
                  <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                    <div
                      className="bg-green-500 h-6 rounded-full flex items-center transition-all"
                      style={{
                        width: `${Math.max(
                          (parseFloat(point.revenue) /
                            maxTrendRevenue) *
                            100,
                          2,
                        )}%`,
                      }}
                    >
                      {parseFloat(point.revenue) / maxTrendRevenue >
                        0.25 && (
                        <span className="text-xs text-white font-medium pl-2 whitespace-nowrap">
                          {parseFloat(point.revenue).toFixed(0)} PLN
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium w-24 text-right shrink-0">
                    {parseFloat(point.revenue).toFixed(2)} PLN
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {point.count} wiz.
                  </Badge>
                </div>
              ))}
            </div>

            {/* Summary table below chart */}
            <div className="overflow-x-auto border-t pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium">
                      Data
                    </th>
                    <th className="text-right py-2 px-2 font-medium">
                      Przychod
                    </th>
                    <th className="text-right py-2 px-2 font-medium">
                      Liczba wizyt
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
                      <td className="py-2 px-2 text-right font-medium text-green-700">
                        {parseFloat(point.revenue).toFixed(2)} PLN
                      </td>
                      <td className="py-2 px-2 text-right">
                        {point.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-bold">
                    <td className="py-2 px-2">RAZEM</td>
                    <td className="py-2 px-2 text-right text-green-700">
                      {parseFloat(
                        reportData.summary.totalRevenue,
                      ).toFixed(2)}{" "}
                      PLN
                    </td>
                    <td className="py-2 px-2 text-right">
                      {reportData.summary.totalAppointments}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
