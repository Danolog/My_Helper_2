"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Calendar,
  TrendingUp,
  Users,
  Star,
  Search,
  RefreshCw,
  Trophy,
  UserCheck,
  Heart,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { generateReportPDF } from "@/lib/pdf-export";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface TopService {
  name: string;
  count: number;
}

interface EmployeePopularity {
  rank: number;
  employeeId: string;
  employeeName: string;
  color: string | null;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  noShowBookings: number;
  uniqueClients: number;
  returningClients: number;
  retentionRate: string;
  avgRating: string;
  reviewCount: number;
  revenue: string;
  topServices: TopService[];
  bookingShare: string;
}

interface ReportData {
  employees: EmployeePopularity[];
  summary: {
    totalEmployees: number;
    totalBookings: number;
    avgRetentionRate: string;
    avgRating: string;
    totalRevenue: string;
  };
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="h-5 w-5 text-yellow-500" />;
  if (rank === 2) return <Trophy className="h-5 w-5 text-gray-400" />;
  if (rank === 3) return <Trophy className="h-5 w-5 text-amber-700" />;
  return <span className="text-sm font-bold text-muted-foreground w-5 text-center inline-block">{rank}</span>;
}

function getRankBadgeColor(rank: number) {
  if (rank === 1) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  if (rank === 2) return "bg-gray-100 text-gray-700 border-gray-300";
  if (rank === 3) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-muted text-muted-foreground border-border";
}

function renderStars(rating: number) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25;
  const stars = [];
  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      stars.push(
        <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
      );
    } else if (i === fullStars && hasHalf) {
      stars.push(
        <Star key={i} className="h-3.5 w-3.5 fill-yellow-400/50 text-yellow-400" />
      );
    } else {
      stars.push(
        <Star key={i} className="h-3.5 w-3.5 text-gray-300" />
      );
    }
  }
  return <span className="flex items-center gap-0.5">{stars}</span>;
}

export default function EmployeePopularityReportPage() {
  const { data: _session } = useSession();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 90 days
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
        `/api/reports/employee-popularity?${params.toString()}`
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
      console.error("[Employee Popularity Report] Error:", err);
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
        `/api/reports/employee-popularity?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ranking-popularnosci-pracownikow-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Employee Popularity Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  // Calculate max bookings for bar chart scaling
  const maxBookings = reportData?.employees
    ? Math.max(...reportData.employees.map((e) => e.totalBookings), 1)
    : 1;

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Ranking popularnosci pracownikow",
        subtitle: "Najczesciej wybierani pracownicy z retencja klientow i ocenami",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Laczne rezerwacje", value: `${reportData.summary.totalBookings}` },
          { label: "Pracownikow", value: `${reportData.summary.totalEmployees}` },
          { label: "Srednia retencja klientow", value: `${reportData.summary.avgRetentionRate}%` },
          { label: "Srednia ocena", value: `${parseFloat(reportData.summary.avgRating).toFixed(1)} / 5` },
        ],
        tables: [
          ...(reportData.employees.length > 0
            ? [
                {
                  title: "Szczegolowy ranking pracownikow",
                  headers: ["#", "Pracownik", "Rezerwacje", "Ukonczone", "Unikalni klienci", "Powracajacy", "Retencja", "Ocena", "Przychod", "Udzial"],
                  rows: reportData.employees.map((emp) => [
                    `${emp.rank}`,
                    emp.employeeName,
                    `${emp.totalBookings}`,
                    `${emp.completedBookings}`,
                    `${emp.uniqueClients}`,
                    `${emp.returningClients}`,
                    `${emp.retentionRate}%`,
                    emp.reviewCount > 0 ? `${emp.avgRating} (${emp.reviewCount})` : "Brak",
                    `${parseFloat(emp.revenue).toFixed(2)} PLN`,
                    `${emp.bookingShare}%`,
                  ]),
                  footerRow: [
                    "",
                    "RAZEM",
                    `${reportData.summary.totalBookings}`,
                    `${reportData.employees.reduce((sum, e) => sum + e.completedBookings, 0)}`,
                    `${reportData.employees.reduce((sum, e) => sum + e.uniqueClients, 0)}`,
                    `${reportData.employees.reduce((sum, e) => sum + e.returningClients, 0)}`,
                    `${reportData.summary.avgRetentionRate}%`,
                    `${parseFloat(reportData.summary.avgRating).toFixed(1)}`,
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    "100%",
                  ],
                },
              ]
            : []),
        ],
        filename: `ranking-popularnosci-pracownikow-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch (err) {
      console.error("[Employee Popularity Report] PDF export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
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
            <Trophy className="h-6 w-6 text-yellow-500" />
            Ranking popularnosci pracownikow
          </h1>
          <p className="text-muted-foreground text-sm">
            Najczesciej wybierani pracownicy z retencja klientow i ocenami
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Laczne rezerwacje
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  {reportData.summary.totalBookings}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Pracownikow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Users className="h-5 w-5 text-purple-600" />
                  {reportData.summary.totalEmployees}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Srednia retencja klientow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Heart className="h-5 w-5 text-red-500" />
                  {reportData.summary.avgRetentionRate}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Srednia ocena
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                  {parseFloat(reportData.summary.avgRating).toFixed(1)} / 5
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Ranking visualization */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                Ranking wg liczby rezerwacji
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.employees.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Brak danych w wybranym okresie</p>
                  <p className="text-sm mt-1">
                    Zmien zakres dat lub sprawdz czy istnieja rezerwacje
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reportData.employees.map((emp) => (
                    <div
                      key={emp.employeeId}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        emp.rank <= 3
                          ? "bg-gradient-to-r from-muted/50 to-transparent"
                          : ""
                      }`}
                    >
                      {/* Rank badge */}
                      <div
                        className={`flex items-center justify-center w-8 h-8 rounded-full border ${getRankBadgeColor(emp.rank)}`}
                      >
                        {getRankIcon(emp.rank)}
                      </div>

                      {/* Employee name and color */}
                      <div className="flex items-center gap-2 w-40 shrink-0">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: emp.color || "#3b82f6" }}
                        />
                        <span className="font-medium text-sm truncate">
                          {emp.employeeName}
                        </span>
                      </div>

                      {/* Booking bar */}
                      <div className="flex-1">
                        <div className="bg-muted rounded-full h-6 relative overflow-hidden">
                          <div
                            className="bg-blue-500 h-6 rounded-full flex items-center transition-all"
                            style={{
                              width: `${Math.max(
                                (emp.totalBookings / maxBookings) * 100,
                                3
                              )}%`,
                            }}
                          >
                            {emp.totalBookings / maxBookings > 0.2 && (
                              <span className="text-xs text-white font-medium pl-2 whitespace-nowrap">
                                {emp.totalBookings} rez.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Stats badges */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-xs">
                          {emp.totalBookings} rez.
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-xs"
                          title="Retencja klientow"
                        >
                          <UserCheck className="h-3 w-3 mr-1" />
                          {emp.retentionRate}%
                        </Badge>
                        {emp.reviewCount > 0 && (
                          <Badge
                            variant="outline"
                            className="text-xs"
                            title="Srednia ocena"
                          >
                            <Star className="h-3 w-3 mr-1 fill-yellow-400 text-yellow-400" />
                            {emp.avgRating}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Detailed table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Szczegolowy ranking
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.employees.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Brak danych w wybranym okresie</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 font-medium">#</th>
                        <th className="text-left py-3 px-2 font-medium">
                          Pracownik
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Rezerwacje
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Ukonczone
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Unikalni klienci
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Powracajacy
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Retencja
                        </th>
                        <th className="text-center py-3 px-2 font-medium">
                          Ocena
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Przychod
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Udzial
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.employees.map((emp) => (
                        <tr
                          key={emp.employeeId}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="py-3 px-2">
                            <div className="flex items-center">
                              {getRankIcon(emp.rank)}
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{
                                  backgroundColor: emp.color || "#3b82f6",
                                }}
                              />
                              <span className="font-medium">
                                {emp.employeeName}
                              </span>
                            </div>
                            {emp.topServices.length > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">
                                Top:{" "}
                                {emp.topServices
                                  .map((s) => `${s.name} (${s.count})`)
                                  .join(", ")}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right font-medium">
                            {emp.totalBookings}
                          </td>
                          <td className="py-3 px-2 text-right">
                            {emp.completedBookings}
                          </td>
                          <td className="py-3 px-2 text-right">
                            {emp.uniqueClients}
                          </td>
                          <td className="py-3 px-2 text-right">
                            {emp.returningClients}
                          </td>
                          <td className="py-3 px-2 text-right">
                            <span
                              className={
                                parseFloat(emp.retentionRate) >= 50
                                  ? "text-green-600 font-medium"
                                  : parseFloat(emp.retentionRate) >= 25
                                    ? "text-yellow-600"
                                    : "text-red-500"
                              }
                            >
                              {emp.retentionRate}%
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex flex-col items-center gap-0.5">
                              {emp.reviewCount > 0 ? (
                                <>
                                  {renderStars(parseFloat(emp.avgRating))}
                                  <span className="text-xs text-muted-foreground">
                                    {emp.avgRating} ({emp.reviewCount})
                                  </span>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Brak opinii
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right font-medium text-green-700">
                            {parseFloat(emp.revenue).toFixed(2)} PLN
                          </td>
                          <td className="py-3 px-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 bg-muted rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{
                                    width: `${Math.min(
                                      parseFloat(emp.bookingShare),
                                      100
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="w-12 text-right text-xs">
                                {emp.bookingShare}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="py-3 px-2" colSpan={2}>
                          RAZEM
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.summary.totalBookings}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.employees.reduce(
                            (sum, e) => sum + e.completedBookings,
                            0
                          )}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.employees.reduce(
                            (sum, e) => sum + e.uniqueClients,
                            0
                          )}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.employees.reduce(
                            (sum, e) => sum + e.returningClients,
                            0
                          )}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.summary.avgRetentionRate}%
                        </td>
                        <td className="py-3 px-2 text-center">
                          {parseFloat(reportData.summary.avgRating).toFixed(1)}
                        </td>
                        <td className="py-3 px-2 text-right text-green-700">
                          {parseFloat(reportData.summary.totalRevenue).toFixed(
                            2
                          )}{" "}
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
        </>
      )}
    </div>
  );
}
