"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Calendar,
  TrendingUp,
  DollarSign,
  Scissors,
  Search,
  RefreshCw,
  Package,
  Users,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface ServiceProfit {
  serviceId: string;
  serviceName: string;
  baseDuration: number;
  appointmentCount: number;
  totalRevenue: string;
  totalMaterialCost: string;
  totalLaborCost: string;
  totalProfit: string;
  profitMargin: string;
  avgRevenue: string;
  avgMaterialCost: string;
  avgLaborCost: string;
  avgProfit: string;
  revenueShare: string;
}

interface ReportData {
  summary: {
    totalRevenue: string;
    totalMaterialCost: string;
    totalLaborCost: string;
    totalProfit: string;
    profitMargin: string;
    totalAppointments: number;
  };
  byService: ServiceProfit[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export default function ServiceProfitabilityPage() {
  const { data: _session } = useSession();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "details">("summary");

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);

      const res = await fetch(
        `/api/reports/service-profitability?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch report");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Failed to fetch report");
      }
      setReportData(json.data);
    } catch (err) {
      console.error("[Service Profitability Report] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        format: "csv",
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);

      const res = await fetch(
        `/api/reports/service-profitability?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-rentownosci-uslug-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Service Profitability Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const getMarginColor = (margin: number) => {
    if (margin >= 70) return "text-green-700";
    if (margin >= 50) return "text-green-600";
    if (margin >= 30) return "text-yellow-600";
    if (margin >= 0) return "text-orange-600";
    return "text-red-600";
  };

  const getMarginBadge = (margin: number) => {
    if (margin >= 70)
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          Wysoka
        </Badge>
      );
    if (margin >= 50)
      return (
        <Badge className="bg-green-50 text-green-700 hover:bg-green-50">
          Dobra
        </Badge>
      );
    if (margin >= 30)
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          Srednia
        </Badge>
      );
    if (margin >= 0)
      return (
        <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
          Niska
        </Badge>
      );
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
        Strata
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PieChart className="h-6 w-6 text-emerald-600" />
            Rentownosc uslug
          </h1>
          <p className="text-muted-foreground text-sm">
            Marze zysku na uslugach - przychod minus koszty
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={!reportData || reportData.summary.totalAppointments === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Eksport CSV
        </Button>
      </div>

      {/* Date range filter */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Data od
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Data do
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <Button onClick={fetchReport} disabled={loading}>
              <Search className="h-4 w-4 mr-2" />
              {loading ? "Ladowanie..." : "Generuj raport"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            Generowanie raportu...
          </span>
        </div>
      )}

      {/* Report content */}
      {reportData && !loading && (
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

          {/* Tab switch */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={activeTab === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("summary")}
            >
              <Scissors className="h-4 w-4 mr-1" />
              Podsumowanie
            </Button>
            <Button
              variant={activeTab === "details" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("details")}
            >
              <PieChart className="h-4 w-4 mr-1" />
              Szczegoly kosztow
            </Button>
          </div>

          {/* Summary tab - profit margins overview */}
          {activeTab === "summary" && (
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
          )}

          {/* Details tab - detailed table */}
          {activeTab === "details" && (
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
          )}
        </>
      )}
    </div>
  );
}
