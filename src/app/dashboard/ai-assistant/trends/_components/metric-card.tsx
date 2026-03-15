"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendBadge } from "./trend-indicators";
import type { TrendDirection } from "../_types";

interface MetricCardProps {
  title: string;
  icon: React.ReactNode;
  current: number | string;
  previous: number | string;
  trend: TrendDirection;
  changePercent: number;
  suffix?: string;
  prefix?: string;
  weeklyLabel?: string;
  weeklyCurrent?: number | string;
  weeklyPrevious?: number | string;
  weeklyTrend?: TrendDirection;
  weeklyChangePercent?: number;
}

/**
 * A card displaying a single KPI metric with month-over-month and
 * optional week-over-week comparison badges.
 */
export function MetricCard({
  title,
  icon,
  current,
  previous,
  trend,
  changePercent,
  suffix,
  prefix,
  weeklyLabel,
  weeklyCurrent,
  weeklyPrevious,
  weeklyTrend,
  weeklyChangePercent,
}: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold">
            {prefix}
            {current}
            {suffix}
          </div>
          <TrendBadge trend={trend} percent={changePercent} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Poprz. miesiac: {prefix}
          {previous}
          {suffix}
        </p>
        {weeklyLabel && weeklyCurrent !== undefined && weeklyTrend && (
          <div className="mt-3 pt-3 border-t">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{weeklyLabel}</span>
              <TrendBadge trend={weeklyTrend} percent={weeklyChangePercent ?? 0} />
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-sm font-medium">
                {prefix}
                {weeklyCurrent}
                {suffix}
              </span>
              <span className="text-xs text-muted-foreground">
                vs {prefix}
                {weeklyPrevious}
                {suffix}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
