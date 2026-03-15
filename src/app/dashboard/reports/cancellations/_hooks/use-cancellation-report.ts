"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { useSalonId } from "@/hooks/use-salon-id";
import { generateReportPDF } from "@/lib/pdf-export";
import type { ReportData, ActiveTab } from "../_types";

export function useCancellationReport() {
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

  // Comparison period (previous 30 days by default when enabled)
  const [showComparison, setShowComparison] = useState(
    searchParams.get("compare") === "true",
  );
  const sixtyDaysAgo = new Date(today);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const [compareDateFrom, setCompareDateFrom] = useState(
    searchParams.get("compareDateFrom") ||
      sixtyDaysAgo.toISOString().split("T")[0],
  );
  const [compareDateTo, setCompareDateTo] = useState(
    searchParams.get("compareDateTo") ||
      thirtyDaysAgo.toISOString().split("T")[0],
  );

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>(
    searchParams.get("employeeIds")
      ? searchParams.get("employeeIds")!.split(",").filter(Boolean)
      : [],
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    (searchParams.get("tab") as ActiveTab) || "lostrevenue",
  );

  // Sync filter state to browser URL for shareable links
  // Uses window.history.replaceState to avoid triggering Next.js re-renders
  useEffect(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (selectedEmployeeIds.length > 0)
      params.set("employeeIds", selectedEmployeeIds.join(","));
    if (showComparison) {
      params.set("compare", "true");
      if (compareDateFrom) params.set("compareDateFrom", compareDateFrom);
      if (compareDateTo) params.set("compareDateTo", compareDateTo);
    }
    if (activeTab && activeTab !== "lostrevenue")
      params.set("tab", activeTab);
    const qs = params.toString();
    const newUrl = `${pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState(null, "", newUrl);
  }, [
    dateFrom,
    dateTo,
    selectedEmployeeIds,
    activeTab,
    showComparison,
    compareDateFrom,
    compareDateTo,
    pathname,
  ]);

  const fetchReport = useCallback(
    async (signal: AbortSignal | null = null) => {
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
        if (showComparison && compareDateFrom && compareDateTo) {
          params.append("compareDateFrom", compareDateFrom);
          params.append("compareDateTo", compareDateTo);
        }

        const res = await fetch(
          `/api/reports/cancellations?${params.toString()}`,
          { signal },
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
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          "Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      salonId,
      dateFrom,
      dateTo,
      selectedEmployeeIds,
      showComparison,
      compareDateFrom,
      compareDateTo,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchReport(controller.signal);
    return () => controller.abort();
  }, [fetchReport]);

  const handleExportCSV = async () => {
    if (!salonId) return;
    try {
      const params = new URLSearchParams({
        salonId: salonId!,
        format: "csv",
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (showComparison && compareDateFrom && compareDateTo) {
        params.append("compareDateFrom", compareDateFrom);
        params.append("compareDateTo", compareDateTo);
      }

      const res = await fetch(
        `/api/reports/cancellations?${params.toString()}`,
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
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Analiza anulacji",
        subtitle:
          "Utracony przychod z anulowanych wizyt z uwzglednieniem zastepstw",
        dateRange:
          dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          {
            label: "Laczna liczba wizyt",
            value: `${reportData.summary.totalAppointments}`,
          },
          {
            label: "Anulowane + nieobecnosci",
            value: `${reportData.summary.cancellationCount}`,
          },
          {
            label: "Wskaznik anulacji",
            value: `${reportData.summary.cancellationRate}%`,
          },
          {
            label: "Rzeczywisty utracony przychod",
            value: `${parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN`,
          },
        ],
        tables: [
          ...(reportData.byReason.length > 0
            ? [
                {
                  title: "Podzial wg powodu",
                  headers: ["Powod", "Liczba", "Udzial"],
                  rows: reportData.byReason.map((item) => [
                    item.reasonLabel,
                    `${item.count}`,
                    `${item.percentage}%`,
                  ]),
                },
              ]
            : []),
          ...(reportData.byEmployee.length > 0
            ? [
                {
                  title: "Anulacje wg pracownika",
                  headers: [
                    "Pracownik",
                    "Laczne wizyty",
                    "Anulowane",
                    "Nieobecnosci",
                    "Wskaznik",
                  ],
                  rows: reportData.byEmployee.map((emp) => [
                    emp.employeeName,
                    `${emp.total}`,
                    `${emp.cancelled}`,
                    `${emp.noShow}`,
                    `${emp.rate}%`,
                  ]),
                },
              ]
            : []),
          ...(reportData.byService.length > 0
            ? [
                {
                  title: "Anulacje wg uslugi",
                  headers: [
                    "Usluga",
                    "Laczne wizyty",
                    "Anulowane",
                    "Nieobecnosci",
                    "Wskaznik",
                    "Strata netto",
                  ],
                  rows: reportData.byService.map((svc) => [
                    svc.serviceName,
                    `${svc.total}`,
                    `${svc.cancelled}`,
                    `${svc.noShow}`,
                    `${svc.rate}%`,
                    `${parseFloat(svc.netLostRevenue).toFixed(2)} PLN`,
                  ]),
                },
              ]
            : []),
          ...(reportData.byDayOfWeek.length > 0
            ? [
                {
                  title: "Anulacje wg dnia tygodnia",
                  headers: [
                    "Dzien",
                    "Laczne wizyty",
                    "Anulowane",
                    "Wskaznik",
                  ],
                  rows: reportData.byDayOfWeek.map((day) => [
                    day.dayLabel,
                    `${day.total}`,
                    `${day.cancelled}`,
                    `${day.rate}%`,
                  ]),
                },
              ]
            : []),
          ...(reportData.trend.length > 0
            ? [
                {
                  title: "Trend dzienny",
                  headers: [
                    "Data",
                    "Laczne",
                    "Anulowane",
                    "Nieobecnosci",
                    "Wskaznik",
                    "Strata netto",
                  ],
                  rows: reportData.trend.map((point) => [
                    new Date(point.date + "T12:00:00").toLocaleDateString(
                      "pl-PL",
                      {
                        weekday: "short",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      },
                    ),
                    `${point.total}`,
                    `${point.cancelled}`,
                    `${point.noShow}`,
                    `${point.rate}%`,
                    `${parseFloat(point.netLostRevenue).toFixed(2)} PLN`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    `${reportData.summary.totalAppointments}`,
                    `${reportData.summary.cancelledCount}`,
                    `${reportData.summary.noShowCount}`,
                    `${reportData.summary.cancellationRate}%`,
                    `${parseFloat(reportData.summary.netLostRevenue).toFixed(2)} PLN`,
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-anulacji-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
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

    // Comparison filters
    showComparison,
    setShowComparison,
    compareDateFrom,
    setCompareDateFrom,
    compareDateTo,
    setCompareDateTo,

    // Employee filters
    selectedEmployeeIds,
    setSelectedEmployeeIds,

    // Tab state
    activeTab,
    setActiveTab,

    // Actions
    fetchReport,
    handleExportCSV,
    handleExportPDF,
  };
}
