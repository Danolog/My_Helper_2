"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { useSalonId } from "@/hooks/use-salon-id";
import { toast } from "sonner";
import { generateReportPDF } from "@/lib/pdf-export";
import type { ReportData, ActiveTab } from "../_types";

export function useMaterialsData() {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(
    thirtyDaysAgo.toISOString().split("T")[0],
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("summary");

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
        `/api/reports/materials-profitloss?${params.toString()}`,
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
        `/api/reports/materials-profitloss?${params.toString()}`,
      );
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-zysk-strata-materialow-${dateFrom || "all"}-${dateTo || "all"}.csv`;
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
        title: "Zysk/Strata materialow",
        subtitle:
          "Koszt materialow vs przychod z uslug - analiza rentownosci produktow",
        dateRange:
          dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          {
            label: "Koszt materialow",
            value: `${parseFloat(reportData.totals.totalMaterialCost).toFixed(2)} PLN`,
          },
          {
            label: "Przychod z uslug",
            value: `${parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN`,
          },
          {
            label: "Zysk / Strata",
            value: `${parseFloat(reportData.totals.totalProfitLoss).toFixed(2)} PLN`,
          },
          {
            label: "Marza zysku",
            value: `${reportData.totals.profitMargin}%`,
          },
        ],
        tables: [
          ...(reportData.summary.length > 0
            ? [
                {
                  title: "Rentownosc wg produktu",
                  headers: [
                    "Produkt",
                    "Zuzycie",
                    "Koszt mat.",
                    "Przychod",
                    "Zysk/Strata",
                    "Marza",
                  ],
                  rows: reportData.summary.map((item) => [
                    item.productName,
                    `${item.totalQuantityUsed.toFixed(2)} ${item.unit || "szt."}`,
                    `${parseFloat(item.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(item.attributedRevenue).toFixed(2)} PLN`,
                    `${parseFloat(item.profitLoss) >= 0 ? "+" : ""}${parseFloat(item.profitLoss).toFixed(2)} PLN`,
                    `${item.profitMargin}%`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    "",
                    `${parseFloat(reportData.totals.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalProfitLoss) >= 0 ? "+" : ""}${parseFloat(reportData.totals.totalProfitLoss).toFixed(2)} PLN`,
                    `${reportData.totals.profitMargin}%`,
                  ],
                },
              ]
            : []),
          ...(reportData.details.length > 0
            ? [
                {
                  title: "Szczegolowe zuzycie z zyskiem/strata",
                  headers: [
                    "Data",
                    "Produkt",
                    "Usluga",
                    "Pracownik",
                    "Zuzycie",
                    "Koszt",
                    "Przychod",
                    "Zysk/Strata",
                  ],
                  rows: reportData.details.map((record) => [
                    new Date(record.date).toLocaleDateString("pl-PL", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }),
                    record.product.name,
                    record.service || "-",
                    record.employee || "-",
                    `${parseFloat(record.quantityUsed).toFixed(2)} ${record.product.unit || "szt."}`,
                    `${parseFloat(record.materialCost).toFixed(2)} PLN`,
                    `${parseFloat(record.attributedRevenue).toFixed(2)} PLN`,
                    `${parseFloat(record.profitLoss) >= 0 ? "+" : ""}${parseFloat(record.profitLoss).toFixed(2)} PLN`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    "",
                    "",
                    "",
                    "",
                    `${parseFloat(reportData.totals.totalMaterialCost).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalRevenue).toFixed(2)} PLN`,
                    `${parseFloat(reportData.totals.totalProfitLoss) >= 0 ? "+" : ""}${parseFloat(reportData.totals.totalProfitLoss).toFixed(2)} PLN`,
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-zysk-strata-materialow-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
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
