"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Users,
  Clock,
  RefreshCw,
  BarChart3,
  DollarSign,
  Briefcase,
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

interface EmployeeOccupancy {
  employeeId: string;
  employeeName: string;
  color: string | null;
  availableHours: string;
  appointmentHours: string;
  appointmentCount: number;
  occupancyPercentage: string;
  revenue: string;
  completedCount: number;
}

interface ReportData {
  employees: EmployeeOccupancy[];
  summary: {
    totalEmployees: number;
    avgOccupancy: string;
    totalAvailableHours: string;
    totalAppointmentHours: string;
    totalRevenue: string;
  };
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

function getOccupancyColor(percentage: number): string {
  if (percentage >= 80) return "text-green-700 bg-green-100";
  if (percentage >= 50) return "text-blue-700 bg-blue-100";
  if (percentage >= 25) return "text-yellow-700 bg-yellow-100";
  return "text-red-700 bg-red-100";
}

function getBarColor(percentage: number): string {
  if (percentage >= 80) return "bg-green-500";
  if (percentage >= 50) return "bg-blue-500";
  if (percentage >= 25) return "bg-yellow-500";
  return "bg-red-400";
}

export default function EmployeeOccupancyReportPage() {
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
        `/api/reports/employee-occupancy?${params.toString()}`
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
      console.error("[Employee Occupancy Report] Error:", err);
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
        `/api/reports/employee-occupancy?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-obciazenie-pracownikow-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Employee Occupancy Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Raport obciazenia pracownikow",
        subtitle: "Analiza wykorzystania czasu pracy pracownikow",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Pracownicy", value: `${reportData.summary.totalEmployees}` },
          { label: "Srednie obciazenie", value: `${parseFloat(reportData.summary.avgOccupancy).toFixed(1)}%` },
          { label: "Godziny dostepne", value: `${parseFloat(reportData.summary.totalAvailableHours).toFixed(1)} h` },
          { label: "Godziny wizyt", value: `${parseFloat(reportData.summary.totalAppointmentHours).toFixed(1)} h` },
        ],
        tables: [
          ...(reportData.employees.length > 0
            ? [
                {
                  title: "Obciazenie pracownikow",
                  headers: ["Pracownik", "Godziny dostepne", "Godziny wizyt", "Liczba wizyt", "Przychod", "Obciazenie"],
                  rows: reportData.employees.map((emp) => [
                    emp.employeeName,
                    `${parseFloat(emp.availableHours).toFixed(1)} h`,
                    `${parseFloat(emp.appointmentHours).toFixed(1)} h`,
                    `${emp.appointmentCount}`,
                    `${parseFloat(emp.revenue).toFixed(2)} PLN`,
                    `${parseFloat(emp.occupancyPercentage).toFixed(1)}%`,
                  ]),
                  footerRow: [
                    "RAZEM / SREDNIA",
                    `${parseFloat(reportData.summary.totalAvailableHours).toFixed(1)} h`,
                    `${parseFloat(reportData.summary.totalAppointmentHours).toFixed(1)} h`,
                    `${reportData.employees.reduce((sum, e) => sum + e.appointmentCount, 0)}`,
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.avgOccupancy).toFixed(1)}%`,
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-obciazenie-pracownikow-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch (err) {
      console.error("[Employee Occupancy Report] PDF export error:", err);
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
            <Users className="h-6 w-6 text-blue-600" />
            Raport obciazenia pracownikow
          </h1>
          <p className="text-muted-foreground text-sm">
            Analiza wykorzystania czasu pracy pracownikow
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={!reportData || reportData.employees.length === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            Eksport PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!reportData || reportData.employees.length === 0}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Pracownicy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Users className="h-5 w-5 text-blue-600" />
                  {reportData.summary.totalEmployees}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Srednie obciazenie
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <BarChart3 className="h-5 w-5 text-purple-600" />
                  {parseFloat(reportData.summary.avgOccupancy).toFixed(1)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Godziny dostepne
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Clock className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.summary.totalAvailableHours).toFixed(1)}{" "}
                  h
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Godziny wizyt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Briefcase className="h-5 w-5 text-orange-600" />
                  {parseFloat(
                    reportData.summary.totalAppointmentHours
                  ).toFixed(1)}{" "}
                  h
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Przychod
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Employee occupancy table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Obciazenie pracownikow
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.employees.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Brak danych w wybranym okresie</p>
                  <p className="text-sm mt-1">
                    Sprawdz czy istnieja aktywni pracownicy z ustawionymi
                    godzinami pracy
                  </p>
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
                          Godziny dostepne
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Godziny wizyt
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Liczba wizyt
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Przychod
                        </th>
                        <th className="text-right py-3 px-2 font-medium min-w-[200px]">
                          Obciazenie
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.employees.map((emp) => {
                        const occupancy = parseFloat(emp.occupancyPercentage);
                        return (
                          <tr
                            key={emp.employeeId}
                            className="border-b hover:bg-muted/50"
                          >
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
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(emp.availableHours).toFixed(1)} h
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(emp.appointmentHours).toFixed(1)} h
                            </td>
                            <td className="py-3 px-2 text-right">
                              {emp.appointmentCount}
                            </td>
                            <td className="py-3 px-2 text-right font-medium text-green-700">
                              {parseFloat(emp.revenue).toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-24 bg-muted rounded-full h-4 relative overflow-hidden">
                                  <div
                                    className={`h-4 rounded-full transition-all ${getBarColor(occupancy)}`}
                                    style={{
                                      width: `${Math.min(occupancy, 100)}%`,
                                    }}
                                  />
                                </div>
                                <Badge
                                  variant="outline"
                                  className={`w-16 justify-center text-xs ${getOccupancyColor(occupancy)}`}
                                >
                                  {occupancy.toFixed(1)}%
                                </Badge>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="py-3 px-2">RAZEM / SREDNIA</td>
                        <td className="py-3 px-2 text-right">
                          {parseFloat(
                            reportData.summary.totalAvailableHours
                          ).toFixed(1)}{" "}
                          h
                        </td>
                        <td className="py-3 px-2 text-right">
                          {parseFloat(
                            reportData.summary.totalAppointmentHours
                          ).toFixed(1)}{" "}
                          h
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.employees.reduce(
                            (sum, e) => sum + e.appointmentCount,
                            0
                          )}
                        </td>
                        <td className="py-3 px-2 text-right text-green-700">
                          {parseFloat(reportData.summary.totalRevenue).toFixed(
                            2
                          )}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right">
                          <Badge
                            variant="outline"
                            className={`w-16 justify-center text-xs ${getOccupancyColor(parseFloat(reportData.summary.avgOccupancy))}`}
                          >
                            {parseFloat(
                              reportData.summary.avgOccupancy
                            ).toFixed(1)}
                            %
                          </Badge>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-employee detailed cards */}
          {reportData.employees.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Porownanie pracownikow
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reportData.employees.map((emp) => {
                  const occupancy = parseFloat(emp.occupancyPercentage);
                  return (
                    <Card key={emp.employeeId}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{
                              backgroundColor: emp.color || "#3b82f6",
                            }}
                          />
                          {emp.employeeName}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {/* Occupancy bar */}
                        <div className="mb-3">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-muted-foreground">
                              Obciazenie
                            </span>
                            <span
                              className={`font-bold ${occupancy >= 80 ? "text-green-700" : occupancy >= 50 ? "text-blue-700" : occupancy >= 25 ? "text-yellow-700" : "text-red-700"}`}
                            >
                              {occupancy.toFixed(1)}%
                            </span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-3 relative overflow-hidden">
                            <div
                              className={`h-3 rounded-full transition-all ${getBarColor(occupancy)}`}
                              style={{
                                width: `${Math.min(occupancy, 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            Dostepne:
                          </div>
                          <div className="text-right font-medium">
                            {parseFloat(emp.availableHours).toFixed(1)} h
                          </div>

                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Briefcase className="h-3 w-3" />
                            Wizyty:
                          </div>
                          <div className="text-right font-medium">
                            {parseFloat(emp.appointmentHours).toFixed(1)} h (
                            {emp.appointmentCount})
                          </div>

                          <div className="flex items-center gap-1 text-muted-foreground">
                            <DollarSign className="h-3 w-3" />
                            Przychod:
                          </div>
                          <div className="text-right font-medium text-green-700">
                            {parseFloat(emp.revenue).toFixed(2)} PLN
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
