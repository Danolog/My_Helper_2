"use client";

import {
  DollarSign,
  TrendingUp,
  BarChart3,
  Percent,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportData } from "../_types";

interface SummaryCardsProps {
  reportData: ReportData;
}

export function SummaryCards({ reportData }: SummaryCardsProps) {
  const { summary } = reportData;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Calkowity przychod
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
            Sredni przychod / wizyte
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
            Znizki
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
  );
}
