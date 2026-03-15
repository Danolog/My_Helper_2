"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useSalonId } from "@/hooks/use-salon-id";
import { generateReportPDF } from "@/lib/pdf-export";
import type { ReportData } from "../_types";

export function usePayrollData() {
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

  return {
    // Data
    reportData,
    loading,
    salonLoading,
    error,

    // Date filters
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,

    // Employee filters
    selectedEmployeeIds,
    setSelectedEmployeeIds,

    // Expanded state
    expandedEmployee,
    toggleEmployeeExpand,

    // Actions
    fetchReport,
    handleExport,
    handleExportPDF,
  };
}
