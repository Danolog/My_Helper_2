"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  TrendingUp,
  Star,
  Users,
  Scissors,
  RefreshCw,
  BarChart3,
  Trophy,
  Hash,
  Crown,
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

interface ServiceRanking {
  rank: number;
  serviceId: string;
  serviceName: string;
  categoryName: string | null;
  basePrice: string;
  baseDuration: number;
  bookingCount: number;
  completedCount: number;
  revenue: string;
  uniqueClients: number;
  avgRating: string | null;
  ratingCount: number;
  share: string;
  topEmployee: { name: string; count: number } | null;
  monthlyTrend: { month: string; count: number }[];
}

interface ReportData {
  summary: {
    totalBookings: number;
    totalUniqueServices: number;
    avgBookingsPerService: string;
    totalRevenue: string;
  };
  rankings: ServiceRanking[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export default function ServicePopularityReportPage() {
  const { data: _session } = useSession();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 90 days (wider for popularity analysis)
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [dateFrom, setDateFrom] = useState(
    ninetyDaysAgo.toISOString().split("T")[0]
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
        `/api/reports/services-popularity?${params.toString()}`
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
      console.error("[Service Popularity Report] Error:", err);
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
        `/api/reports/services-popularity?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-popularnosc-uslug-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Service Popularity Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Popularnosc uslug",
        subtitle: "Ranking najczesciej rezerwowanych uslug w salonie",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Laczna liczba rezerwacji", value: `${reportData.summary.totalBookings}` },
          { label: "Liczba uslug", value: `${reportData.summary.totalUniqueServices}` },
          { label: "Srednia rezerwacji / usluge", value: `${reportData.summary.avgBookingsPerService}` },
          { label: "Przychod z uslug", value: `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN` },
        ],
        tables: [
          ...(reportData.rankings.length > 0
            ? [
                {
                  title: "Pelny ranking uslug",
                  headers: ["#", "Usluga", "Rezerwacje", "Ukonczone", "Przychod", "Klienci", "Ocena", "Udzial"],
                  rows: reportData.rankings.map((svc) => [
                    `${svc.rank}`,
                    svc.serviceName,
                    `${svc.bookingCount}`,
                    `${svc.completedCount}`,
                    `${parseFloat(svc.revenue).toFixed(2)} PLN`,
                    `${svc.uniqueClients}`,
                    svc.avgRating ? `${svc.avgRating} (${svc.ratingCount})` : "-",
                    `${svc.share}%`,
                  ]),
                  footerRow: [
                    "-",
                    "RAZEM",
                    `${reportData.summary.totalBookings}`,
                    "-",
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    "-",
                    "-",
                    "100%",
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-popularnosc-uslug-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch (err) {
      console.error("[Service Popularity Report] PDF export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  // Get max booking count for bar chart scaling
  const maxBookingCount =
    reportData?.rankings
      ? Math.max(...reportData.rankings.map((r) => r.bookingCount), 1)
      : 1;

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Crown className="h-4 w-4 text-yellow-500" />;
    if (rank === 2) return <Trophy className="h-4 w-4 text-gray-400" />;
    if (rank === 3) return <Trophy className="h-4 w-4 text-amber-600" />;
    return <Hash className="h-3 w-3 text-muted-foreground" />;
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
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
            <TrendingUp className="h-6 w-6 text-blue-600" />
            Popularnosc uslug
          </h1>
          <p className="text-muted-foreground text-sm">
            Ranking najczesciej rezerwowanych uslug w salonie
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={!reportData || reportData.summary.totalBookings === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            Eksport PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!reportData || reportData.summary.totalBookings === 0}
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
                  Laczna liczba rezerwacji
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                  {reportData.summary.totalBookings}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Liczba uslug
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Scissors className="h-5 w-5 text-purple-600" />
                  {reportData.summary.totalUniqueServices}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Srednia rezerwacji / usluge
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  {reportData.summary.avgBookingsPerService}
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
                <div className="text-2xl font-bold flex items-center gap-1">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top 3 podium */}
          {reportData.rankings.length >= 1 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Top 3 najpopularniejsze uslugi
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {reportData.rankings.slice(0, 3).map((svc) => (
                    <div
                      key={svc.serviceId}
                      className={`p-4 rounded-lg border-2 ${
                        svc.rank === 1
                          ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20"
                          : svc.rank === 2
                            ? "border-gray-300 bg-gray-50 dark:bg-gray-950/20"
                            : "border-amber-600 bg-amber-50 dark:bg-amber-950/20"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {getRankBadge(svc.rank)}
                        <span className="text-lg font-bold">#{svc.rank}</span>
                      </div>
                      <h3 className="font-semibold text-lg mb-1">
                        {svc.serviceName}
                      </h3>
                      {svc.categoryName && (
                        <Badge variant="outline" className="mb-2 text-xs">
                          {svc.categoryName}
                        </Badge>
                      )}
                      <div className="space-y-1 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Rezerwacje:</span>
                          <span className="font-semibold text-foreground">
                            {svc.bookingCount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Przychod:</span>
                          <span className="font-semibold text-green-700">
                            {parseFloat(svc.revenue).toFixed(2)} PLN
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Klienci:</span>
                          <span className="font-semibold text-foreground">
                            {svc.uniqueClients}
                          </span>
                        </div>
                        {svc.avgRating && (
                          <div className="flex justify-between items-center">
                            <span>Ocena:</span>
                            <span className="flex items-center gap-1 font-semibold text-foreground">
                              <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                              {svc.avgRating} ({svc.ratingCount})
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Udzial:</span>
                          <span className="font-semibold text-foreground">
                            {svc.share}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Full rankings table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Pelny ranking uslug
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.rankings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Scissors className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Brak danych w wybranym okresie</p>
                  <p className="text-sm mt-1">
                    Zmien zakres dat lub sprawdz czy istnieja rezerwacje
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-center py-3 px-2 font-medium w-12">
                          #
                        </th>
                        <th className="text-left py-3 px-2 font-medium">
                          Usluga
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Rezerwacje
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Ukonczone
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Przychod
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Klienci
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Ocena
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Udzial
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rankings.map((svc) => (
                        <tr
                          key={svc.serviceId}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="py-3 px-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {getRankBadge(svc.rank)}
                              <span className="font-bold">{svc.rank}</span>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <div className="font-medium">{svc.serviceName}</div>
                            <div className="text-xs text-muted-foreground">
                              {svc.categoryName && (
                                <span>{svc.categoryName} &middot; </span>
                              )}
                              {parseFloat(svc.basePrice).toFixed(0)} PLN &middot;{" "}
                              {formatDuration(svc.baseDuration)}
                              {svc.topEmployee && (
                                <span>
                                  {" "}
                                  &middot; Top:{" "}
                                  {svc.topEmployee.name} ({svc.topEmployee.count})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-20 bg-muted rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{
                                    width: `${Math.max(
                                      (svc.bookingCount / maxBookingCount) * 100,
                                      2
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="w-8 text-right font-medium">
                                {svc.bookingCount}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right">
                            {svc.completedCount}
                          </td>
                          <td className="py-3 px-2 text-right font-medium text-green-700">
                            {parseFloat(svc.revenue).toFixed(2)} PLN
                          </td>
                          <td className="py-3 px-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              {svc.uniqueClients}
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right">
                            {svc.avgRating ? (
                              <div className="flex items-center justify-end gap-1">
                                <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                                <span>{svc.avgRating}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({svc.ratingCount})
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-16 bg-muted rounded-full h-2">
                                <div
                                  className="bg-purple-500 h-2 rounded-full"
                                  style={{
                                    width: `${Math.min(
                                      parseFloat(svc.share),
                                      100
                                    )}%`,
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
                        <td className="py-3 px-2 text-center">-</td>
                        <td className="py-3 px-2">RAZEM</td>
                        <td className="py-3 px-2 text-right">
                          {reportData.summary.totalBookings}
                        </td>
                        <td className="py-3 px-2 text-right">-</td>
                        <td className="py-3 px-2 text-right text-green-700">
                          {parseFloat(
                            reportData.summary.totalRevenue
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right">-</td>
                        <td className="py-3 px-2 text-right">-</td>
                        <td className="py-3 px-2 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
