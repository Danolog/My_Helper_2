"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Users,
  Scissors,
  UserPlus,
  XCircle,
  Percent,
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { generateReportPDF } from "@/lib/pdf-export";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface MetricData {
  totalRevenue: string;
  totalAppointments: number;
  avgRevenuePerAppointment: string;
  totalCancellations: number;
  cancellationRate: string;
  uniqueClients: number;
  newClients: number;
  topService: { name: string; count: number } | null;
  topEmployee: { name: string; count: number } | null;
}

interface ChangeData {
  value: string;
  percent: string;
  direction: "up" | "down" | "neutral";
}

interface ComparisonData {
  month1: { label: string; period: string; metrics: MetricData };
  month2: { label: string; period: string; metrics: MetricData };
  changes: Record<string, ChangeData>;
}

/**
 * Returns the YYYY-MM string for the current month.
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Returns the YYYY-MM string for the previous month.
 */
function getPreviousMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Metrics where an increase is considered negative (bad). */
const INVERSE_METRICS = new Set(["totalCancellations", "cancellationRate"]);

/**
 * Determines the color class for a change indicator based on the direction
 * and whether the metric treats "up" as good or bad.
 */
function getChangeColor(
  direction: "up" | "down" | "neutral",
  metricKey: string
): string {
  if (direction === "neutral") return "text-gray-500";
  const isInverse = INVERSE_METRICS.has(metricKey);
  if (direction === "up") {
    return isInverse ? "text-red-600" : "text-green-600";
  }
  // direction === "down"
  return isInverse ? "text-green-600" : "text-red-600";
}

/**
 * Returns the appropriate arrow icon component for a given direction.
 */
function getChangeIcon(direction: "up" | "down" | "neutral") {
  if (direction === "up") return ArrowUpRight;
  if (direction === "down") return ArrowDownRight;
  return Minus;
}

/** Configuration for each comparison metric card. */
interface MetricConfig {
  key: string;
  label: string;
  icon: typeof DollarSign;
  iconColor: string;
  format: (value: number | string) => string;
}

const METRIC_CONFIGS: MetricConfig[] = [
  {
    key: "totalRevenue",
    label: "Przychod",
    icon: DollarSign,
    iconColor: "text-green-600",
    format: (v) => `${parseFloat(String(v)).toFixed(2)} PLN`,
  },
  {
    key: "totalAppointments",
    label: "Wizyty",
    icon: TrendingUp,
    iconColor: "text-blue-600",
    format: (v) => String(v),
  },
  {
    key: "avgRevenuePerAppointment",
    label: "Srednia / wizyte",
    icon: BarChart3,
    iconColor: "text-purple-600",
    format: (v) => `${parseFloat(String(v)).toFixed(2)} PLN`,
  },
  {
    key: "totalCancellations",
    label: "Anulacje",
    icon: XCircle,
    iconColor: "text-red-600",
    format: (v) => String(v),
  },
  {
    key: "cancellationRate",
    label: "Wskaznik anulacji",
    icon: Percent,
    iconColor: "text-orange-600",
    format: (v) => `${parseFloat(String(v)).toFixed(1)}%`,
  },
  {
    key: "uniqueClients",
    label: "Unikalnych klientow",
    icon: Users,
    iconColor: "text-indigo-600",
    format: (v) => String(v),
  },
  {
    key: "newClients",
    label: "Nowi klienci",
    icon: UserPlus,
    iconColor: "text-teal-600",
    format: (v) => String(v),
  },
];

/**
 * Maps a metric key from METRIC_CONFIGS to the corresponding field
 * in MetricData so we can read the raw value for display.
 */
function getMetricValue(metrics: MetricData, key: string): number | string {
  switch (key) {
    case "totalRevenue":
      return metrics.totalRevenue;
    case "totalAppointments":
      return metrics.totalAppointments;
    case "avgRevenuePerAppointment":
      return metrics.avgRevenuePerAppointment;
    case "totalCancellations":
      return metrics.totalCancellations;
    case "cancellationRate":
      return metrics.cancellationRate;
    case "uniqueClients":
      return metrics.uniqueClients;
    case "newClients":
      return metrics.newClients;
    default:
      return 0;
  }
}

export default function MonthlyComparisonPage() {
  // Session is consumed to ensure auth context; prefixed to satisfy noUnusedLocals
  const { data: _session } = useSession();
  const [comparisonData, setComparisonData] =
    useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [month1, setMonth1] = useState(getPreviousMonth);
  const [month2, setMonth2] = useState(getCurrentMonth);

  const fetchComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        month1,
        month2,
      });

      const res = await fetch(
        `/api/reports/monthly-comparison?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Failed to fetch comparison");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(
          (json.error as string) || "Failed to fetch comparison"
        );
      }
      setComparisonData(json.data as ComparisonData);
    } catch (err) {
      console.error("[Monthly Comparison] Error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to load comparison";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [month1, month2]);

  const handleExportPDF = () => {
    if (!comparisonData) return;
    try {
      const m1 = comparisonData.month1;
      const m2 = comparisonData.month2;

      generateReportPDF({
        title: "Porownanie miesieczne",
        subtitle: `${m1.label} vs ${m2.label}`,
        summaryCards: METRIC_CONFIGS.map((config) => {
          const m1Value = getMetricValue(m1.metrics, config.key);
          const m2Value = getMetricValue(m2.metrics, config.key);
          const change = comparisonData.changes[config.key];
          const changeStr = change ? ` (${change.direction === "down" ? "" : "+"}${change.percent}%)` : "";
          return {
            label: config.label,
            value: `${config.format(m1Value)} -> ${config.format(m2Value)}${changeStr}`,
          };
        }),
        tables: [
          {
            title: "Porownanie metryk",
            headers: ["Metryka", m1.label, m2.label, "Zmiana", "Zmiana %"],
            rows: METRIC_CONFIGS.map((config) => {
              const m1Value = getMetricValue(m1.metrics, config.key);
              const m2Value = getMetricValue(m2.metrics, config.key);
              const change = comparisonData.changes[config.key];
              return [
                config.label,
                config.format(m1Value),
                config.format(m2Value),
                change ? change.value : "-",
                change ? `${change.percent}%` : "-",
              ];
            }),
          },
          {
            title: "Najpopularniejsi",
            headers: ["Kategoria", m1.label, m2.label],
            rows: [
              [
                "Najpopularniejsza usluga",
                m1.metrics.topService ? `${m1.metrics.topService.name} (${m1.metrics.topService.count} wiz.)` : "Brak danych",
                m2.metrics.topService ? `${m2.metrics.topService.name} (${m2.metrics.topService.count} wiz.)` : "Brak danych",
              ],
              [
                "Najbardziej zapracowany pracownik",
                m1.metrics.topEmployee ? `${m1.metrics.topEmployee.name} (${m1.metrics.topEmployee.count} wiz.)` : "Brak danych",
                m2.metrics.topEmployee ? `${m2.metrics.topEmployee.name} (${m2.metrics.topEmployee.count} wiz.)` : "Brak danych",
              ],
            ],
          },
        ],
        filename: `porownanie-miesieczne-${month1}-vs-${month2}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch (err) {
      console.error("[Monthly Comparison] PDF export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  // Suppress unused-import warnings for icons used only in the config array
  // by referencing them in the module scope via METRIC_CONFIGS above.
  // The following are used inside JSX or helper functions:
  // ArrowLeft, Calendar, Search, RefreshCw, BarChart3, Scissors,
  // ArrowUpRight, ArrowDownRight, Minus, TrendingDown, Badge, Input, toast

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
            <BarChart3 className="h-6 w-6 text-purple-600" />
            Porownanie miesieczne
          </h1>
          <p className="text-muted-foreground text-sm">
            Porownaj metryki salonu miesiac do miesiaca
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportPDF}
          disabled={!comparisonData}
        >
          <FileText className="h-4 w-4 mr-2" />
          Eksport PDF
        </Button>
      </div>

      {/* Month selectors */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Miesiac 1
              </label>
              <Input
                type="month"
                value={month1}
                onChange={(e) => setMonth1(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Miesiac 2
              </label>
              <Input
                type="month"
                value={month2}
                onChange={(e) => setMonth2(e.target.value)}
              />
            </div>
            <Button onClick={fetchComparison} disabled={loading}>
              <Search className="h-4 w-4 mr-2" />
              {loading ? "Ladowanie..." : "Generuj porownanie"}
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
            Generowanie porownania...
          </span>
        </div>
      )}

      {/* Comparison content */}
      {comparisonData && !loading && (
        <>
          {/* Summary comparison cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {METRIC_CONFIGS.map((config) => {
              const change = comparisonData.changes[config.key];
              const m1Value = getMetricValue(
                comparisonData.month1.metrics,
                config.key
              );
              const m2Value = getMetricValue(
                comparisonData.month2.metrics,
                config.key
              );
              const IconComponent = config.icon;

              // Determine change indicator styling
              const direction = change?.direction ?? "neutral";
              const colorClass = getChangeColor(direction, config.key);
              const ChangeIcon = getChangeIcon(direction);

              return (
                <Card key={config.key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                      <IconComponent
                        className={`h-3.5 w-3.5 ${config.iconColor}`}
                      />
                      {config.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Month values side by side */}
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">
                          {comparisonData.month1.label}
                        </p>
                        <p className="text-lg font-bold">
                          {config.format(m1Value)}
                        </p>
                      </div>
                      <TrendingDown className="h-4 w-4 text-muted-foreground/30 shrink-0 mx-1" />
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">
                          {comparisonData.month2.label}
                        </p>
                        <p className="text-lg font-bold">
                          {config.format(m2Value)}
                        </p>
                      </div>
                    </div>

                    {/* Change indicator */}
                    {change ? (
                      <div
                        className={`flex items-center justify-center gap-1 text-sm ${colorClass}`}
                      >
                        <ChangeIcon className="h-4 w-4" />
                        <span className="font-medium">
                          {change.percent}%
                        </span>
                        <span className="text-muted-foreground text-xs">
                          ({change.value})
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1 text-sm text-gray-500">
                        <Minus className="h-4 w-4" />
                        <span>Brak danych</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Top performers section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Top service */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-purple-600" />
                  Najpopularniejsza usluga
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {comparisonData.month1.label}
                    </p>
                    {comparisonData.month1.metrics.topService ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.month1.metrics.topService.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.month1.metrics.topService.count} wiz.
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        Brak danych
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {comparisonData.month2.label}
                    </p>
                    {comparisonData.month2.metrics.topService ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.month2.metrics.topService.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.month2.metrics.topService.count} wiz.
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        Brak danych
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Top employee */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  Najbardziej zapracowany pracownik
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {comparisonData.month1.label}
                    </p>
                    {comparisonData.month1.metrics.topEmployee ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.month1.metrics.topEmployee.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.month1.metrics.topEmployee.count} wiz.
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        Brak danych
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {comparisonData.month2.label}
                    </p>
                    {comparisonData.month2.metrics.topEmployee ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.month2.metrics.topEmployee.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.month2.metrics.topEmployee.count} wiz.
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        Brak danych
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Empty state - when both months have zero appointments */}
          {comparisonData.month1.metrics.totalAppointments === 0 &&
            comparisonData.month2.metrics.totalAppointments === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-lg font-medium">
                      Brak danych do porownania
                    </p>
                    <p className="text-sm mt-1">
                      Nie znaleziono wizyt w wybranych miesiacach. Zmien zakres
                      dat lub sprawdz czy istnieja ukonczone wizyty.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
        </>
      )}
    </div>
  );
}
