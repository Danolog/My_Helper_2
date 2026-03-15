"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { generateReportPDF } from "@/lib/pdf-export";
import type { ReportData } from "../_types";

export function useProfitabilityData() {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "details">("summary");

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);

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
        `/api/reports/service-profitability?${params.toString()}`
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
        `/api/reports/service-profitability?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-rentownosci-uslug-${dateFrom || "all"}-${dateTo || "all"}.csv`;
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
        title: "Rentownosc uslug",
        subtitle: "Marze zysku na uslugach - przychod minus koszty",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Przychod", value: `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN` },
          { label: "Koszty materialow", value: `${parseFloat(reportData.summary.totalMaterialCost).toFixed(2)} PLN` },
          { label: "Koszty pracy", value: `${parseFloat(reportData.summary.totalLaborCost).toFixed(2)} PLN` },
          { label: "Zysk", value: `${parseFloat(reportData.summary.totalProfit).toFixed(2)} PLN` },
        ],
        tables: [
          ...(reportData.byService.length > 0
            ? [
                {
                  title: "Rentownosc wg uslugi",
                  headers: ["Usluga", "Wizyty", "Przychod", "Koszty mat.", "Koszty pracy", "Zysk", "Marza"],
                  rows: reportData.byService.map((svc) => [
                    svc.serviceName,
                    `${svc.appointmentCount}`,
                    `${parseFloat(svc.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(svc.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(svc.totalLaborCost).toFixed(2)} PLN`,
                    `${parseFloat(svc.totalProfit).toFixed(2)} PLN`,
                    `${svc.profitMargin}%`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    `${reportData.summary.totalAppointments}`,
                    `${parseFloat(reportData.summary.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.totalLaborCost).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.totalProfit).toFixed(2)} PLN`,
                    `${reportData.summary.profitMargin}%`,
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-rentownosci-uslug-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
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

    // Tab state
    activeTab,
    setActiveTab,

    // Actions
    fetchReport,
    handleExportCSV,
    handleExportPDF,
  };
}
