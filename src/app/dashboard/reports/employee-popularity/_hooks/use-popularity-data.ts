"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { generateReportPDF } from "@/lib/pdf-export";
import type { ReportData } from "../_types";

interface UsePopularityDataReturn {
  reportData: ReportData | null;
  loading: boolean;
  salonLoading: boolean;
  error: string | null;
  dateFrom: string;
  setDateFrom: (date: string) => void;
  dateTo: string;
  setDateTo: (date: string) => void;
  fetchReport: () => Promise<void>;
  handleExportCSV: () => Promise<void>;
  handleExportPDF: () => void;
  maxBookings: number;
}

export function usePopularityData(): UsePopularityDataReturn {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 90 days
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [dateFrom, setDateFrom] = useState<string>(
    ninetyDaysAgo.toISOString().split("T")[0] ?? ""
  );
  const [dateTo, setDateTo] = useState<string>(
    today.toISOString().split("T")[0] ?? ""
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
    } catch {
      setError("Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, salonId]);

  useEffect(() => {
    fetchReport();
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
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

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
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  // Calculate max bookings for bar chart scaling
  const maxBookings = reportData?.employees
    ? Math.max(...reportData.employees.map((e) => e.totalBookings), 1)
    : 1;

  return {
    reportData,
    loading,
    salonLoading,
    error,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    fetchReport,
    handleExportCSV,
    handleExportPDF,
    maxBookings,
  };
}
