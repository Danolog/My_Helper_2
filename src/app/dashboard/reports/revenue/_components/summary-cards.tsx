"use client";

import {
  DollarSign,
  TrendingUp,
  BarChart3,
  Percent,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  REVENUE_METHOD_LABELS,
  REVENUE_NO_RECORD_NOTE,
  REVENUE_SOURCE_NOTE,
} from "@/lib/reports/revenue-amount";
import type { ReportData } from "../_types";

interface SummaryCardsProps {
  reportData: ReportData;
}

export function SummaryCards({ reportData }: SummaryCardsProps) {
  const { summary, byPaymentMethod } = reportData;
  // The API always returns all four groups; the "none" group (appointments
  // completed before amounts were recorded) is shown only when it has any.
  const noRecordCount =
    byPaymentMethod.find((row) => row.method === "none")?.count ?? 0;
  const visibleMethods = byPaymentMethod.filter(
    (row) => row.method !== "none" || row.count > 0,
  );

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Całkowity przychód
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <DollarSign className="h-5 w-5 text-green-600" />
              {parseFloat(summary.totalRevenue).toFixed(2)} PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Liczba wizyt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              {summary.totalAppointments}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Średni przychód / wizytę
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <BarChart3 className="h-5 w-5 text-purple-600" />
              {parseFloat(summary.avgRevenuePerAppointment).toFixed(2)}{" "}
              PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Zniżki
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              <Percent className="h-5 w-5 text-orange-600" />
              {parseFloat(summary.totalDiscount).toFixed(2)} PLN
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Przychód według metody płatności
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">
                    Metoda płatności
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Liczba wizyt
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Przychód
                  </th>
                  <th className="text-right py-3 px-2 font-medium">Udział</th>
                </tr>
              </thead>
              <tbody>
                {visibleMethods.map((row) => (
                  <tr key={row.method} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-2 font-medium">
                      {REVENUE_METHOD_LABELS[row.method]}
                    </td>
                    <td className="py-3 px-2 text-right">{row.count}</td>
                    <td className="py-3 px-2 text-right font-medium text-green-700">
                      {parseFloat(row.revenue).toFixed(2)} PLN
                    </td>
                    <td className="py-3 px-2 text-right">{row.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            {REVENUE_SOURCE_NOTE}
          </p>
          {noRecordCount > 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              {REVENUE_NO_RECORD_NOTE}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
