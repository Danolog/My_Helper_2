"use client";

import {
  DollarSign,
  Package,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportTotals } from "../_types";
import { getMarginColor } from "../_types";

interface SummaryCardsProps {
  totals: ReportTotals;
}

export function SummaryCards({ totals }: SummaryCardsProps) {
  const totalProfitLoss = parseFloat(totals.totalProfitLoss);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Koszt materialow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1 text-orange-600">
            <Package className="h-5 w-5" />
            {parseFloat(totals.totalMaterialCost).toFixed(2)} PLN
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Przychod z uslug
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold flex items-center gap-1 text-blue-600">
            <DollarSign className="h-5 w-5" />
            {parseFloat(totals.totalRevenue).toFixed(2)} PLN
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Zysk / Strata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold flex items-center gap-1 ${
              totalProfitLoss >= 0 ? "text-green-700" : "text-red-600"
            }`}
          >
            {totalProfitLoss >= 0 ? (
              <ArrowUpRight className="h-5 w-5" />
            ) : (
              <ArrowDownRight className="h-5 w-5" />
            )}
            {totalProfitLoss.toFixed(2)} PLN
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Marza zysku
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${getMarginColor(
              parseFloat(totals.profitMargin),
            )}`}
          >
            {totals.profitMargin}%
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
