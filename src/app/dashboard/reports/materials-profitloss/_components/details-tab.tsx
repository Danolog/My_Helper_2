"use client";

import { Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DetailRecord, ReportTotals } from "../_types";
import { formatDate } from "../_types";

interface DetailsTabProps {
  details: DetailRecord[];
  totals: ReportTotals;
}

export function DetailsTab({ details, totals }: DetailsTabProps) {
  const totalProfitLoss = parseFloat(totals.totalProfitLoss);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          Szczegolowe zuzycie z zyskiem/strata
        </CardTitle>
      </CardHeader>
      <CardContent>
        {details.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak szczegolowych danych w wybranym okresie</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">Data</th>
                  <th className="text-left py-3 px-2 font-medium">Produkt</th>
                  <th className="text-left py-3 px-2 font-medium">Usluga</th>
                  <th className="text-left py-3 px-2 font-medium">
                    Pracownik
                  </th>
                  <th className="text-right py-3 px-2 font-medium">Zuzycie</th>
                  <th className="text-right py-3 px-2 font-medium">Koszt</th>
                  <th className="text-right py-3 px-2 font-medium">
                    Przychod
                  </th>
                  <th className="text-right py-3 px-2 font-medium">
                    Zysk/Strata
                  </th>
                </tr>
              </thead>
              <tbody>
                {details.map((record) => {
                  const profitLoss = parseFloat(record.profitLoss);
                  return (
                    <tr
                      key={record.id}
                      className="border-b hover:bg-muted/50"
                    >
                      <td className="py-3 px-2">
                        {formatDate(record.date)}
                      </td>
                      <td className="py-3 px-2 font-medium">
                        {record.product.name}
                      </td>
                      <td className="py-3 px-2">{record.service || "-"}</td>
                      <td className="py-3 px-2">{record.employee || "-"}</td>
                      <td className="py-3 px-2 text-right">
                        {parseFloat(record.quantityUsed).toFixed(2)}{" "}
                        {record.product.unit || "szt."}
                      </td>
                      <td className="py-3 px-2 text-right text-orange-600">
                        {parseFloat(record.materialCost).toFixed(2)} PLN
                      </td>
                      <td className="py-3 px-2 text-right text-blue-600">
                        {parseFloat(record.attributedRevenue).toFixed(2)} PLN
                      </td>
                      <td
                        className={`py-3 px-2 text-right font-medium ${
                          profitLoss >= 0 ? "text-green-700" : "text-red-600"
                        }`}
                      >
                        {profitLoss >= 0 ? "+" : ""}
                        {profitLoss.toFixed(2)} PLN
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-3 px-2" colSpan={5}>
                    RAZEM
                  </td>
                  <td className="py-3 px-2 text-right text-orange-600">
                    {parseFloat(totals.totalMaterialCost).toFixed(2)} PLN
                  </td>
                  <td className="py-3 px-2 text-right text-blue-600">
                    {parseFloat(totals.totalRevenue).toFixed(2)} PLN
                  </td>
                  <td
                    className={`py-3 px-2 text-right ${
                      totalProfitLoss >= 0 ? "text-green-700" : "text-red-600"
                    }`}
                  >
                    {totalProfitLoss >= 0 ? "+" : ""}
                    {totalProfitLoss.toFixed(2)} PLN
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
