"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useSalonId } from "@/hooks/use-salon-id";
import { generateReportPDF } from "@/lib/pdf-export";
import type { ReportData, RevenueActiveTab } from "../_types";

export function useRevenueData() {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
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
    searchParams.get("dateFrom") || thirtyDaysAgo.toISOString().split("T")[0],
  );
  const [dateTo, setDateTo] = useState(
    searchParams.get("dateTo") || today.toISOString().split("T")[0],
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(
    searchParams.get("employeeIds")
      ? searchParams.get("employeeIds")!.split(",").filter(Boolean)
      : [],
  );
  const [activeTab, setActiveTab] = useState<RevenueActiveTab>(
    (searchParams.get("tab") as RevenueActiveTab) || "service",
  );

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

      const res = await fetch(`/api/reports/revenue?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Nie udalo sie pobrac raportu");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error("Nie udalo sie pobrac raportu. Sprobuj ponownie pozniej.");
      }
      setReportData(json.data);
    } catch {
      setError("Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  }, [salonId, dateFrom, dateTo, selectedEmployeeIds]);

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
          : "Raport wyeksportowany do CSV",
      );
    } catch {
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
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
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

    // Tab state
    activeTab,
    setActiveTab,

    // Actions
    fetchReport,
    handleExport,
    handleExportPDF,
  };
}
