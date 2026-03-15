"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Users, Package, AlertTriangle, Loader2, RefreshCw, ExternalLink, ShieldAlert, Zap, Info, CalendarRange, TrendingUp, Megaphone, ChevronDown, ChevronUp, DollarSign, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ────────────────────────────────────────────────────────────
// Weekly AI Recommendations Component (Pro plan only)
// ────────────────────────────────────────────────────────────

interface WeeklyRecommendation {
  id: string;
  type: "strategy" | "staffing" | "marketing" | "revenue" | "preparation" | "warning";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  dayOfWeek?: string;
  metric?: string;
  actionLabel?: string;
  actionHref?: string;
}

interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  totalAppointments: number;
  estimatedRevenue: number;
  busiestDay: string | null;
  busiestDayCount: number;
  quietestDay: string | null;
  quietestDayCount: number;
  employeesOnVacation: number;
  daysWithNoAppointments: number;
}

interface DayBreakdown {
  date: string;
  dayName: string;
  appointmentCount: number;
  revenue: number;
}

const WEEKLY_TYPE_ICONS: Record<string, React.ElementType> = {
  strategy: TrendingUp,
  staffing: Users,
  marketing: Megaphone,
  revenue: DollarSign,
  preparation: Package,
  warning: AlertTriangle,
};

const WEEKLY_TYPE_COLORS: Record<string, string> = {
  strategy: "text-indigo-600 dark:text-indigo-400",
  staffing: "text-purple-600 dark:text-purple-400",
  marketing: "text-pink-600 dark:text-pink-400",
  revenue: "text-emerald-600 dark:text-emerald-400",
  preparation: "text-amber-600 dark:text-amber-400",
  warning: "text-red-600 dark:text-red-400",
};

const WEEKLY_TYPE_BG: Record<string, string> = {
  strategy: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800",
  staffing: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800",
  marketing: "bg-pink-50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800",
  revenue: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800",
  preparation: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  warning: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
};

const PRIORITY_BADGE_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "Wysoki",
  medium: "Sredni",
  low: "Niski",
};

export function WeeklyRecommendations() {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [recommendations, setRecommendations] = useState<WeeklyRecommendation[]>([]);
  const [dayBreakdown, setDayBreakdown] = useState<DayBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchWeeklyRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/weekly-recommendations");
      if (!res.ok) {
        if (res.status === 403) {
          setError("not-pro");
          return;
        }
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac rekomendacji tygodniowych");
      }
      const json = await res.json();
      setSummary(json.summary || null);
      setRecommendations(json.recommendations || []);
      setDayBreakdown(json.dayBreakdown || []);
    } catch (e) {
      // Use functional updater to avoid stale closure over error state
      setError(prev => prev === "not-pro" ? prev : (e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeeklyRecommendations();
  }, [fetchWeeklyRecommendations]);

  if (error === "not-pro") return null;

  if (loading) {
    return (
      <Card className="mb-6 border-indigo-200 dark:border-indigo-800 bg-gradient-to-r from-indigo-50/50 to-transparent dark:from-indigo-950/20">
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400 mr-3" />
          <span className="text-sm text-muted-foreground">
            Przygotowuje plan na przyszly tydzien...
          </span>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mb-6">
        <CardContent className="py-6 text-center">
          <ShieldAlert className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchWeeklyRecommendations}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  const visibleRecommendations = expanded
    ? recommendations
    : recommendations.slice(0, 3);

  return (
    <Card className="mb-6 border-indigo-200 dark:border-indigo-800 overflow-hidden" data-testid="weekly-recommendations">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50/50 to-transparent dark:from-indigo-950/20">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarRange className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            Plan tygodnia AI
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Crown className="h-3 w-3" />
              Pro
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchWeeklyRecommendations}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Odswiez
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Week summary bar */}
        {summary && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              {summary.weekStart} - {summary.weekEnd}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold">{summary.totalAppointments}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Wizyt
                </div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold">{summary.estimatedRevenue.toFixed(0)} PLN</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Szac. przychod
                </div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold">
                  {summary.busiestDay || "-"}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {summary.busiestDay ? `Szczyt (${summary.busiestDayCount})` : "Szczyt"}
                </div>
              </div>
              <div className="text-center p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold">
                  {summary.daysWithNoAppointments}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Dni bez wizyt
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Day-by-day mini chart */}
        {dayBreakdown.length > 0 && (
          <div className="flex gap-1.5 items-end h-16">
            {dayBreakdown.map((day) => {
              const maxCount = Math.max(...dayBreakdown.map((d) => d.appointmentCount), 1);
              const heightPct = Math.max((day.appointmentCount / maxCount) * 100, 8);
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] font-medium text-muted-foreground">
                    {day.appointmentCount > 0 ? day.appointmentCount : ""}
                  </span>
                  <div
                    className={`w-full rounded-t transition-all ${
                      day.appointmentCount === 0
                        ? "bg-muted/40"
                        : "bg-indigo-400 dark:bg-indigo-500"
                    }`}
                    style={{ height: `${heightPct}%`, minHeight: "4px" }}
                  />
                  <span className="text-[9px] text-muted-foreground truncate">
                    {day.dayName.slice(0, 3)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Recommendations list */}
        {recommendations.length === 0 ? (
          <div className="text-center py-4">
            <Zap className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Przyszly tydzien wyglada dobrze! Brak dodatkowych rekomendacji strategicznych.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleRecommendations.map((rec) => {
              const Icon = WEEKLY_TYPE_ICONS[rec.type] || Info;
              const iconColor = WEEKLY_TYPE_COLORS[rec.type] || "text-gray-500";
              const bgColor = WEEKLY_TYPE_BG[rec.type] || "";
              const priorityBadge = PRIORITY_BADGE_STYLES[rec.priority] || "";
              const priorityLabel = PRIORITY_LABELS[rec.priority] || "";

              return (
                <div
                  key={rec.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${bgColor} transition-colors`}
                >
                  <div className={`mt-0.5 shrink-0 ${iconColor}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <h4 className="font-medium text-sm">{rec.title}</h4>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 ${priorityBadge}`}
                      >
                        {priorityLabel}
                      </Badge>
                      {rec.metric && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {rec.metric}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {rec.description}
                    </p>
                    {rec.actionLabel && rec.actionHref && (
                      <Link
                        href={rec.actionHref}
                        className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        {rec.actionLabel}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Expand/collapse toggle */}
            {recommendations.length > 3 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5 mr-1" />
                    Pokaz mniej
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5 mr-1" />
                    Pokaz wszystkie ({recommendations.length})
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
