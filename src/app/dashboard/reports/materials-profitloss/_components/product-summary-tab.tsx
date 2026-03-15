"use client";

import { Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProductProfitSummary, ReportTotals } from "../_types";
import { getMarginColor } from "../_types";
import { MarginBadge } from "./margin-badge";

interface ProductSummaryTabProps {
  summary: ProductProfitSummary[];
  totals: ReportTotals;
}

export function ProductSummaryTab({
  summary,
  totals,
}: ProductSummaryTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Rentownosc wg produktu</CardTitle>
      </CardHeader>
      <CardContent>
        {summary.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Brak danych o zuzyciu w wybranym okresie</p>
            <p className="text-sm mt-1">
              Zmien zakres dat lub sprawdz czy produkty sa uzywane podczas wizyt
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Visual bars for each product */}
            <div className="space-y-3 mb-6">
              {summary.map((item) => {
                const materialCost = parseFloat(item.totalMaterialCost);
                const revenue = parseFloat(item.attributedRevenue);
                const profitLoss = parseFloat(item.profitLoss);
                const margin = parseFloat(item.profitMargin);
                const maxVal = Math.max(materialCost, revenue, 1);

                return (
                  <div key={item.productId} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.productName}</span>
                        {item.category && (
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {item.usageCount} uzyc
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <MarginBadge margin={margin} />
                        <span
                          className={`font-bold ${
                            profitLoss >= 0 ? "text-green-700" : "text-red-600"
                          }`}
                        >
                          {profitLoss >= 0 ? "+" : ""}
                          {profitLoss.toFixed(2)} PLN
                        </span>
                      </div>
                    </div>

                    {/* Cost vs Revenue bars */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20 text-muted-foreground">
                          Koszt:
                        </span>
                        <div className="flex-1 bg-muted rounded-full h-4 relative overflow-hidden">
                          <div
                            className="bg-orange-400 h-4 rounded-full transition-all"
                            style={{
                              width: `${(materialCost / maxVal) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium w-24 text-right">
                          {materialCost.toFixed(2)} PLN
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20 text-muted-foreground">
                          Przychod:
                        </span>
                        <div className="flex-1 bg-muted rounded-full h-4 relative overflow-hidden">
                          <div
                            className="bg-blue-500 h-4 rounded-full transition-all"
                            style={{
                              width: `${(revenue / maxVal) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-medium w-24 text-right">
                          {revenue.toFixed(2)} PLN
                        </span>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                      <span>
                        Zuzycie: {item.totalQuantityUsed.toFixed(2)}{" "}
                        {item.unit || "szt."}
                      </span>
                      <span>
                        Sr. koszt/uzycie:{" "}
                        {parseFloat(item.avgCostPerUse).toFixed(2)} PLN
                      </span>
                      <span>
                        Sr. przychod/uzycie:{" "}
                        {parseFloat(item.avgRevenuePerUse).toFixed(2)} PLN
                      </span>
                      <span
                        className={`ml-auto font-medium ${getMarginColor(margin)}`}
                      >
                        Marza: {item.profitMargin}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary table */}
            <ProductSummaryTable summary={summary} totals={totals} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Table view of product profit/loss data with totals footer */
function ProductSummaryTable({
  summary,
  totals,
}: {
  summary: ProductProfitSummary[];
  totals: ReportTotals;
}) {
  const totalProfitLoss = parseFloat(totals.totalProfitLoss);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-2 font-medium">Produkt</th>
            <th className="text-right py-3 px-2 font-medium">Zuzycie</th>
            <th className="text-right py-3 px-2 font-medium">Koszt mat.</th>
            <th className="text-right py-3 px-2 font-medium">Przychod</th>
            <th className="text-right py-3 px-2 font-medium">Zysk/Strata</th>
            <th className="text-right py-3 px-2 font-medium">Marza</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((item) => {
            const profitLoss = parseFloat(item.profitLoss);
            const margin = parseFloat(item.profitMargin);
            return (
              <tr
                key={item.productId}
                className="border-b hover:bg-muted/50"
              >
                <td className="py-3 px-2">
                  <div className="font-medium">{item.productName}</div>
                  {item.category && (
                    <div className="text-xs text-muted-foreground">
                      {item.category}
                    </div>
                  )}
                </td>
                <td className="py-3 px-2 text-right">
                  {item.totalQuantityUsed.toFixed(2)} {item.unit || "szt."}
                </td>
                <td className="py-3 px-2 text-right text-orange-600">
                  {parseFloat(item.totalMaterialCost).toFixed(2)} PLN
                </td>
                <td className="py-3 px-2 text-right text-blue-600">
                  {parseFloat(item.attributedRevenue).toFixed(2)} PLN
                </td>
                <td
                  className={`py-3 px-2 text-right font-medium ${
                    profitLoss >= 0 ? "text-green-700" : "text-red-600"
                  }`}
                >
                  {profitLoss >= 0 ? "+" : ""}
                  {profitLoss.toFixed(2)} PLN
                </td>
                <td className="py-3 px-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <MarginBadge margin={margin} />
                    <span
                      className={`font-bold ${getMarginColor(margin)}`}
                    >
                      {item.profitMargin}%
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
            <td className="py-3 px-2"></td>
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
            <td
              className={`py-3 px-2 text-right ${getMarginColor(
                parseFloat(totals.profitMargin),
              )}`}
            >
              {totals.profitMargin}%
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
