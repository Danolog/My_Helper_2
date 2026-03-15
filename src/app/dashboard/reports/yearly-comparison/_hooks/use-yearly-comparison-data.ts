"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { generateReportPDF } from "@/lib/pdf-export";
import { METRIC_CONFIGS, getMetricValue } from "../_components/YearlyComparisonChart";
import type { ComparisonData } from "../_types";

export function useYearlyComparisonData() {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [comparisonData, setComparisonData] =
    useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [year1, setYear1] = useState(String(currentYear - 1));
  const [year2, setYear2] = useState(String(currentYear));

  const fetchComparison = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: salonId!,
        year1,
        year2,
      });

      const res = await fetch(
        `/api/reports/yearly-comparison?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Nie udalo sie pobrac porownania");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error("Nie udalo sie pobrac porownania. Sprobuj ponownie pozniej.");
      }
      setComparisonData(json.data as ComparisonData);
    } catch {
      const message = "Nie udalo sie zaladowac porownania. Sprobuj ponownie pozniej.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [salonId, year1, year2]);

  const handleExportPDF = () => {
    if (!comparisonData) return;
    try {
      const y1 = comparisonData.year1;
      const y2 = comparisonData.year2;

      generateReportPDF({
        title: "Porownanie roczne",
        subtitle: `${y1.label} vs ${y2.label}`,
        summaryCards: METRIC_CONFIGS.map((config) => {
          const y1Value = getMetricValue(y1.metrics, config.key);
          const y2Value = getMetricValue(y2.metrics, config.key);
          const change = comparisonData.changes[config.key];
          const changeStr = change ? ` (${change.direction === "down" ? "" : "+"}${change.percent}%)` : "";
          return {
            label: config.label,
            value: `${config.format(y1Value)} -> ${config.format(y2Value)}${changeStr}`,
          };
        }),
        tables: [
          {
            title: "Porownanie metryk rocznych",
            headers: ["Metryka", y1.label, y2.label, "Zmiana", "Zmiana %"],
            rows: METRIC_CONFIGS.map((config) => {
              const y1Value = getMetricValue(y1.metrics, config.key);
              const y2Value = getMetricValue(y2.metrics, config.key);
              const change = comparisonData.changes[config.key];
              return [
                config.label,
                config.format(y1Value),
                config.format(y2Value),
                change ? change.value : "-",
                change ? `${change.percent}%` : "-",
              ];
            }),
          },
          {
            title: "Najpopularniejsi",
            headers: ["Kategoria", y1.label, y2.label],
            rows: [
              [
                "Najpopularniejsza usluga",
                y1.metrics.topService ? `${y1.metrics.topService.name} (${y1.metrics.topService.count} wiz.)` : "Brak danych",
                y2.metrics.topService ? `${y2.metrics.topService.name} (${y2.metrics.topService.count} wiz.)` : "Brak danych",
              ],
              [
                "Najbardziej zapracowany pracownik",
                y1.metrics.topEmployee ? `${y1.metrics.topEmployee.name} (${y1.metrics.topEmployee.count} wiz.)` : "Brak danych",
                y2.metrics.topEmployee ? `${y2.metrics.topEmployee.name} (${y2.metrics.topEmployee.count} wiz.)` : "Brak danych",
              ],
            ],
          },
          ...(comparisonData.monthlyComparison.length > 0
            ? [
                {
                  title: "Porownanie miesiac po miesiacu",
                  headers: [
                    "Miesiac",
                    `Przychod ${y1.label}`,
                    `Przychod ${y2.label}`,
                    "Zmiana przychodu %",
                    `Wizyty ${y1.label}`,
                    `Wizyty ${y2.label}`,
                    "Zmiana wizyt %",
                  ],
                  rows: comparisonData.monthlyComparison.map((entry) => [
                    entry.monthLabel,
                    `${parseFloat(entry.year1Revenue).toFixed(2)} PLN`,
                    `${parseFloat(entry.year2Revenue).toFixed(2)} PLN`,
                    `${entry.revenueChange.percent}%`,
                    `${entry.year1Appointments}`,
                    `${entry.year2Appointments}`,
                    `${entry.appointmentsChange.percent}%`,
                  ]),
                },
              ]
            : []),
        ],
        filename: `porownanie-roczne-${year1}-vs-${year2}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  return {
    // Data
    comparisonData,
    loading,
    salonLoading,
    error,

    // Year filters
    year1,
    setYear1,
    year2,
    setYear2,

    // Actions
    fetchComparison,
    handleExportPDF,
  };
}
