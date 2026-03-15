"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CalendarDays, Users, Package, Lightbulb, AlertTriangle, Loader2, RefreshCw, ExternalLink, Sunrise, ShieldAlert, Zap, Info, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ────────────────────────────────────────────────────────────
// Daily AI Recommendations Component (Pro plan only)
// ────────────────────────────────────────────────────────────

interface DailyRecommendation {
  id: string;
  type: "schedule" | "client" | "preparation" | "opportunity" | "warning";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  timeSlot?: string;
  actionLabel?: string;
  actionHref?: string;
}

interface TomorrowSummary {
  date: string;
  dayOfWeek: string;
  totalAppointments: number;
  totalRevenue: number;
  employeesWorking: number;
  employeesOff: number;
  firstAppointment: string | null;
  lastAppointment: string | null;
  freeSlots: number;
}

const REC_TYPE_ICONS: Record<string, React.ElementType> = {
  schedule: CalendarDays,
  client: Users,
  preparation: Package,
  opportunity: Lightbulb,
  warning: AlertTriangle,
};

const REC_TYPE_COLORS: Record<string, string> = {
  schedule: "text-blue-600 dark:text-blue-400",
  client: "text-purple-600 dark:text-purple-400",
  preparation: "text-amber-600 dark:text-amber-400",
  opportunity: "text-green-600 dark:text-green-400",
  warning: "text-red-600 dark:text-red-400",
};

const REC_TYPE_BG: Record<string, string> = {
  schedule: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
  client: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800",
  preparation: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  opportunity: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
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

export function DailyRecommendations() {
  const [summary, setSummary] = useState<TomorrowSummary | null>(null);
  const [recommendations, setRecommendations] = useState<DailyRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/daily-recommendations");
      if (!res.ok) {
        if (res.status === 403) {
          // Not Pro plan - silently hide
          setError("not-pro");
          return;
        }
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac rekomendacji");
      }
      const json = await res.json();
      setSummary(json.summary || null);
      setRecommendations(json.recommendations || []);
    } catch (e) {
      // Use functional updater to avoid stale closure over error state
      setError(prev => prev === "not-pro" ? prev : (e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // If not pro plan or error, don't render
  if (error === "not-pro") return null;

  if (loading) {
    return (
      <Card className="mb-6 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary mr-3" />
          <span className="text-sm text-muted-foreground">
            Przygotowuje rekomendacje na jutro...
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
          <Button variant="outline" size="sm" onClick={fetchRecommendations}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-primary/20 overflow-hidden" data-testid="daily-recommendations">
      <CardHeader className="pb-3 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sunrise className="h-5 w-5 text-primary" />
            Rekomendacje AI na jutro
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Crown className="h-3 w-3" />
              Pro
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRecommendations}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Odswiez
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Tomorrow summary bar */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <div className="text-lg font-bold">{summary.totalAppointments}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Wizyt
              </div>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <div className="text-lg font-bold">{summary.totalRevenue.toFixed(0)} PLN</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Szac. przychod
              </div>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <div className="text-lg font-bold">{summary.employeesWorking}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Pracownikow
              </div>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <div className="text-lg font-bold">
                {summary.firstAppointment || "-"}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Pierwsza wizyta
              </div>
            </div>
          </div>
        )}

        {/* Date label */}
        {summary && (
          <p className="text-xs text-muted-foreground">
            {summary.dayOfWeek}, {summary.date}
          </p>
        )}

        {/* Recommendations list */}
        {recommendations.length === 0 ? (
          <div className="text-center py-4">
            <Zap className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Wszystko wyglada dobrze na jutro! Brak dodatkowych rekomendacji.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recommendations.map((rec) => {
              const Icon = REC_TYPE_ICONS[rec.type] || Info;
              const iconColor = REC_TYPE_COLORS[rec.type] || "text-gray-500";
              const bgColor = REC_TYPE_BG[rec.type] || "";
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
                      {rec.timeSlot && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {rec.timeSlot}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
