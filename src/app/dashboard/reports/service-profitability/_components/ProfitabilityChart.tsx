"use client";

import {
  DollarSign,
  TrendingUp,
  Package,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Scissors,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMarginColor, getMarginBadge } from "./profitability-utils";
import type { ReportData } from "../_types";

interface ProfitabilityChartProps {
  reportData: ReportData;
}

export function ProfitabilityChart({ reportData }: ProfitabilityChartProps) {
  return (
    <>
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Przychod
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold flex items-center gap-1">
              <DollarSign className="h-4 w-4 text-green-600" />
              {parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Koszty materialow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold flex items-center gap-1">
              <Package className="h-4 w-4 text-orange-600" />
              {parseFloat(reportData.summary.totalMaterialCost).toFixed(2)}{" "}
              PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Koszty pracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold flex items-center gap-1">
              <Users className="h-4 w-4 text-blue-600" />
              {parseFloat(reportData.summary.totalLaborCost).toFixed(2)} PLN
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Zysk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-bold flex items-center gap-1 ${
                parseFloat(reportData.summary.totalProfit) >= 0
                  ? "text-green-700"
                  : "text-red-600"
              }`}
            >
              {parseFloat(reportData.summary.totalProfit) >= 0 ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              )}
              {parseFloat(reportData.summary.totalProfit).toFixed(2)} PLN
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
              className={`text-xl font-bold ${getMarginColor(
                parseFloat(reportData.summary.profitMargin)
              )}`}
            >
              {reportData.summary.profitMargin}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Wizyty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-purple-600" />
              {reportData.summary.totalAppointments}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary tab - profit margins overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            Rentownosc wg uslugi
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
            <div className="space-y-4">
              {/* Visual bar chart */}
              <div className="space-y-3 mb-6">
                {reportData.byService.map((svc) => {
                  const revenue = parseFloat(svc.totalRevenue);
                  const materialCost = parseFloat(svc.totalMaterialCost);
                  const laborCost = parseFloat(svc.totalLaborCost);
                  const profit = parseFloat(svc.totalProfit);
                  const margin = parseFloat(svc.profitMargin);

                  return (
                    <div
                      key={svc.serviceId}
                      className="border rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {svc.serviceName}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {svc.appointmentCount} wiz.
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {getMarginBadge(margin)}
                          <span
                            className={`font-bold ${getMarginColor(margin)}`}
                          >
                            {svc.profitMargin}%
                          </span>
                        </div>
                      </div>

                      {/* Stacked bar */}
                      <div className="w-full bg-muted rounded-full h-6 relative overflow-hidden flex">
                        {revenue > 0 && (
                          <>
                            {profit > 0 && (
                              <div
                                className="bg-green-500 h-6 transition-all"
                                style={{
                                  width: `${(profit / revenue) * 100}%`,
                                }}
                                title={`Zysk: ${profit.toFixed(2)} PLN`}
                              />
                            )}
                            {materialCost > 0 && (
                              <div
                                className="bg-orange-400 h-6 transition-all"
                                style={{
                                  width: `${(materialCost / revenue) * 100}%`,
                                }}
                                title={`Materialy: ${materialCost.toFixed(2)} PLN`}
                              />
                            )}
                            {laborCost > 0 && (
                              <div
                                className="bg-blue-400 h-6 transition-all"
                                style={{
                                  width: `${(laborCost / revenue) * 100}%`,
                                }}
                                title={`Praca: ${laborCost.toFixed(2)} PLN`}
                              />
                            )}
                          </>
                        )}
                      </div>

                      {/* Legend row */}
                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          Zysk: {profit.toFixed(2)} PLN
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-orange-400" />
                          Materialy: {materialCost.toFixed(2)} PLN
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-blue-400" />
                          Praca: {laborCost.toFixed(2)} PLN
                        </span>
                        <span className="ml-auto font-medium text-foreground">
                          Przychod: {revenue.toFixed(2)} PLN
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
