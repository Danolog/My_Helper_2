"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import {
  ArrowLeft,
  Download,
  TrendingUp,
  DollarSign,
  Users,
  Scissors,
  RefreshCw,
  BarChart3,
  Percent,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { EmployeeFilter } from "@/components/reports/employee-filter";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { generateReportPDF } from "@/lib/pdf-export";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface ServiceBreakdown {
  serviceId: string;
  serviceName: string;
  count: number;
  revenue: string;
  avgPrice: string;
  share: string;
}

interface EmployeeBreakdown {
  employeeId: string;
  employeeName: string;
  count: number;
  revenue: string;
  avgPrice: string;
  share: string;
}

interface TrendPoint {
  date: string;
  revenue: string;
  count: number;
}

interface ReportData {
  summary: {
    totalRevenue: string;
    totalAppointments: number;
    avgRevenuePerAppointment: string;
    totalDiscount: string;
  };
  byService: ServiceBreakdown[];
  byEmployee: EmployeeBreakdown[];
  trend: TrendPoint[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
    employeeIds: string[] | null;
  };
}

export default function RevenueReportPage() {
  const { data: _session } = useSession();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Initialize filters from URL search params, falling back to defaults
  const [dateFrom, setDateFrom] = useState(
    searchParams.get("dateFrom") || thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(
    searchParams.get("dateTo") || today.toISOString().split("T")[0]
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(
    searchParams.get("employeeIds")
      ? searchParams.get("employeeIds")!.split(",").filter(Boolean)
      : []
  );
  const [activeTab, setActiveTab] = useState<
    "service" | "employee" | "trend"
  >((searchParams.get("tab") as "service" | "employee" | "trend") || "service");

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedEmployeeIds.length > 0) {
        params.append("employeeIds", selectedEmployeeIds.join(","));
      }

      const res = await fetch(`/api/reports/revenue?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Nie udalo sie pobrac raportu");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error("Nie udalo sie pobrac raportu. Sprobuj ponownie pozniej.");
      }
      setReportData(json.data);
    } catch (err) {
      console.error("[Revenue Report] Error:", err);
      setError("Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedEmployeeIds]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Sync filter state to browser URL for shareable links
  // Uses window.history.replaceState to avoid triggering Next.js re-renders
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (selectedEmployeeIds.length > 0) params.set("employeeIds", selectedEmployeeIds.join(","));
    if (activeTab && activeTab !== "service") params.set("tab", activeTab);
    const qs = params.toString();
    const newUrl = `${pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [dateFrom, dateTo, selectedEmployeeIds, activeTab, pathname]);

  const handleExport = async (format: "csv" | "xlsx") => {
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        format,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedEmployeeIds.length > 0) {
        params.append("employeeIds", selectedEmployeeIds.join(","));
      }

      const res = await fetch(`/api/reports/revenue?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "xlsx" ? "xlsx" : "csv";
      a.download = `raport-przychodow-${dateFrom || "all"}-${dateTo || "all"}.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(
        format === "xlsx"
          ? "Raport wyeksportowany do Excel"
          : "Raport wyeksportowany do CSV"
      );
    } catch (err) {
      console.error("[Revenue Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Raport przychodow",
        subtitle: "Analiza przychodow salonu w wybranym okresie",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Calkowity przychod", value: `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN` },
          { label: "Liczba wizyt", value: `${reportData.summary.totalAppointments}` },
          { label: "Sredni przychod / wizyte", value: `${parseFloat(reportData.summary.avgRevenuePerAppointment).toFixed(2)} PLN` },
          { label: "Znizki", value: `${parseFloat(reportData.summary.totalDiscount).toFixed(2)} PLN` },
        ],
        tables: [
          ...(reportData.byService.length > 0
            ? [
                {
                  title: "Przychod wg uslugi",
                  headers: ["Usluga", "Liczba wizyt", "Przychod", "Srednia cena", "Udzial"],
                  rows: reportData.byService.map((svc) => [
                    svc.serviceName,
                    `${svc.count}`,
                    `${parseFloat(svc.revenue).toFixed(2)} PLN`,
                    `${parseFloat(svc.avgPrice).toFixed(2)} PLN`,
                    `${svc.share}%`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    `${reportData.summary.totalAppointments}`,
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.avgRevenuePerAppointment).toFixed(2)} PLN`,
                    "100%",
                  ],
                },
              ]
            : []),
          ...(reportData.byEmployee.length > 0
            ? [
                {
                  title: "Przychod wg pracownika",
                  headers: ["Pracownik", "Liczba wizyt", "Przychod", "Srednia cena", "Udzial"],
                  rows: reportData.byEmployee.map((emp) => [
                    emp.employeeName,
                    `${emp.count}`,
                    `${parseFloat(emp.revenue).toFixed(2)} PLN`,
                    `${parseFloat(emp.avgPrice).toFixed(2)} PLN`,
                    `${emp.share}%`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    `${reportData.summary.totalAppointments}`,
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.avgRevenuePerAppointment).toFixed(2)} PLN`,
                    "100%",
                  ],
                },
              ]
            : []),
          ...(reportData.trend.length > 0
            ? [
                {
                  title: "Trend dzienny",
                  headers: ["Data", "Przychod", "Liczba wizyt"],
                  rows: reportData.trend.map((point) => [
                    new Date(point.date + "T12:00:00").toLocaleDateString("pl-PL", {
                      weekday: "short",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }),
                    `${parseFloat(point.revenue).toFixed(2)} PLN`,
                    `${point.count}`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    `${reportData.summary.totalAppointments}`,
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-przychodow-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch (err) {
      console.error("[Revenue Report] PDF export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
    });
  };

  // Calculate max revenue for trend bar chart scaling
  const maxTrendRevenue =
    reportData?.trend
      ? Math.max(...reportData.trend.map((t) => parseFloat(t.revenue)), 1)
      : 1;

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
            <DollarSign className="h-6 w-6 text-green-600" />
            Raport przychodow
          </h1>
          <p className="text-muted-foreground text-sm">
            Analiza przychodow salonu w wybranym okresie
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={!reportData || reportData.summary.totalAppointments === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            Eksport PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport("xlsx")}
            disabled={!reportData || reportData.summary.totalAppointments === 0}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Eksport Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport("csv")}
            disabled={!reportData || reportData.summary.totalAppointments === 0}
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

      {/* Employee filter */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Filtruj wg pracownika:
            </span>
            <EmployeeFilter
              selectedEmployeeIds={selectedEmployeeIds}
              onSelectionChange={setSelectedEmployeeIds}
            />
          </div>
          {selectedEmployeeIds.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Raport pokazuje dane tylko dla wybranych pracownikow. Wyczysc filtr aby zobaczyc dane dla wszystkich.
            </p>
          )}
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
                  {parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN
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
                  {reportData.summary.totalAppointments}
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
                  {parseFloat(
                    reportData.summary.avgRevenuePerAppointment
                  ).toFixed(2)}{" "}
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
                  {parseFloat(reportData.summary.totalDiscount).toFixed(2)} PLN
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tab switch */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={activeTab === "service" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("service")}
            >
              <Scissors className="h-4 w-4 mr-1" />
              Wg uslugi
            </Button>
            <Button
              variant={activeTab === "employee" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("employee")}
            >
              <Users className="h-4 w-4 mr-1" />
              Wg pracownika
            </Button>
            <Button
              variant={activeTab === "trend" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("trend")}
            >
              <TrendingUp className="h-4 w-4 mr-1" />
              Trend dzienny
            </Button>
          </div>

          {/* Service breakdown tab */}
          {activeTab === "service" && (
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
                              reportData.summary.totalRevenue
                            ).toFixed(2)}{" "}
                            PLN
                          </td>
                          <td className="py-3 px-2 text-right">
                            {parseFloat(
                              reportData.summary.avgRevenuePerAppointment
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
          )}

          {/* Employee breakdown tab */}
          {activeTab === "employee" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Przychod wg pracownika
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.byEmployee.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak danych w wybranym okresie</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 font-medium">
                            Pracownik
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
                        {reportData.byEmployee.map((emp) => (
                          <tr
                            key={emp.employeeId}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="py-3 px-2 font-medium">
                              {emp.employeeName}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {emp.count}
                            </td>
                            <td className="py-3 px-2 text-right font-medium text-green-700">
                              {parseFloat(emp.revenue).toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(emp.avgPrice).toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 bg-muted rounded-full h-2">
                                  <div
                                    className="bg-blue-500 h-2 rounded-full"
                                    style={{
                                      width: `${Math.min(parseFloat(emp.share), 100)}%`,
                                    }}
                                  />
                                </div>
                                <span className="w-12 text-right">
                                  {emp.share}%
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
                              reportData.summary.totalRevenue
                            ).toFixed(2)}{" "}
                            PLN
                          </td>
                          <td className="py-3 px-2 text-right">
                            {parseFloat(
                              reportData.summary.avgRevenuePerAppointment
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
          )}

          {/* Trend tab */}
          {activeTab === "trend" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Trend dzienny
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.trend.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak danych w wybranym okresie</p>
                  </div>
                ) : (
                  <div>
                    {/* Simple bar chart */}
                    <div className="space-y-2 mb-6">
                      {reportData.trend.map((point) => (
                        <div
                          key={point.date}
                          className="flex items-center gap-3"
                        >
                          <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                            {formatDateShort(point.date)}
                          </span>
                          <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                            <div
                              className="bg-green-500 h-6 rounded-full flex items-center transition-all"
                              style={{
                                width: `${Math.max(
                                  (parseFloat(point.revenue) /
                                    maxTrendRevenue) *
                                    100,
                                  2
                                )}%`,
                              }}
                            >
                              {parseFloat(point.revenue) / maxTrendRevenue >
                                0.25 && (
                                <span className="text-xs text-white font-medium pl-2 whitespace-nowrap">
                                  {parseFloat(point.revenue).toFixed(0)} PLN
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-sm font-medium w-24 text-right shrink-0">
                            {parseFloat(point.revenue).toFixed(2)} PLN
                          </span>
                          <Badge variant="outline" className="shrink-0">
                            {point.count} wiz.
                          </Badge>
                        </div>
                      ))}
                    </div>

                    {/* Summary table below chart */}
                    <div className="overflow-x-auto border-t pt-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2 font-medium">
                              Data
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Przychod
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Liczba wizyt
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.trend.map((point) => (
                            <tr
                              key={point.date}
                              className="border-b hover:bg-muted/50"
                            >
                              <td className="py-2 px-2">
                                {new Date(
                                  point.date + "T12:00:00"
                                ).toLocaleDateString("pl-PL", {
                                  weekday: "short",
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                })}
                              </td>
                              <td className="py-2 px-2 text-right font-medium text-green-700">
                                {parseFloat(point.revenue).toFixed(2)} PLN
                              </td>
                              <td className="py-2 px-2 text-right">
                                {point.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 font-bold">
                            <td className="py-2 px-2">RAZEM</td>
                            <td className="py-2 px-2 text-right text-green-700">
                              {parseFloat(
                                reportData.summary.totalRevenue
                              ).toFixed(2)}{" "}
                              PLN
                            </td>
                            <td className="py-2 px-2 text-right">
                              {reportData.summary.totalAppointments}
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
        </>
      )}
    </div>
  );
}
