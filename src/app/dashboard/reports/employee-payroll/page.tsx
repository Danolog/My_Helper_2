"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Users,
  Clock,
  DollarSign,
  Wallet,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  ChevronDown,
  ChevronUp,
  Banknote,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { EmployeeFilter } from "@/components/reports/employee-filter";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { generateReportPDF } from "@/lib/pdf-export";
import { useSalonId } from "@/hooks/use-salon-id";

interface ServiceBreakdown {
  serviceId: string;
  serviceName: string;
  count: number;
  revenue: string;
  commission: string;
}

interface EmployeePayrollData {
  employeeId: string;
  employeeName: string;
  completedAppointments: number;
  hoursWorked: string;
  hoursWorkedMinutes: number;
  totalRevenue: string;
  totalCommission: string;
  paidCommission: string;
  unpaidCommission: string;
  avgCommissionRate: string;
  services: ServiceBreakdown[];
}

interface ReportData {
  summary: {
    totalCompletedAppointments: number;
    totalHoursWorked: string;
    totalHoursWorkedMinutes: number;
    totalRevenue: string;
    totalCommission: string;
    paidCommission: string;
    unpaidCommission: string;
  };
  byEmployee: EmployeePayrollData[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
    employeeIds: string[] | null;
  };
}

export default function EmployeePayrollReportPage() {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);

  const fetchReport = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: salonId!,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedEmployeeIds.length > 0) {
        params.append("employeeIds", selectedEmployeeIds.join(","));
      }

      const res = await fetch(
        `/api/reports/employee-payroll?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch report");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Failed to fetch report");
      }
      setReportData(json.data);
    } catch {
      setError("Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedEmployeeIds, salonId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExport = async (format: "csv" | "xlsx") => {
    if (!salonId) return;
    try {
      const params = new URLSearchParams({
        salonId: salonId!,
        format,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedEmployeeIds.length > 0) {
        params.append("employeeIds", selectedEmployeeIds.join(","));
      }

      const res = await fetch(
        `/api/reports/employee-payroll?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = format === "xlsx" ? "xlsx" : "csv";
      a.download = `raport-wynagrodzen-${dateFrom || "all"}-${dateTo || "all"}.${ext}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(
        format === "xlsx"
          ? "Raport wyeksportowany do Excel"
          : "Raport wyeksportowany do CSV"
      );
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Raport wynagrodzen pracownikow",
        subtitle: "Podsumowanie prowizji i godzin pracy",
        dateRange:
          dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          {
            label: "Calkowita prowizja",
            value: `${parseFloat(reportData.summary.totalCommission).toFixed(2)} PLN`,
          },
          {
            label: "Do wyplaty",
            value: `${parseFloat(reportData.summary.unpaidCommission).toFixed(2)} PLN`,
          },
          {
            label: "Wyplacona",
            value: `${parseFloat(reportData.summary.paidCommission).toFixed(2)} PLN`,
          },
          {
            label: "Liczba wizyt",
            value: `${reportData.summary.totalCompletedAppointments}`,
          },
        ],
        tables: [
          ...(reportData.byEmployee.length > 0
            ? [
                {
                  title: "Wynagrodzenia wg pracownika",
                  headers: [
                    "Pracownik",
                    "Wizyty",
                    "Czas pracy",
                    "Przychod",
                    "Prowizja",
                    "Do wyplaty",
                    "Stawka",
                  ],
                  rows: reportData.byEmployee.map((emp) => [
                    emp.employeeName,
                    `${emp.completedAppointments}`,
                    emp.hoursWorked,
                    `${parseFloat(emp.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(emp.totalCommission).toFixed(2)} PLN`,
                    `${parseFloat(emp.unpaidCommission).toFixed(2)} PLN`,
                    `${parseFloat(emp.avgCommissionRate).toFixed(1)}%`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    `${reportData.summary.totalCompletedAppointments}`,
                    reportData.summary.totalHoursWorked,
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.totalCommission).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.unpaidCommission).toFixed(2)} PLN`,
                    "",
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-wynagrodzen-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  const toggleEmployeeExpand = (employeeId: string) => {
    setExpandedEmployee(
      expandedEmployee === employeeId ? null : employeeId
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
            <Wallet className="h-6 w-6 text-emerald-600" />
            Raport wynagrodzen
          </h1>
          <p className="text-muted-foreground text-sm">
            Podsumowanie prowizji, godzin pracy i wynagrodzen pracownikow
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={
              !reportData ||
              reportData.summary.totalCompletedAppointments === 0
            }
          >
            <FileText className="h-4 w-4 mr-2" />
            Eksport PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport("xlsx")}
            disabled={
              !reportData ||
              reportData.summary.totalCompletedAppointments === 0
            }
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Eksport Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport("csv")}
            disabled={
              !reportData ||
              reportData.summary.totalCompletedAppointments === 0
            }
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
              Raport pokazuje dane tylko dla wybranych pracownikow. Wyczysc
              filtr aby zobaczyc dane dla wszystkich.
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
      {(salonLoading || loading) && (
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
                  Calkowita prowizja
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Banknote className="h-5 w-5 text-emerald-600" />
                  {parseFloat(reportData.summary.totalCommission).toFixed(2)}{" "}
                  PLN
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Do wyplaty
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <AlertCircle className="h-5 w-5 text-orange-600" />
                  {parseFloat(reportData.summary.unpaidCommission).toFixed(2)}{" "}
                  PLN
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Wyplacona prowizja
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.summary.paidCommission).toFixed(2)}{" "}
                  PLN
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Czas pracy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Clock className="h-5 w-5 text-blue-600" />
                  {reportData.summary.totalHoursWorked}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {reportData.summary.totalCompletedAppointments} wizyt
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Additional summary row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Calkowity przychod
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold flex items-center gap-1">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Przychod wygenerowany przez pracownikow
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Liczba pracownikow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-bold flex items-center gap-1">
                  <Users className="h-5 w-5 text-purple-600" />
                  {reportData.byEmployee.length}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Pracownicy z ukonczonym wizytami w okresie
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Employee payroll table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Wynagrodzenia wg pracownika
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.byEmployee.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Brak danych w wybranym okresie</p>
                  <p className="text-sm mt-1">
                    Zmien zakres dat lub sprawdz czy istnieja ukonczone wizyty
                    z prowizjami
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
                          Wizyty
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Czas pracy
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Przychod
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Prowizja
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Wyplacona
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Do wyplaty
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Stawka
                        </th>
                        <th className="py-3 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.byEmployee.map((emp) => (
                        <React.Fragment key={emp.employeeId}>
                          <tr
                            className="border-b hover:bg-muted/50 cursor-pointer"
                            onClick={() =>
                              toggleEmployeeExpand(emp.employeeId)
                            }
                          >
                            <td className="py-3 px-2 font-medium">
                              {emp.employeeName}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {emp.completedAppointments}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {emp.hoursWorked}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(emp.totalRevenue).toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right font-medium text-emerald-700">
                              {parseFloat(emp.totalCommission).toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right text-green-600">
                              {parseFloat(emp.paidCommission).toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(emp.unpaidCommission) > 0 ? (
                                <Badge variant="outline" className="text-orange-600 border-orange-300">
                                  {parseFloat(emp.unpaidCommission).toFixed(2)}{" "}
                                  PLN
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">
                                  0.00 PLN
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(emp.avgCommissionRate).toFixed(1)}%
                            </td>
                            <td className="py-3 px-2">
                              {emp.services.length > 0 && (
                                expandedEmployee === emp.employeeId ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )
                              )}
                            </td>
                          </tr>
                          {/* Service breakdown (expanded) */}
                          {expandedEmployee === emp.employeeId &&
                            emp.services.length > 0 && (
                              <tr>
                                <td colSpan={9} className="p-0">
                                  <div className="bg-muted/30 px-6 py-3 border-b">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">
                                      Uslugi wykonane przez{" "}
                                      {emp.employeeName}:
                                    </p>
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b border-muted">
                                          <th className="text-left py-1 px-2 font-medium">
                                            Usluga
                                          </th>
                                          <th className="text-right py-1 px-2 font-medium">
                                            Liczba
                                          </th>
                                          <th className="text-right py-1 px-2 font-medium">
                                            Przychod
                                          </th>
                                          <th className="text-right py-1 px-2 font-medium">
                                            Prowizja
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {emp.services.map((svc) => (
                                          <tr
                                            key={svc.serviceId}
                                            className="border-b border-muted/50"
                                          >
                                            <td className="py-1 px-2">
                                              {svc.serviceName}
                                            </td>
                                            <td className="py-1 px-2 text-right">
                                              {svc.count}
                                            </td>
                                            <td className="py-1 px-2 text-right">
                                              {parseFloat(
                                                svc.revenue
                                              ).toFixed(2)}{" "}
                                              PLN
                                            </td>
                                            <td className="py-1 px-2 text-right text-emerald-700">
                                              {parseFloat(
                                                svc.commission
                                              ).toFixed(2)}{" "}
                                              PLN
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                        </React.Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="py-3 px-2">RAZEM</td>
                        <td className="py-3 px-2 text-right">
                          {reportData.summary.totalCompletedAppointments}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {reportData.summary.totalHoursWorked}
                        </td>
                        <td className="py-3 px-2 text-right">
                          {parseFloat(
                            reportData.summary.totalRevenue
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right text-emerald-700">
                          {parseFloat(
                            reportData.summary.totalCommission
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right text-green-600">
                          {parseFloat(
                            reportData.summary.paidCommission
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right text-orange-600">
                          {parseFloat(
                            reportData.summary.unpaidCommission
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right"></td>
                        <td className="py-3 px-2"></td>
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
