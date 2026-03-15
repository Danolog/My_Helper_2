"use client";

import Link from "next/link";
import { Loader2, XCircle, TrendingUp, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StatsProps } from "./dashboard-types";

export function DashboardStatsRow({ stats, statsLoading, statsError }: StatsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* Last 30 Days Statistics (Feature #31) */}
      <Card data-testid="last-30-days-stats">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5 text-primary" />
            Statystyki - ostatnie 30 dni
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Ladowanie...</span>
            </div>
          ) : statsError ? (
            <p className="text-sm text-destructive py-4">{statsError}</p>
          ) : stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-primary">
                  {stats.last30Days.totalAppointments}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Wszystkich wizyt</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {stats.last30Days.completedAppointments}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Zrealizowanych</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {stats.last30Days.revenue.toFixed(0)} PLN
                </div>
                <div className="text-xs text-muted-foreground mt-1">Przychod</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold">
                  {stats.last30Days.avgPerDay}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Sr. wizyt/dzien</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {stats.last30Days.newClients}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Nowych klientow</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {stats.last30Days.cancelledAppointments}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Anulowanych</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Cancellation Statistics (Feature #30) */}
      <Card data-testid="cancellation-stats">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <XCircle className="h-5 w-5 text-red-500" />
            Statystyki anulacji - ten miesiac
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Ladowanie...</span>
            </div>
          ) : statsError ? (
            <p className="text-sm text-destructive py-4">{statsError}</p>
          ) : stats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold">
                    {stats.cancellationStats.totalThisMonth}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Wizyt ogolem</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {stats.cancellationStats.cancelledThisMonth}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Anulowanych</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {stats.cancellationStats.noShowThisMonth}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Nieobecnosci</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <div className={`text-2xl font-bold ${
                    stats.cancellationStats.cancellationRate > 10
                      ? "text-red-600 dark:text-red-400"
                      : stats.cancellationStats.cancellationRate > 5
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-green-600 dark:text-green-400"
                  }`}>
                    {stats.cancellationStats.cancellationRate}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">Wskaznik anulacji</div>
                </div>
              </div>
              <div className="text-center">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/reports/cancellations">
                    Szczegolowy raport
                    <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
