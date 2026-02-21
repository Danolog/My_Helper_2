"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { generateReportPDF } from "@/lib/pdf-export";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface ProductProfitSummary {
  productId: string;
  productName: string;
  category: string | null;
  unit: string | null;
  pricePerUnit: string | null;
  currentStock: string | null;
  totalQuantityUsed: number;
  totalMaterialCost: string;
  attributedRevenue: string;
  profitLoss: string;
  profitMargin: string;
  usageCount: number;
  avgCostPerUse: string;
  avgRevenuePerUse: string;
}

interface DetailRecord {
  id: string;
  product: {
    id: string;
    name: string;
    category: string | null;
    unit: string | null;
    pricePerUnit: string | null;
  };
  quantityUsed: string;
  materialCost: string;
  attributedRevenue: string;
  profitLoss: string;
  date: string;
  appointment: {
    id: string;
    date: string;
    status: string;
  };
  employee: string | null;
  service: string | null;
}

interface ReportData {
  summary: ProductProfitSummary[];
  details: DetailRecord[];
  totals: {
    totalMaterialCost: string;
    totalRevenue: string;
    totalProfitLoss: string;
    profitMargin: string;
    totalUsages: number;
    uniqueProducts: number;
    profitableProducts: number;
    lossProducts: number;
  };
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export default function MaterialsProfitLossPage() {
  const { data: _session } = useSession();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);
  const [activeTab, setActiveTab] = useState<"summary" | "details">(
    "summary"
  );

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
        `/api/reports/materials-profitloss?${params.toString()}`
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
      console.error("[Materials Profit/Loss Report] Error:", err);
      setError("Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.");
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
        `/api/reports/materials-profitloss?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-zysk-strata-materialow-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Materials Profit/Loss Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Zysk/Strata materialow",
        subtitle: "Koszt materialow vs przychod z uslug - analiza rentownosci produktow",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Koszt materialow", value: `${parseFloat(reportData.totals.totalMaterialCost).toFixed(2)} PLN` },
          { label: "Przychod z uslug", value: `${parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN` },
          { label: "Zysk / Strata", value: `${parseFloat(reportData.totals.totalProfitLoss).toFixed(2)} PLN` },
          { label: "Marza zysku", value: `${reportData.totals.profitMargin}%` },
        ],
        tables: [
          ...(reportData.summary.length > 0
            ? [
                {
                  title: "Rentownosc wg produktu",
                  headers: ["Produkt", "Zuzycie", "Koszt mat.", "Przychod", "Zysk/Strata", "Marza"],
                  rows: reportData.summary.map((item) => [
                    item.productName,
                    `${item.totalQuantityUsed.toFixed(2)} ${item.unit || "szt."}`,
                    `${parseFloat(item.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(item.attributedRevenue).toFixed(2)} PLN`,
                    `${parseFloat(item.profitLoss) >= 0 ? "+" : ""}${parseFloat(item.profitLoss).toFixed(2)} PLN`,
                    `${item.profitMargin}%`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    "",
                    `${parseFloat(reportData.totals.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalProfitLoss) >= 0 ? "+" : ""}${parseFloat(reportData.totals.totalProfitLoss).toFixed(2)} PLN`,
                    `${reportData.totals.profitMargin}%`,
                  ],
                },
              ]
            : []),
          ...(reportData.details.length > 0
            ? [
                {
                  title: "Szczegolowe zuzycie z zyskiem/strata",
                  headers: ["Data", "Produkt", "Usluga", "Pracownik", "Zuzycie", "Koszt", "Przychod", "Zysk/Strata"],
                  rows: reportData.details.map((record) => [
                    new Date(record.date).toLocaleDateString("pl-PL", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }),
                    record.product.name,
                    record.service || "-",
                    record.employee || "-",
                    `${parseFloat(record.quantityUsed).toFixed(2)} ${record.product.unit || "szt."}`,
                    `${parseFloat(record.materialCost).toFixed(2)} PLN`,
                    `${parseFloat(record.attributedRevenue).toFixed(2)} PLN`,
                    `${parseFloat(record.profitLoss) >= 0 ? "+" : ""}${parseFloat(record.profitLoss).toFixed(2)} PLN`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    "",
                    "",
                    "",
                    "",
                    `${parseFloat(reportData.totals.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalProfitLoss) >= 0 ? "+" : ""}${parseFloat(reportData.totals.totalProfitLoss).toFixed(2)} PLN`,
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-zysk-strata-materialow-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch (err) {
      console.error("[Materials Profit/Loss Report] PDF export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
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
          Wysoki zysk
        </Badge>
      );
    if (margin >= 50)
      return (
        <Badge className="bg-green-50 text-green-700 hover:bg-green-50">
          Dobry zysk
        </Badge>
      );
    if (margin >= 30)
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          Sredni zysk
        </Badge>
      );
    if (margin >= 0)
      return (
        <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
          Niski zysk
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
            <BarChart3 className="h-6 w-6 text-emerald-600" />
            Zysk/Strata materialow
          </h1>
          <p className="text-muted-foreground text-sm">
            Koszt materialow vs przychod z uslug - analiza rentownosci
            produktow
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={!reportData || reportData.summary.length === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            Eksport PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!reportData || reportData.summary.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Eksport CSV
          </Button>
        </div>
      </div>

      {/* Date range filter */}
      <DateRangeFilter
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onApply={fetchReport}
        loading={loading}
      />

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
                  {parseFloat(reportData.totals.totalMaterialCost).toFixed(2)}{" "}
                  PLN
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
                  {parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN
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
                    parseFloat(reportData.totals.totalProfitLoss) >= 0
                      ? "text-green-700"
                      : "text-red-600"
                  }`}
                >
                  {parseFloat(reportData.totals.totalProfitLoss) >= 0 ? (
                    <ArrowUpRight className="h-5 w-5" />
                  ) : (
                    <ArrowDownRight className="h-5 w-5" />
                  )}
                  {parseFloat(reportData.totals.totalProfitLoss).toFixed(2)}{" "}
                  PLN
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
                    parseFloat(reportData.totals.profitMargin)
                  )}`}
                >
                  {reportData.totals.profitMargin}%
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="text-sm text-muted-foreground">
                  Unikalne produkty
                </div>
                <div className="text-lg font-bold">
                  {reportData.totals.uniqueProducts}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="text-sm text-muted-foreground">
                  Liczba uzyc
                </div>
                <div className="text-lg font-bold">
                  {reportData.totals.totalUsages}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-green-600" />
                  Zyskowne
                </div>
                <div className="text-lg font-bold text-green-700">
                  {reportData.totals.profitableProducts}
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
                  {reportData.totals.lossProducts}
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
              Zysk/Strata wg produktu
            </Button>
            <Button
              variant={activeTab === "details" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("details")}
            >
              Szczegolowe zuzycie
            </Button>
          </div>

          {/* Summary tab - profit/loss by product */}
          {activeTab === "summary" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Rentownosc wg produktu
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.summary.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak danych o zuzyciu w wybranym okresie</p>
                    <p className="text-sm mt-1">
                      Zmien zakres dat lub sprawdz czy produkty sa uzywane
                      podczas wizyt
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Visual bars for each product */}
                    <div className="space-y-3 mb-6">
                      {reportData.summary.map((item) => {
                        const materialCost = parseFloat(
                          item.totalMaterialCost
                        );
                        const revenue = parseFloat(item.attributedRevenue);
                        const profitLoss = parseFloat(item.profitLoss);
                        const margin = parseFloat(item.profitMargin);
                        const maxVal = Math.max(materialCost, revenue, 1);

                        return (
                          <div
                            key={item.productId}
                            className="border rounded-lg p-3"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {item.productName}
                                </span>
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
                                {getMarginBadge(margin)}
                                <span
                                  className={`font-bold ${
                                    profitLoss >= 0
                                      ? "text-green-700"
                                      : "text-red-600"
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
                                {parseFloat(item.avgRevenuePerUse).toFixed(2)}{" "}
                                PLN
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
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-2 font-medium">
                              Produkt
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Zuzycie
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Koszt mat.
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Przychod
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Zysk/Strata
                            </th>
                            <th className="text-right py-3 px-2 font-medium">
                              Marza
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.summary.map((item) => {
                            const profitLoss = parseFloat(item.profitLoss);
                            const margin = parseFloat(item.profitMargin);
                            return (
                              <tr
                                key={item.productId}
                                className="border-b hover:bg-muted/50"
                              >
                                <td className="py-3 px-2">
                                  <div className="font-medium">
                                    {item.productName}
                                  </div>
                                  {item.category && (
                                    <div className="text-xs text-muted-foreground">
                                      {item.category}
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-2 text-right">
                                  {item.totalQuantityUsed.toFixed(2)}{" "}
                                  {item.unit || "szt."}
                                </td>
                                <td className="py-3 px-2 text-right text-orange-600">
                                  {parseFloat(item.totalMaterialCost).toFixed(
                                    2
                                  )}{" "}
                                  PLN
                                </td>
                                <td className="py-3 px-2 text-right text-blue-600">
                                  {parseFloat(item.attributedRevenue).toFixed(
                                    2
                                  )}{" "}
                                  PLN
                                </td>
                                <td
                                  className={`py-3 px-2 text-right font-medium ${
                                    profitLoss >= 0
                                      ? "text-green-700"
                                      : "text-red-600"
                                  }`}
                                >
                                  {profitLoss >= 0 ? "+" : ""}
                                  {profitLoss.toFixed(2)} PLN
                                </td>
                                <td className="py-3 px-2 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    {getMarginBadge(margin)}
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
                              {parseFloat(
                                reportData.totals.totalMaterialCost
                              ).toFixed(2)}{" "}
                              PLN
                            </td>
                            <td className="py-3 px-2 text-right text-blue-600">
                              {parseFloat(
                                reportData.totals.totalRevenue
                              ).toFixed(2)}{" "}
                              PLN
                            </td>
                            <td
                              className={`py-3 px-2 text-right ${
                                parseFloat(
                                  reportData.totals.totalProfitLoss
                                ) >= 0
                                  ? "text-green-700"
                                  : "text-red-600"
                              }`}
                            >
                              {parseFloat(
                                reportData.totals.totalProfitLoss
                              ) >= 0
                                ? "+"
                                : ""}
                              {parseFloat(
                                reportData.totals.totalProfitLoss
                              ).toFixed(2)}{" "}
                              PLN
                            </td>
                            <td
                              className={`py-3 px-2 text-right ${getMarginColor(
                                parseFloat(reportData.totals.profitMargin)
                              )}`}
                            >
                              {reportData.totals.profitMargin}%
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Details tab */}
          {activeTab === "details" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Szczegolowe zuzycie z zyskiem/strata
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.details.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak szczegolowych danych w wybranym okresie</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 font-medium">
                            Data
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Produkt
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Usluga
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Pracownik
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Zuzycie
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Koszt
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Przychod
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Zysk/Strata
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.details.map((record) => {
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
                              <td className="py-3 px-2">
                                {record.service || "-"}
                              </td>
                              <td className="py-3 px-2">
                                {record.employee || "-"}
                              </td>
                              <td className="py-3 px-2 text-right">
                                {parseFloat(record.quantityUsed).toFixed(2)}{" "}
                                {record.product.unit || "szt."}
                              </td>
                              <td className="py-3 px-2 text-right text-orange-600">
                                {parseFloat(record.materialCost).toFixed(2)}{" "}
                                PLN
                              </td>
                              <td className="py-3 px-2 text-right text-blue-600">
                                {parseFloat(record.attributedRevenue).toFixed(
                                  2
                                )}{" "}
                                PLN
                              </td>
                              <td
                                className={`py-3 px-2 text-right font-medium ${
                                  profitLoss >= 0
                                    ? "text-green-700"
                                    : "text-red-600"
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
                            {parseFloat(
                              reportData.totals.totalMaterialCost
                            ).toFixed(2)}{" "}
                            PLN
                          </td>
                          <td className="py-3 px-2 text-right text-blue-600">
                            {parseFloat(
                              reportData.totals.totalRevenue
                            ).toFixed(2)}{" "}
                            PLN
                          </td>
                          <td
                            className={`py-3 px-2 text-right ${
                              parseFloat(
                                reportData.totals.totalProfitLoss
                              ) >= 0
                                ? "text-green-700"
                                : "text-red-600"
                            }`}
                          >
                            {parseFloat(
                              reportData.totals.totalProfitLoss
                            ) >= 0
                              ? "+"
                              : ""}
                            {parseFloat(
                              reportData.totals.totalProfitLoss
                            ).toFixed(2)}{" "}
                            PLN
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
