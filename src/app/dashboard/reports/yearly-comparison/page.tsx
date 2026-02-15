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
  monthlyBreakdown: MonthEntry[];
}

interface MonthEntry {
  month: number;
  monthLabel: string;
  revenue: string;
  appointments: number;
  cancellations: number;
}

interface ChangeData {
  value: string;
  percent: string;
  direction: "up" | "down" | "neutral";
}

interface MonthlyComparisonEntry {
  month: number;
  monthLabel: string;
  year1Revenue: string;
  year2Revenue: string;
  revenueChange: ChangeData;
  year1Appointments: number;
  year2Appointments: number;
  appointmentsChange: ChangeData;
}

interface ComparisonData {
  year1: { label: string; year: number; metrics: MetricData };
  year2: { label: string; year: number; metrics: MetricData };
  changes: Record<string, ChangeData>;
  monthlyComparison: MonthlyComparisonEntry[];
}

/** Metrics where an increase is considered negative (bad). */
const INVERSE_METRICS = new Set(["totalCancellations", "cancellationRate"]);

function getChangeColor(
  direction: "up" | "down" | "neutral",
  metricKey: string
): string {
  if (direction === "neutral") return "text-gray-500";
  const isInverse = INVERSE_METRICS.has(metricKey);
  if (direction === "up") {
    return isInverse ? "text-red-600" : "text-green-600";
  }
  return isInverse ? "text-green-600" : "text-red-600";
}

function getChangeIcon(direction: "up" | "down" | "neutral") {
  if (direction === "up") return ArrowUpRight;
  if (direction === "down") return ArrowDownRight;
  return Minus;
}

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
    label: "Przychod roczny",
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

export default function YearlyComparisonPage() {
  const { data: _session } = useSession();
  const [comparisonData, setComparisonData] =
    useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [year1, setYear1] = useState(String(currentYear - 1));
  const [year2, setYear2] = useState(String(currentYear));

  const fetchComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        year1,
        year2,
      });

      const res = await fetch(
        `/api/reports/yearly-comparison?${params.toString()}`
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
      console.error("[Yearly Comparison] Error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to load comparison";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [year1, year2]);

  // Suppress unused-import warnings
  void TrendingDown;
  void Calendar;
  void Badge;
  void Scissors;

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
            Porownanie roczne
          </h1>
          <p className="text-muted-foreground text-sm">
            Porownaj metryki salonu rok do roku
          </p>
        </div>
      </div>

      {/* Year selectors */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Rok 1
              </label>
              <Input
                type="number"
                min="2000"
                max="2099"
                value={year1}
                onChange={(e) => setYear1(e.target.value)}
                placeholder="np. 2025"
              />
            </div>
            <div className="flex-1 min-w-[150px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Rok 2
              </label>
              <Input
                type="number"
                min="2000"
                max="2099"
                value={year2}
                onChange={(e) => setYear2(e.target.value)}
                placeholder="np. 2026"
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
            Generowanie porownania rocznego...
          </span>
        </div>
      )}

      {/* Comparison content */}
      {comparisonData && !loading && (
        <>
          {/* Annual totals comparison cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {METRIC_CONFIGS.map((config) => {
              const change = comparisonData.changes[config.key];
              const y1Value = getMetricValue(
                comparisonData.year1.metrics,
                config.key
              );
              const y2Value = getMetricValue(
                comparisonData.year2.metrics,
                config.key
              );
              const IconComponent = config.icon;

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
                    {/* Year values side by side */}
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">
                          {comparisonData.year1.label}
                        </p>
                        <p className="text-lg font-bold">
                          {config.format(y1Value)}
                        </p>
                      </div>
                      <span className="text-muted-foreground/30 shrink-0 mx-1 text-lg font-bold">vs</span>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-0.5">
                          {comparisonData.year2.label}
                        </p>
                        <p className="text-lg font-bold">
                          {config.format(y2Value)}
                        </p>
                      </div>
                    </div>

                    {/* Growth percentage */}
                    {change ? (
                      <div
                        className={`flex items-center justify-center gap-1 text-sm ${colorClass}`}
                      >
                        <ChangeIcon className="h-4 w-4" />
                        <span className="font-medium">
                          {change.percent}%
                        </span>
                        <span className="text-muted-foreground text-xs">
                          ({change.direction === "down" ? "" : "+"}{change.value})
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
                      {comparisonData.year1.label}
                    </p>
                    {comparisonData.year1.metrics.topService ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.year1.metrics.topService.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.year1.metrics.topService.count} wiz.
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
                      {comparisonData.year2.label}
                    </p>
                    {comparisonData.year2.metrics.topService ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.year2.metrics.topService.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.year2.metrics.topService.count} wiz.
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
                      {comparisonData.year1.label}
                    </p>
                    {comparisonData.year1.metrics.topEmployee ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.year1.metrics.topEmployee.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.year1.metrics.topEmployee.count} wiz.
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
                      {comparisonData.year2.label}
                    </p>
                    {comparisonData.year2.metrics.topEmployee ? (
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {comparisonData.year2.metrics.topEmployee.name}
                        </span>
                        <Badge variant="outline">
                          {comparisonData.year2.metrics.topEmployee.count} wiz.
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

          {/* Monthly breakdown comparison table */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Porownanie miesiac po miesiacu
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">Miesiac</th>
                      <th className="text-right py-2 px-3 font-medium">
                        Przychod {comparisonData.year1.label}
                      </th>
                      <th className="text-right py-2 px-3 font-medium">
                        Przychod {comparisonData.year2.label}
                      </th>
                      <th className="text-right py-2 px-3 font-medium">Zmiana %</th>
                      <th className="text-right py-2 px-3 font-medium">
                        Wizyty {comparisonData.year1.label}
                      </th>
                      <th className="text-right py-2 px-3 font-medium">
                        Wizyty {comparisonData.year2.label}
                      </th>
                      <th className="text-right py-2 px-3 font-medium">Zmiana %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonData.monthlyComparison.map((entry) => {
                      const revColor = getChangeColor(entry.revenueChange.direction, "revenue");
                      const apptColor = getChangeColor(entry.appointmentsChange.direction, "appointments");
                      const RevIcon = getChangeIcon(entry.revenueChange.direction);
                      const ApptIcon = getChangeIcon(entry.appointmentsChange.direction);

                      return (
                        <tr key={entry.month} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-2 px-3 font-medium">{entry.monthLabel}</td>
                          <td className="py-2 px-3 text-right">
                            {parseFloat(entry.year1Revenue).toFixed(2)} PLN
                          </td>
                          <td className="py-2 px-3 text-right">
                            {parseFloat(entry.year2Revenue).toFixed(2)} PLN
                          </td>
                          <td className={`py-2 px-3 text-right ${revColor}`}>
                            <span className="inline-flex items-center gap-0.5">
                              <RevIcon className="h-3 w-3" />
                              {entry.revenueChange.percent}%
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            {entry.year1Appointments}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {entry.year2Appointments}
                          </td>
                          <td className={`py-2 px-3 text-right ${apptColor}`}>
                            <span className="inline-flex items-center gap-0.5">
                              <ApptIcon className="h-3 w-3" />
                              {entry.appointmentsChange.percent}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Empty state */}
          {comparisonData.year1.metrics.totalAppointments === 0 &&
            comparisonData.year2.metrics.totalAppointments === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-lg font-medium">
                      Brak danych do porownania
                    </p>
                    <p className="text-sm mt-1">
                      Nie znaleziono wizyt w wybranych latach. Zmien zakres
                      lat lub sprawdz czy istnieja ukonczone wizyty.
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
