"use client";

import {
  DollarSign,
  CalendarDays,
  Users,
  Star,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "./metric-card";
import { TrendBadge } from "./trend-indicators";
import type { TrendsData } from "../_types";

interface OverviewTabProps {
  data: TrendsData;
}

/**
 * The "Przeglad" tab — displays key metric cards, cancellation rate,
 * returning clients, and a monthly revenue breakdown bar chart.
 */
export function OverviewTab({ data }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      {/* Key metrics grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Przychody"
          icon={<DollarSign className="h-4 w-4" />}
          current={data.revenue.currentMonth.toFixed(2)}
          previous={data.revenue.previousMonth.toFixed(2)}
          trend={data.revenue.trend}
          changePercent={data.revenue.changePercent}
          suffix=" PLN"
          weeklyLabel="Ten tydzien"
          weeklyCurrent={data.revenue.weeklyCurrentRevenue.toFixed(2)}
          weeklyPrevious={data.revenue.weeklyPreviousRevenue.toFixed(2)}
          weeklyTrend={data.revenue.weeklyTrend}
          weeklyChangePercent={data.revenue.weeklyChangePercent}
        />
        <MetricCard
          title="Wizyty"
          icon={<CalendarDays className="h-4 w-4" />}
          current={data.appointments.currentMonth}
          previous={data.appointments.previousMonth}
          trend={data.appointments.trend}
          changePercent={data.appointments.changePercent}
          weeklyLabel="Ten tydzien"
          weeklyCurrent={data.appointments.weeklyCurrentCount}
          weeklyPrevious={data.appointments.weeklyPreviousCount}
          weeklyTrend={data.appointments.weeklyTrend}
          weeklyChangePercent={data.appointments.weeklyChangePercent}
        />
        <MetricCard
          title="Nowi klienci"
          icon={<Users className="h-4 w-4" />}
          current={data.clients.newClientsThisMonth}
          previous={data.clients.newClientsPrevMonth}
          trend={data.clients.trend}
          changePercent={data.clients.changePercent}
        />
        <MetricCard
          title="Srednia ocena"
          icon={<Star className="h-4 w-4" />}
          current={data.ratings.currentAvg.toFixed(1)}
          previous={data.ratings.previousAvg.toFixed(1)}
          trend={data.ratings.trend}
          changePercent={
            data.ratings.previousAvg > 0
              ? Math.round(((data.ratings.currentAvg - data.ratings.previousAvg) / data.ratings.previousAvg) * 100 * 10) / 10
              : 0
          }
          suffix="/5"
        />
      </div>

      {/* Cancellation rate + returning clients */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wskaznik anulacji</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{data.cancellations.currentRate}%</div>
              <TrendBadge
                trend={data.cancellations.trend === "up" ? "down" : data.cancellations.trend === "down" ? "up" : "stable"}
                percent={
                  data.cancellations.previousRate > 0
                    ? Math.round(
                        ((data.cancellations.currentRate - data.cancellations.previousRate) /
                          data.cancellations.previousRate) *
                          100 *
                          10
                      ) / 10
                    : 0
                }
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Poprz. miesiac: {data.cancellations.previousRate}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.cancellations.trend === "down"
                ? "Spadek anulacji - pozytywny trend"
                : data.cancellations.trend === "up"
                ? "Wzrost anulacji - wymaga uwagi"
                : "Stabilny wskaznik anulacji"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Powracajacy klienci</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{data.clients.returningClientsThisMonth}</div>
              {data.clients.returningClientsPrevMonth > 0 && (
                <TrendBadge
                  trend={
                    data.clients.returningClientsThisMonth > data.clients.returningClientsPrevMonth
                      ? "up"
                      : data.clients.returningClientsThisMonth < data.clients.returningClientsPrevMonth
                      ? "down"
                      : "stable"
                  }
                  percent={
                    data.clients.returningClientsPrevMonth > 0
                      ? Math.round(
                          ((data.clients.returningClientsThisMonth - data.clients.returningClientsPrevMonth) /
                            data.clients.returningClientsPrevMonth) *
                            100 *
                            10
                        ) / 10
                      : 0
                  }
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Poprz. miesiac: {data.clients.returningClientsPrevMonth} | Ogolem: {data.clients.totalClients}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue monthly breakdown */}
      {data.revenue.monthlyBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Przychod miesiecznie (ostatnie 3 miesiace)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.revenue.monthlyBreakdown.map((mb, idx) => {
                const maxRevenue = Math.max(...data.revenue.monthlyBreakdown.map((m) => m.revenue), 1);
                const pct = (mb.revenue / maxRevenue) * 100;
                return (
                  <div key={idx}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{mb.month}</span>
                      <span>{mb.revenue.toFixed(2)} PLN</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2.5">
                      <div
                        className="bg-primary rounded-full h-2.5 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
