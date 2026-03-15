"use client";

import {
  DollarSign,
  XCircle,
  Replace,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface LostRevenueTabProps {
  reportData: ReportData;
}

export function LostRevenueTab({ reportData }: LostRevenueTabProps) {
  const { summary, byService } = reportData;

  if (summary.cancellationCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-red-600" />
            Analiza utraconego przychodu
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak anulowanych wizyt w wybranym okresie</p>
            <p className="text-sm mt-1">
              Nie utracono przychodu - swietny wynik!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const grossLost = parseFloat(summary.grossLostRevenue);
  const netLost = parseFloat(summary.netLostRevenue);
  const replaced = parseFloat(summary.replacedRevenue);

  const netPercent = grossLost > 0 ? (netLost / grossLost) * 100 : 0;
  const replacedPercent = grossLost > 0 ? (replaced / grossLost) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-red-600" />
          Analiza utraconego przychodu
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Revenue breakdown visual */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg border bg-red-50 border-red-200">
              <div className="flex items-center gap-2 text-sm text-red-700 font-medium mb-1">
                <XCircle className="h-4 w-4" />
                Calkowita wartosc anulacji
              </div>
              <div className="text-2xl font-bold text-red-700">
                {grossLost.toFixed(2)} PLN
              </div>
              <p className="text-xs text-red-600 mt-1">
                Na podstawie cen uslug ({summary.cancellationCount} wizyt)
              </p>
            </div>
            <div className="p-4 rounded-lg border bg-green-50 border-green-200">
              <div className="flex items-center gap-2 text-sm text-green-700 font-medium mb-1">
                <Replace className="h-4 w-4" />
                Odzyskane przez zastepstwa
              </div>
              <div className="text-2xl font-bold text-green-700">
                -{replaced.toFixed(2)} PLN
              </div>
              <p className="text-xs text-green-600 mt-1">
                {summary.replacedCount} wizyt zastapionych nowymi rezerwacjami
              </p>
            </div>
            <div className="p-4 rounded-lg border-2 bg-orange-50 border-orange-300">
              <div className="flex items-center gap-2 text-sm text-orange-700 font-medium mb-1">
                <AlertTriangle className="h-4 w-4" />
                Rzeczywista strata
              </div>
              <div className="text-2xl font-bold text-orange-700">
                {netLost.toFixed(2)} PLN
              </div>
              <p className="text-xs text-orange-600 mt-1">
                Wartosc niewypelnionych terminow
              </p>
            </div>
          </div>

          {/* Revenue bar */}
          <div>
            <p className="text-sm font-medium mb-2">
              Podzial utraconego przychodu
            </p>
            <div className="w-full bg-muted rounded-lg h-10 relative overflow-hidden">
              {grossLost > 0 && (
                <>
                  {/* Net lost (orange) */}
                  <div
                    className="bg-orange-500 h-10 absolute top-0 left-0 flex items-center justify-center"
                    style={{ width: `${netPercent}%` }}
                  >
                    {netPercent > 15 && (
                      <span className="text-xs text-white font-medium">
                        {netLost.toFixed(0)} PLN
                      </span>
                    )}
                  </div>
                  {/* Replaced (green) */}
                  <div
                    className="bg-green-500 h-10 absolute top-0 flex items-center justify-center"
                    style={{
                      left: `${netPercent}%`,
                      width: `${replacedPercent}%`,
                    }}
                  >
                    {replacedPercent > 15 && (
                      <span className="text-xs text-white font-medium">
                        {replaced.toFixed(0)} PLN
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-6 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-orange-500" />
                Rzeczywista strata ({netPercent.toFixed(0)}%)
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-green-500" />
                Odzyskane ({replacedPercent.toFixed(0)}%)
              </div>
            </div>
          </div>

          {/* Per-service lost revenue */}
          {byService.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">
                Utracony przychod wg uslugi
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium">
                        Usluga
                      </th>
                      <th className="text-right py-2 px-2 font-medium">
                        Anulowane
                      </th>
                      <th className="text-right py-2 px-2 font-medium">
                        Calkowita wartosc
                      </th>
                      <th className="text-right py-2 px-2 font-medium">
                        Odzyskane
                      </th>
                      <th className="text-right py-2 px-2 font-medium">
                        Strata netto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {byService
                      .filter(
                        (svc) => parseFloat(svc.grossLostRevenue) > 0,
                      )
                      .sort(
                        (a, b) =>
                          parseFloat(b.netLostRevenue) -
                          parseFloat(a.netLostRevenue),
                      )
                      .map((svc) => (
                        <tr
                          key={svc.serviceId}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="py-2 px-2 font-medium">
                            {svc.serviceName}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {svc.cancelled + svc.noShow}
                          </td>
                          <td className="py-2 px-2 text-right text-red-600">
                            {parseFloat(svc.grossLostRevenue).toFixed(2)} PLN
                          </td>
                          <td className="py-2 px-2 text-right text-green-600">
                            {parseFloat(svc.replacedRevenue) > 0
                              ? `-${parseFloat(svc.replacedRevenue).toFixed(2)} PLN`
                              : "-"}
                          </td>
                          <td className="py-2 px-2 text-right font-bold text-orange-700">
                            {parseFloat(svc.netLostRevenue).toFixed(2)} PLN
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-bold">
                      <td className="py-2 px-2">RAZEM</td>
                      <td className="py-2 px-2 text-right">
                        {summary.cancellationCount}
                      </td>
                      <td className="py-2 px-2 text-right text-red-600">
                        {grossLost.toFixed(2)} PLN
                      </td>
                      <td className="py-2 px-2 text-right text-green-600">
                        {replaced > 0
                          ? `-${replaced.toFixed(2)} PLN`
                          : "-"}
                      </td>
                      <td className="py-2 px-2 text-right text-orange-700">
                        {netLost.toFixed(2)} PLN
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
