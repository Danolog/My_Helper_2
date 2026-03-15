"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ReportTotals } from "../_types";

interface SecondaryStatsProps {
  totals: ReportTotals;
}

export function SecondaryStats({ totals }: SecondaryStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="text-sm text-muted-foreground">
            Unikalne produkty
          </div>
          <div className="text-lg font-bold">{totals.uniqueProducts}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="text-sm text-muted-foreground">Liczba uzyc</div>
          <div className="text-lg font-bold">{totals.totalUsages}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-green-600" />
            Zyskowne
          </div>
          <div className="text-lg font-bold text-green-700">
            {totals.profitableProducts}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-red-600" />
            Stratne
          </div>
          <div className="text-lg font-bold text-red-600">
            {totals.lossProducts}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
