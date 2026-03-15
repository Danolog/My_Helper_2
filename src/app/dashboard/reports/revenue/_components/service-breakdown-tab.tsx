"use client";

import { Scissors } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface ServiceBreakdownTabProps {
  reportData: ReportData;
}

export function ServiceBreakdownTab({ reportData }: ServiceBreakdownTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Scissors className="h-5 w-5" />
          Przychod wg uslugi
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reportData.byService.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Scissors className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
            <p className="text-sm mt-1">
              Zmien zakres dat lub sprawdz czy istnieja ukonczone wizyty
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">
                    Usluga
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Liczba wizyt
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Przychod
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Srednia cena
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Udzial
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.byService.map((svc) => (
                  <tr
                    key={svc.serviceId}
                    className="border-b hover:bg-muted/50"
                  >
                    <td className="py-3 px-2 font-medium">
                      {svc.serviceName}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {svc.count}
                    </td>
                    <td className="py-3 px-2 text-right font-medium text-green-700">
                      {parseFloat(svc.revenue).toFixed(2)} PLN
                    </td>
                    <td className="py-3 px-2 text-right">
                      {parseFloat(svc.avgPrice).toFixed(2)} PLN
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-muted rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{
                              width: `${Math.min(parseFloat(svc.share), 100)}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 text-right">
                          {svc.share}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-3 px-2">RAZEM</td>
                  <td className="py-3 px-2 text-right">
                    {reportData.summary.totalAppointments}
                  </td>
                  <td className="py-3 px-2 text-right text-green-700">
                    {parseFloat(
                      reportData.summary.totalRevenue,
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right">
                    {parseFloat(
                      reportData.summary.avgRevenuePerAppointment,
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
