"use client";

import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMarginColor, getMarginBadge } from "./profitability-utils";
import type { ReportData } from "../_types";

interface ProfitabilityTableProps {
  reportData: ReportData;
}

export function ProfitabilityTable({ reportData }: ProfitabilityTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <PieChart className="h-5 w-5" />
          Szczegoly kosztow i zyskow
        </CardTitle>
      </CardHeader>
      <CardContent>
        {reportData.byService.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <PieChart className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych w wybranym okresie</p>
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
                    Wizyty
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Przychod
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Koszty mat.
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Koszty pracy
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Zysk
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Marza
                  </th>
                </tr>
              </thead>
              <tbody>
                {reportData.byService.map((svc) => {
                  const margin = parseFloat(svc.profitMargin);
                  const profit = parseFloat(svc.totalProfit);
                  return (
                    <tr
                      key={svc.serviceId}
                      className="border-b hover:bg-muted/50"
                    >
                      <td className="py-3 px-2">
                        <div className="font-medium">
                          {svc.serviceName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          sr. przychod: {parseFloat(svc.avgRevenue).toFixed(2)} PLN |
                          sr. zysk: {parseFloat(svc.avgProfit).toFixed(2)} PLN
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right">
                        {svc.appointmentCount}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-green-700">
                        {parseFloat(svc.totalRevenue).toFixed(2)} PLN
                      </td>
                      <td className="py-3 px-2 text-right text-orange-600">
                        {parseFloat(svc.totalMaterialCost).toFixed(2)}{" "}
                        PLN
                      </td>
                      <td className="py-3 px-2 text-right text-blue-600">
                        {parseFloat(svc.totalLaborCost).toFixed(2)} PLN
                      </td>
                      <td
                        className={`py-3 px-2 text-right font-medium ${
                          profit >= 0 ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        {parseFloat(svc.totalProfit).toFixed(2)} PLN
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {getMarginBadge(margin)}
                          <span
                            className={`font-bold ${getMarginColor(margin)}`}
                          >
                            {svc.profitMargin}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-3 px-2">RAZEM</td>
                  <td className="py-3 px-2 text-right">
                    {reportData.summary.totalAppointments}
                  </td>
                  <td className="py-3 px-2 text-right text-green-700">
                    {parseFloat(
                      reportData.summary.totalRevenue
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right text-orange-600">
                    {parseFloat(
                      reportData.summary.totalMaterialCost
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td className="py-3 px-2 text-right text-blue-600">
                    {parseFloat(
                      reportData.summary.totalLaborCost
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td
                    className={`py-3 px-2 text-right ${
                      parseFloat(reportData.summary.totalProfit) >= 0
                        ? "text-green-700"
                        : "text-red-600"
                    }`}
                  >
                    {parseFloat(
                      reportData.summary.totalProfit
                    ).toFixed(2)}{" "}
                    PLN
                  </td>
                  <td
                    className={`py-3 px-2 text-right ${getMarginColor(
                      parseFloat(reportData.summary.profitMargin)
                    )}`}
                  >
                    {reportData.summary.profitMargin}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
