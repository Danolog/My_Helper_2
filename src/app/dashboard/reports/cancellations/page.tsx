"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Calendar,
  TrendingDown,
  TrendingUp,
  XCircle,
  UserX,
  Search,
  RefreshCw,
  BarChart3,
  Percent,
  Users,
  Scissors,
  DollarSign,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Replace,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface ReasonBreakdown {
  reason: string;
  reasonLabel: string;
  count: number;
  percentage: string;
}

interface EmployeeBreakdown {
  employeeId: string;
  employeeName: string;
  total: number;
  cancelled: number;
  noShow: number;
  rate: string;
}

interface ServiceBreakdown {
  serviceId: string;
  serviceName: string;
  total: number;
  cancelled: number;
  noShow: number;
  rate: string;
  grossLostRevenue: string;
  replacedRevenue: string;
  netLostRevenue: string;
}

interface DayOfWeekBreakdown {
  dayOfWeek: number;
  dayLabel: string;
  total: number;
  cancelled: number;
  rate: string;
}

interface TrendPoint {
  date: string;
  total: number;
  cancelled: number;
  noShow: number;
  rate: string;
  grossLostRevenue: string;
  replacedRevenue: string;
  netLostRevenue: string;
}

interface ComparisonData {
  period: {
    dateFrom: string;
    dateTo: string;
  };
  summary: {
    totalAppointments: number;
    cancellationCount: number;
    cancellationRate: string;
    cancelledCount: number;
    noShowCount: number;
    completedCount: number;
    grossLostRevenue: string;
    replacedRevenue: string;
    netLostRevenue: string;
    replacedCount: number;
    lostRevenue: string;
  };
  deltas: {
    netLostRevenue: string;
    netLostRevenuePercent: string;
    cancellationRate: string;
    cancellationCount: number;
    totalAppointments: number;
  };
}

interface ReportData {
  summary: {
    totalAppointments: number;
    cancellationCount: number;
    cancellationRate: string;
    cancelledCount: number;
    noShowCount: number;
    completedCount: number;
    grossLostRevenue: string;
    replacedRevenue: string;
    netLostRevenue: string;
    replacedCount: number;
    lostRevenue: string;
  };
  byReason: ReasonBreakdown[];
  byEmployee: EmployeeBreakdown[];
  byService: ServiceBreakdown[];
  byDayOfWeek: DayOfWeekBreakdown[];
  trend: TrendPoint[];
  comparison: ComparisonData | null;
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
    compareDateFrom: string | null;
    compareDateTo: string | null;
  };
}

export default function CancellationReportPage() {
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

  // Comparison period (previous 30 days by default when enabled)
  const [showComparison, setShowComparison] = useState(false);
  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const [compareDateFrom, setCompareDateFrom] = useState(
    sixtyDaysAgo.toISOString().split("T")[0]
  );
  const [compareDateTo, setCompareDateTo] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );

  const [activeTab, setActiveTab] = useState<
    "lostrevenue" | "reason" | "employee" | "service" | "dayofweek" | "trend"
  >("lostrevenue");

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (showComparison && compareDateFrom && compareDateTo) {
        params.append("compareDateFrom", compareDateFrom);
        params.append("compareDateTo", compareDateTo);
      }

      const res = await fetch(
        `/api/reports/cancellations?${params.toString()}`
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
      console.error("[Cancellation Report] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, showComparison, compareDateFrom, compareDateTo]);

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
      if (showComparison && compareDateFrom && compareDateTo) {
        params.append("compareDateFrom", compareDateFrom);
        params.append("compareDateTo", compareDateTo);
      }

      const res = await fetch(
        `/api/reports/cancellations?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-utracony-przychod-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Cancellation Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
    });
  };

  // Get color severity for cancellation rate
  const getRateColor = (rate: string) => {
    const val = parseFloat(rate);
    if (val >= 30) return "text-red-600";
    if (val >= 15) return "text-orange-600";
    if (val >= 5) return "text-yellow-600";
    return "text-green-600";
  };

  const getRateBadge = (rate: string) => {
    const val = parseFloat(rate);
    if (val >= 30) return "destructive";
    if (val >= 15) return "secondary";
    return "outline";
  };

  // Delta indicator helper
  const getDeltaIcon = (value: number, invertColors = false) => {
    const isPositive = value > 0;
    const isNegative = value < 0;
    // For revenue loss, positive delta = worse (red), negative delta = better (green)
    // invertColors flips this for metrics where higher is better
    const goodColor = invertColors ? "text-red-600" : "text-green-600";
    const badColor = invertColors ? "text-green-600" : "text-red-600";

    if (isPositive) {
      return (
        <span className={`flex items-center gap-0.5 text-sm font-medium ${badColor}`}>
          <ArrowUpRight className="h-3.5 w-3.5" />
          +{Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
        </span>
      );
    }
    if (isNegative) {
      return (
        <span className={`flex items-center gap-0.5 text-sm font-medium ${goodColor}`}>
          <ArrowDownRight className="h-3.5 w-3.5" />
          {Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-0.5 text-sm font-medium text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        0
      </span>
    );
  };

  // Calculate max for trend bar chart
  const maxTrendTotal = reportData?.trend
    ? Math.max(...reportData.trend.map((t) => t.total), 1)
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
            <TrendingDown className="h-6 w-6 text-red-600" />
            Utracony przychod z anulacji
          </h1>
          <p className="text-muted-foreground text-sm">
            Analiza utraconego przychodu z anulowanych wizyt z uwzglednieniem zastepstw
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

          {/* Comparison period toggle */}
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setShowComparison(!showComparison)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  showComparison ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showComparison ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <label className="text-sm font-medium flex items-center gap-1">
                <Scale className="h-4 w-4" />
                Porownaj z innym okresem
              </label>
            </div>

            {showComparison && (
              <div className="flex flex-wrap items-end gap-4 ml-14">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-sm font-medium mb-1 block text-muted-foreground">
                    Okres porownawczy od
                  </label>
                  <Input
                    type="date"
                    value={compareDateFrom}
                    onChange={(e) => setCompareDateFrom(e.target.value)}
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="text-sm font-medium mb-1 block text-muted-foreground">
                    Okres porownawczy do
                  </label>
                  <Input
                    type="date"
                    value={compareDateTo}
                    onChange={(e) => setCompareDateTo(e.target.value)}
                  />
                </div>
              </div>
            )}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Laczna liczba wizyt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                  {reportData.summary.totalAppointments}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Zrealizowanych: {reportData.summary.completedCount}
                </p>
                {reportData.comparison && (
                  <div className="mt-1">
                    {getDeltaIcon(reportData.comparison.deltas.totalAppointments, true)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Anulowane + nieobecnosci
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <XCircle className="h-5 w-5 text-red-600" />
                  {reportData.summary.cancellationCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {reportData.summary.cancelledCount} anulowanych,{" "}
                  {reportData.summary.noShowCount} nieobecnosci
                </p>
                {reportData.comparison && (
                  <div className="mt-1">
                    {getDeltaIcon(reportData.comparison.deltas.cancellationCount)}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Wskaznik anulacji
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold flex items-center gap-1 ${getRateColor(reportData.summary.cancellationRate)}`}
                >
                  <Percent className="h-5 w-5" />
                  {reportData.summary.cancellationRate}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {parseFloat(reportData.summary.cancellationRate) < 10
                    ? "Dobry wynik"
                    : parseFloat(reportData.summary.cancellationRate) < 20
                      ? "Do poprawy"
                      : "Wymaga uwagi"}
                </p>
                {reportData.comparison && (
                  <div className="mt-1">
                    {getDeltaIcon(parseFloat(reportData.comparison.deltas.cancellationRate))}
                    <span className="text-xs text-muted-foreground ml-1">pp</span>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-700">
                  Rzeczywisty utracony przychod
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1 text-red-600">
                  <DollarSign className="h-5 w-5" />
                  {parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Po uwzglednieniu {reportData.summary.replacedCount} zastepstw
                </p>
                {reportData.comparison && (
                  <div className="mt-1">
                    {getDeltaIcon(parseFloat(reportData.comparison.deltas.netLostRevenue))}
                    <span className="text-xs text-muted-foreground ml-1">PLN</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Period comparison card */}
          {reportData.comparison && (
            <Card className="mb-6 border-blue-200 bg-blue-50/30">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Scale className="h-5 w-5 text-blue-600" />
                  Porownanie okresow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Biezacy okres</p>
                    <p className="text-sm font-medium">
                      {reportData.filters.dateFrom} - {reportData.filters.dateTo}
                    </p>
                    <p className="text-lg font-bold text-red-600 mt-1">
                      {parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {reportData.summary.cancellationCount} anulacji ({reportData.summary.cancellationRate}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Okres porownawczy</p>
                    <p className="text-sm font-medium">
                      {reportData.comparison.period.dateFrom} - {reportData.comparison.period.dateTo}
                    </p>
                    <p className="text-lg font-bold text-red-600 mt-1">
                      {parseFloat(reportData.comparison.summary.netLostRevenue).toFixed(2)} PLN
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {reportData.comparison.summary.cancellationCount} anulacji ({reportData.comparison.summary.cancellationRate}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Zmiana</p>
                    <div className="flex items-center gap-2 mt-1">
                      {parseFloat(reportData.comparison.deltas.netLostRevenue) > 0 ? (
                        <TrendingUp className="h-5 w-5 text-red-600" />
                      ) : parseFloat(reportData.comparison.deltas.netLostRevenue) < 0 ? (
                        <TrendingDown className="h-5 w-5 text-green-600" />
                      ) : (
                        <Minus className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span
                        className={`text-lg font-bold ${
                          parseFloat(reportData.comparison.deltas.netLostRevenue) > 0
                            ? "text-red-600"
                            : parseFloat(reportData.comparison.deltas.netLostRevenue) < 0
                              ? "text-green-600"
                              : "text-muted-foreground"
                        }`}
                      >
                        {parseFloat(reportData.comparison.deltas.netLostRevenue) > 0 ? "+" : ""}
                        {parseFloat(reportData.comparison.deltas.netLostRevenue).toFixed(2)} PLN
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {reportData.comparison.deltas.netLostRevenuePercent}% zmiana utraconego przychodu
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {parseFloat(reportData.comparison.deltas.cancellationRate) > 0 ? "+" : ""}
                      {reportData.comparison.deltas.cancellationRate} pp zmiana wskaznika anulacji
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tab switch */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant={activeTab === "lostrevenue" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("lostrevenue")}
            >
              <DollarSign className="h-4 w-4 mr-1" />
              Utracony przychod
            </Button>
            <Button
              variant={activeTab === "reason" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("reason")}
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              Wg powodu
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
              variant={activeTab === "service" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("service")}
            >
              <Scissors className="h-4 w-4 mr-1" />
              Wg uslugi
            </Button>
            <Button
              variant={activeTab === "dayofweek" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("dayofweek")}
            >
              <Calendar className="h-4 w-4 mr-1" />
              Wg dnia tygodnia
            </Button>
            <Button
              variant={activeTab === "trend" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("trend")}
            >
              <TrendingDown className="h-4 w-4 mr-1" />
              Trend dzienny
            </Button>
          </div>

          {/* Lost Revenue tab */}
          {activeTab === "lostrevenue" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-red-600" />
                  Analiza utraconego przychodu
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.summary.cancellationCount === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak anulowanych wizyt w wybranym okresie</p>
                    <p className="text-sm mt-1">Nie utracono przychodu - swietny wynik!</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Revenue breakdown visual */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-lg border bg-red-50 border-red-200">
                        <div className="flex items-center gap-2 text-sm text-red-700 font-medium mb-1">
                          <XCircle className="h-4 w-4" />
                          Calkowita wartosc anulacji
                        </div>
                        <div className="text-2xl font-bold text-red-700">
                          {parseFloat(reportData.summary.grossLostRevenue).toFixed(2)} PLN
                        </div>
                        <p className="text-xs text-red-600 mt-1">
                          Na podstawie cen uslug ({reportData.summary.cancellationCount} wizyt)
                        </p>
                      </div>
                      <div className="p-4 rounded-lg border bg-green-50 border-green-200">
                        <div className="flex items-center gap-2 text-sm text-green-700 font-medium mb-1">
                          <Replace className="h-4 w-4" />
                          Odzyskane przez zastepstwa
                        </div>
                        <div className="text-2xl font-bold text-green-700">
                          -{parseFloat(reportData.summary.replacedRevenue).toFixed(2)} PLN
                        </div>
                        <p className="text-xs text-green-600 mt-1">
                          {reportData.summary.replacedCount} wizyt zastapionych nowymi rezerwacjami
                        </p>
                      </div>
                      <div className="p-4 rounded-lg border-2 bg-orange-50 border-orange-300">
                        <div className="flex items-center gap-2 text-sm text-orange-700 font-medium mb-1">
                          <AlertTriangle className="h-4 w-4" />
                          Rzeczywista strata
                        </div>
                        <div className="text-2xl font-bold text-orange-700">
                          {parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN
                        </div>
                        <p className="text-xs text-orange-600 mt-1">
                          Wartosc niewypelnionych terminow
                        </p>
                      </div>
                    </div>

                    {/* Revenue bar */}
                    <div>
                      <p className="text-sm font-medium mb-2">Podzial utraconego przychodu</p>
                      <div className="w-full bg-muted rounded-lg h-10 relative overflow-hidden">
                        {parseFloat(reportData.summary.grossLostRevenue) > 0 && (
                          <>
                            {/* Net lost (orange) */}
                            <div
                              className="bg-orange-500 h-10 absolute top-0 left-0 flex items-center justify-center"
                              style={{
                                width: `${(parseFloat(reportData.summary.netLostRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100}%`,
                              }}
                            >
                              {(parseFloat(reportData.summary.netLostRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100 > 15 && (
                                <span className="text-xs text-white font-medium">
                                  {parseFloat(reportData.summary.netLostRevenue).toFixed(0)} PLN
                                </span>
                              )}
                            </div>
                            {/* Replaced (green) */}
                            <div
                              className="bg-green-500 h-10 absolute top-0 flex items-center justify-center"
                              style={{
                                left: `${(parseFloat(reportData.summary.netLostRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100}%`,
                                width: `${(parseFloat(reportData.summary.replacedRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100}%`,
                              }}
                            >
                              {(parseFloat(reportData.summary.replacedRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100 > 15 && (
                                <span className="text-xs text-white font-medium">
                                  {parseFloat(reportData.summary.replacedRevenue).toFixed(0)} PLN
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-6 mt-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded bg-orange-500" />
                          Rzeczywista strata ({parseFloat(reportData.summary.grossLostRevenue) > 0 ? ((parseFloat(reportData.summary.netLostRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100).toFixed(0) : 0}%)
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded bg-green-500" />
                          Odzyskane ({parseFloat(reportData.summary.grossLostRevenue) > 0 ? ((parseFloat(reportData.summary.replacedRevenue) / parseFloat(reportData.summary.grossLostRevenue)) * 100).toFixed(0) : 0}%)
                        </div>
                      </div>
                    </div>

                    {/* Per-service lost revenue */}
                    {reportData.byService.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Utracony przychod wg uslugi</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-2 px-2 font-medium">Usluga</th>
                                <th className="text-right py-2 px-2 font-medium">Anulowane</th>
                                <th className="text-right py-2 px-2 font-medium">Calkowita wartosc</th>
                                <th className="text-right py-2 px-2 font-medium">Odzyskane</th>
                                <th className="text-right py-2 px-2 font-medium">Strata netto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reportData.byService
                                .filter((svc) => parseFloat(svc.grossLostRevenue) > 0)
                                .sort((a, b) => parseFloat(b.netLostRevenue) - parseFloat(a.netLostRevenue))
                                .map((svc) => (
                                  <tr key={svc.serviceId} className="border-b hover:bg-muted/50">
                                    <td className="py-2 px-2 font-medium">{svc.serviceName}</td>
                                    <td className="py-2 px-2 text-right">
                                      {svc.cancelled + svc.noShow}
                                    </td>
                                    <td className="py-2 px-2 text-right text-red-600">
                                      {parseFloat(svc.grossLostRevenue).toFixed(2)} PLN
                                    </td>
                                    <td className="py-2 px-2 text-right text-green-600">
                                      {parseFloat(svc.replacedRevenue) > 0
                                        ? `-${parseFloat(svc.replacedRevenue).toFixed(2)} PLN`
                                        : "-"}
                                    </td>
                                    <td className="py-2 px-2 text-right font-bold text-orange-700">
                                      {parseFloat(svc.netLostRevenue).toFixed(2)} PLN
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 font-bold">
                                <td className="py-2 px-2">RAZEM</td>
                                <td className="py-2 px-2 text-right">
                                  {reportData.summary.cancellationCount}
                                </td>
                                <td className="py-2 px-2 text-right text-red-600">
                                  {parseFloat(reportData.summary.grossLostRevenue).toFixed(2)} PLN
                                </td>
                                <td className="py-2 px-2 text-right text-green-600">
                                  {parseFloat(reportData.summary.replacedRevenue) > 0
                                    ? `-${parseFloat(reportData.summary.replacedRevenue).toFixed(2)} PLN`
                                    : "-"}
                                </td>
                                <td className="py-2 px-2 text-right text-orange-700">
                                  {parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* By Reason tab */}
          {activeTab === "reason" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Podzial wg powodu
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.summary.cancellationCount === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <XCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak anulowanych wizyt w wybranym okresie</p>
                    <p className="text-sm mt-1">To swietny wynik!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {reportData.byReason.map((item) => (
                      <div
                        key={item.reason}
                        className="flex items-center gap-4 p-4 border rounded-lg"
                      >
                        <div className="shrink-0">
                          {item.reason === "cancelled" ? (
                            <XCircle className="h-8 w-8 text-orange-500" />
                          ) : (
                            <UserX className="h-8 w-8 text-red-500" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-lg">
                            {item.reasonLabel}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {item.reason === "cancelled"
                              ? "Wizyty anulowane przez klienta lub personel"
                              : "Klient nie pojawil sie na wizycie"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold">{item.count}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.percentage}% anulacji
                          </div>
                        </div>
                        <div className="w-32">
                          <div className="w-full bg-muted rounded-full h-3">
                            <div
                              className={`h-3 rounded-full ${item.reason === "cancelled" ? "bg-orange-500" : "bg-red-500"}`}
                              style={{
                                width: `${Math.min(parseFloat(item.percentage), 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* By Employee tab */}
          {activeTab === "employee" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Anulacje wg pracownika
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
                            Laczne wizyty
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Anulowane
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Nieobecnosci
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Wskaznik
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
                              {emp.total}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {emp.cancelled}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {emp.noShow}
                            </td>
                            <td className="py-3 px-2 text-right">
                              <Badge
                                variant={
                                  getRateBadge(emp.rate) as
                                    | "destructive"
                                    | "secondary"
                                    | "outline"
                                }
                              >
                                <span className={getRateColor(emp.rate)}>
                                  {emp.rate}%
                                </span>
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* By Service tab */}
          {activeTab === "service" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Scissors className="h-5 w-5" />
                  Anulacje wg uslugi
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.byService.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Scissors className="h-12 w-12 mx-auto mb-2 opacity-50" />
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
                            Laczne wizyty
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Anulowane
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Nieobecnosci
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Wskaznik
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Strata netto
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
                              {svc.total}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {svc.cancelled}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {svc.noShow}
                            </td>
                            <td className="py-3 px-2 text-right">
                              <Badge
                                variant={
                                  getRateBadge(svc.rate) as
                                    | "destructive"
                                    | "secondary"
                                    | "outline"
                                }
                              >
                                <span className={getRateColor(svc.rate)}>
                                  {svc.rate}%
                                </span>
                              </Badge>
                            </td>
                            <td className="py-3 px-2 text-right font-medium text-red-700">
                              {parseFloat(svc.netLostRevenue).toFixed(2)} PLN
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* By Day of Week tab */}
          {activeTab === "dayofweek" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Anulacje wg dnia tygodnia
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.byDayOfWeek.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak danych w wybranym okresie</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reportData.byDayOfWeek.map((day) => (
                      <div
                        key={day.dayOfWeek}
                        className="flex items-center gap-4"
                      >
                        <span className="text-sm font-medium w-28 shrink-0">
                          {day.dayLabel}
                        </span>
                        <div className="flex-1 bg-muted rounded-full h-8 relative overflow-hidden">
                          <div
                            className="bg-blue-200 h-8 rounded-full absolute top-0 left-0"
                            style={{
                              width: `${Math.max((day.total / (Math.max(...reportData.byDayOfWeek.map((d) => d.total), 1))) * 100, 2)}%`,
                            }}
                          />
                          <div
                            className="bg-red-500 h-8 rounded-full absolute top-0 left-0 flex items-center"
                            style={{
                              width: `${Math.max((day.cancelled / (Math.max(...reportData.byDayOfWeek.map((d) => d.total), 1))) * 100, day.cancelled > 0 ? 2 : 0)}%`,
                            }}
                          >
                            {day.cancelled > 0 &&
                              (day.cancelled /
                                Math.max(
                                  ...reportData.byDayOfWeek.map((d) => d.total),
                                  1
                                )) *
                                100 >
                                8 && (
                                <span className="text-xs text-white font-medium pl-2">
                                  {day.cancelled}
                                </span>
                              )}
                          </div>
                        </div>
                        <div className="text-sm w-20 text-right shrink-0">
                          {day.cancelled}/{day.total}
                        </div>
                        <Badge
                          variant={
                            getRateBadge(day.rate) as
                              | "destructive"
                              | "secondary"
                              | "outline"
                          }
                          className="shrink-0 w-16 justify-center"
                        >
                          <span className={getRateColor(day.rate)}>
                            {day.rate}%
                          </span>
                        </Badge>
                      </div>
                    ))}
                    <div className="flex items-center gap-4 mt-4 pt-4 border-t text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded bg-blue-200" />
                        Laczne wizyty
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded bg-red-500" />
                        Anulowane + nieobecnosci
                      </div>
                    </div>
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
                  <TrendingDown className="h-5 w-5" />
                  Trend dzienny
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.trend.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingDown className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak danych w wybranym okresie</p>
                  </div>
                ) : (
                  <div>
                    {/* Bar chart */}
                    <div className="space-y-2 mb-6">
                      {reportData.trend.map((point) => {
                        const lostCount = point.cancelled + point.noShow;
                        return (
                          <div
                            key={point.date}
                            className="flex items-center gap-3"
                          >
                            <span className="text-xs text-muted-foreground w-12 text-right shrink-0">
                              {formatDateShort(point.date)}
                            </span>
                            <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                              <div
                                className="bg-blue-300 h-6 rounded-full absolute top-0 left-0"
                                style={{
                                  width: `${Math.max((point.total / maxTrendTotal) * 100, 2)}%`,
                                }}
                              />
                              <div
                                className="bg-red-500 h-6 rounded-full absolute top-0 left-0 flex items-center"
                                style={{
                                  width: `${Math.max((lostCount / maxTrendTotal) * 100, lostCount > 0 ? 2 : 0)}%`,
                                }}
                              >
                                {lostCount > 0 &&
                                  (lostCount / maxTrendTotal) * 100 > 10 && (
                                    <span className="text-xs text-white font-medium pl-2">
                                      {lostCount}
                                    </span>
                                  )}
                              </div>
                            </div>
                            <span className="text-sm w-16 text-right shrink-0">
                              {lostCount}/{point.total}
                            </span>
                            <Badge
                              variant={
                                getRateBadge(point.rate) as
                                  | "destructive"
                                  | "secondary"
                                  | "outline"
                              }
                              className="shrink-0 w-16 justify-center"
                            >
                              <span className={getRateColor(point.rate)}>
                                {point.rate}%
                              </span>
                            </Badge>
                          </div>
                        );
                      })}
                    </div>

                    {/* Detailed table */}
                    <div className="overflow-x-auto border-t pt-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2 font-medium">
                              Data
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Laczne
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Anulowane
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Nieobecnosci
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Wskaznik
                            </th>
                            <th className="text-right py-2 px-2 font-medium">
                              Strata netto
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
                              <td className="py-2 px-2 text-right">
                                {point.total}
                              </td>
                              <td className="py-2 px-2 text-right text-orange-600">
                                {point.cancelled}
                              </td>
                              <td className="py-2 px-2 text-right text-red-600">
                                {point.noShow}
                              </td>
                              <td className="py-2 px-2 text-right">
                                <span className={getRateColor(point.rate)}>
                                  {point.rate}%
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right font-medium text-red-700">
                                {parseFloat(point.netLostRevenue).toFixed(2)} PLN
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 font-bold">
                            <td className="py-2 px-2">RAZEM</td>
                            <td className="py-2 px-2 text-right">
                              {reportData.summary.totalAppointments}
                            </td>
                            <td className="py-2 px-2 text-right text-orange-600">
                              {reportData.summary.cancelledCount}
                            </td>
                            <td className="py-2 px-2 text-right text-red-600">
                              {reportData.summary.noShowCount}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <span
                                className={getRateColor(
                                  reportData.summary.cancellationRate
                                )}
                              >
                                {reportData.summary.cancellationRate}%
                              </span>
                            </td>
                            <td className="py-2 px-2 text-right text-red-700">
                              {parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN
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
