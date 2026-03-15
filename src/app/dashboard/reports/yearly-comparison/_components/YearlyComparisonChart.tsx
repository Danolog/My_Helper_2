"use client";

import {
  DollarSign,
  TrendingUp,
  XCircle,
  Percent,
  Users,
  UserPlus,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  Scissors,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ComparisonData, MetricData } from "../_types";

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

export const METRIC_CONFIGS: MetricConfig[] = [
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

export function getMetricValue(metrics: MetricData, key: string): number | string {
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

interface YearlyComparisonChartProps {
  comparisonData: ComparisonData;
}

export function YearlyComparisonChart({ comparisonData }: YearlyComparisonChartProps) {
  return (
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
    </>
  );
}
