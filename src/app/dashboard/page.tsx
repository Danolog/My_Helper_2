"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Lock, Calendar, Users, Scissors, CalendarPlus, Contact, CreditCard, Receipt, MessageSquare, Image, Star, Clock, Cake, Package, BarChart3, Percent, Ticket, Gift, DollarSign, Printer, FileText, Crown, Bot, Lightbulb, PenTool, Timer, AlertTriangle, Loader2, RefreshCw, ExternalLink, Sunrise, CalendarDays, ShieldAlert, Zap, Info, CalendarRange, TrendingUp, Megaphone, ChevronDown, ChevronUp, XCircle, UserCheck, UserX, ArrowRight, Building2 } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { useSession } from "@/lib/auth-client";
import { PLANS, TRIAL_DAYS } from "@/lib/constants";

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

function DailyRecommendations() {
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

function WeeklyRecommendations() {
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

// ────────────────────────────────────────────────────────────
// Dashboard Stats Types
// ────────────────────────────────────────────────────────────

interface UserSalon {
  id: string;
  name: string;
}

interface TodayAppointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  clientName: string;
  clientPhone: string | null;
  employeeId: string;
  employeeName: string;
  employeeColor: string | null;
  serviceName: string;
  servicePrice: number;
  serviceDuration: number;
}

interface EmployeeToday {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  role: string;
  isWorkingToday: boolean;
  workStart: string | null;
  workEnd: string | null;
  appointmentCount: number;
}

interface CancellationStats {
  totalThisMonth: number;
  cancelledThisMonth: number;
  noShowThisMonth: number;
  cancellationRate: number;
}

interface Last30DaysStats {
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  revenue: number;
  avgPerDay: number;
  newClients: number;
}

interface DashboardStats {
  todayAppointments: TodayAppointment[];
  employeesToday: EmployeeToday[];
  cancellationStats: CancellationStats;
  last30Days: Last30DaysStats;
}

// ────────────────────────────────────────────────────────────
// Helper: format time from ISO string
// ────────────────────────────────────────────────────────────

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// ────────────────────────────────────────────────────────────
// Status badge color mapping
// ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  confirmed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  completed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  no_show: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Zaplanowana",
  confirmed: "Potwierdzona",
  completed: "Zakonczona",
  cancelled: "Anulowana",
  no_show: "Nieobecnosc",
};

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const { isProPlan, isTrialing, trialDaysRemaining } = useSubscription();
  const [salon, setSalon] = useState<UserSalon | null>(null);
  const [noSalon, setNoSalon] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Fetch the user's salon, then dashboard stats
  useEffect(() => {
    async function fetchSalonAndStats() {
      try {
        setStatsLoading(true);
        setStatsError(null);

        // Step 1: Fetch the user's salon
        const salonRes = await fetch("/api/salons/mine");
        if (!salonRes.ok) {
          const err = await salonRes.json().catch(() => ({ error: "Blad serwera" }));
          throw new Error(err.error || "Nie udalo sie pobrac salonu");
        }
        const salonJson = await salonRes.json();

        if (!salonJson.salon) {
          // User has no salon yet
          setNoSalon(true);
          setStatsLoading(false);
          return;
        }

        setSalon({ id: salonJson.salon.id, name: salonJson.salon.name });

        // Step 2: Fetch dashboard stats using the salon ID
        const res = await fetch(
          `/api/dashboard/stats?salonId=${salonJson.salon.id}`
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Blad serwera" }));
          throw new Error(err.error || "Nie udalo sie pobrac statystyk");
        }
        const json = await res.json();
        if (json.success) {
          setStats(json.data);
        }
      } catch (e) {
        setStatsError(
          e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"
        );
      } finally {
        setStatsLoading(false);
      }
    }

    if (session) {
      fetchSalonAndStats();
    }
  }, [session]);

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-8">
            <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-2xl font-bold mb-2">Protected Page</h1>
            <p className="text-muted-foreground mb-6">
              You need to sign in to access the dashboard
            </p>
          </div>
          <UserProfile />
        </div>
      </div>
    );
  }

  // User has no salon yet -- show inline salon creation
  if (noSalon && !statsLoading) {
    return <CreateSalonPrompt session={session} onCreated={() => { setNoSalon(false); window.location.reload(); }} />;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>

      {/* Trial period banner */}
      {isTrialing && trialDaysRemaining !== null && (
        <div className={`flex items-center gap-3 p-4 rounded-lg border mb-6 ${
          trialDaysRemaining <= 3
            ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
            : "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
        }`}>
          {trialDaysRemaining <= 3 ? (
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          ) : (
            <Timer className="h-5 w-5 text-blue-600 shrink-0" />
          )}
          <div className="flex-1">
            <p className={`text-sm font-medium ${
              trialDaysRemaining <= 3
                ? "text-amber-800 dark:text-amber-200"
                : "text-blue-800 dark:text-blue-200"
            }`}>
              {trialDaysRemaining <= 3
                ? `Okres probny konczy sie za ${trialDaysRemaining} ${trialDaysRemaining === 1 ? "dzien" : "dni"}!`
                : `Okres probny - pozostalo ${trialDaysRemaining} ${trialDaysRemaining === 1 ? "dzien" : "dni"}`
              }
            </p>
            <p className={`text-xs mt-0.5 ${
              trialDaysRemaining <= 3
                ? "text-amber-600 dark:text-amber-300"
                : "text-blue-600 dark:text-blue-300"
            }`}>
              {trialDaysRemaining <= 3
                ? "Wykup subskrypcje, aby zachowac dostep do wszystkich funkcji."
                : `Korzystasz z pelnych funkcji w ramach ${TRIAL_DAYS}-dniowego okresu probnego.`
              }
            </p>
          </div>
          <Button asChild size="sm" variant={trialDaysRemaining <= 3 ? "default" : "outline"}>
            <Link href="/dashboard/subscription">
              <CreditCard className="h-3 w-3 mr-2" />
              {trialDaysRemaining <= 3 ? "Wykup teraz" : "Zarzadzaj"}
            </Link>
          </Button>
        </div>
      )}

      {/* Daily AI Recommendations - shown for Pro plan users (Feature #32) */}
      {isProPlan && <DailyRecommendations />}

      {/* Weekly AI Recommendations - shown for Pro plan users (Feature #32) */}
      {isProPlan && <WeeklyRecommendations />}

      {/* ─── Quick Actions (Feature #29) ──────────────────────── */}
      <Card className="mb-6" data-testid="quick-actions">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-primary" />
            Szybkie akcje
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/dashboard/calendar">
                <CalendarPlus className="h-4 w-4 mr-2" />
                Nowa wizyta
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/clients">
                <Contact className="h-4 w-4 mr-2" />
                Dodaj klienta
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/services">
                <Scissors className="h-4 w-4 mr-2" />
                Zarzadzaj uslugami
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/employees">
                <Users className="h-4 w-4 mr-2" />
                Pracownicy
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/revenue">
                <BarChart3 className="h-4 w-4 mr-2" />
                Raporty
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/products">
                <Package className="h-4 w-4 mr-2" />
                Magazyn
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Statistics Row: 30-day stats + Cancellation stats (Features #30, #31) ─── */}
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

      {/* ─── Today's Appointments (Feature #27) ──────────────── */}
      <Card className="mb-6" data-testid="today-appointments">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="h-5 w-5 text-primary" />
              Dzisiejsze wizyty
              {stats && (
                <Badge variant="secondary" className="text-xs">
                  {stats.todayAppointments.length}
                </Badge>
              )}
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/calendar">
                Otworz kalendarz
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Ladowanie wizyt...</span>
            </div>
          ) : statsError ? (
            <p className="text-sm text-destructive py-4">{statsError}</p>
          ) : stats && stats.todayAppointments.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Brak zaplanowanych wizyt na dzisiaj
              </p>
            </div>
          ) : stats ? (
            <div className="space-y-2">
              {stats.todayAppointments.map((appt) => (
                <div
                  key={appt.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                >
                  {/* Employee color indicator */}
                  <div
                    className="w-1 h-10 rounded-full shrink-0"
                    style={{ backgroundColor: appt.employeeColor || "#3b82f6" }}
                  />
                  {/* Time */}
                  <div className="shrink-0 text-center min-w-[60px]">
                    <div className="text-sm font-semibold">
                      {formatTime(appt.startTime)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {appt.serviceDuration} min
                    </div>
                  </div>
                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">
                        {appt.clientName}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 ${STATUS_STYLES[appt.status] || ""}`}
                      >
                        {STATUS_LABELS[appt.status] || appt.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {appt.serviceName} - {appt.employeeName}
                    </div>
                  </div>
                  {/* Price */}
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold">
                      {appt.servicePrice.toFixed(0)} PLN
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Employees Working Today (Feature #28) ───────────── */}
      <Card className="mb-6" data-testid="employees-today">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-primary" />
            Pracownicy dzisiaj
            {stats && (
              <Badge variant="secondary" className="text-xs">
                {stats.employeesToday.filter((e) => e.isWorkingToday).length} / {stats.employeesToday.length}
              </Badge>
            )}
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
          ) : stats && stats.employeesToday.length === 0 ? (
            <div className="text-center py-6">
              <Users className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Brak pracownikow w systemie
              </p>
            </div>
          ) : stats ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {stats.employeesToday.map((emp) => (
                <div
                  key={emp.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    emp.isWorkingToday
                      ? "bg-green-50/50 border-green-200 dark:bg-green-950/10 dark:border-green-800"
                      : "bg-muted/30 border-border opacity-60"
                  }`}
                >
                  {/* Color dot */}
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: emp.color || "#3b82f6" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {emp.firstName} {emp.lastName}
                    </div>
                    {emp.isWorkingToday ? (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <UserCheck className="h-3 w-3 text-green-600" />
                        {emp.workStart} - {emp.workEnd}
                        {emp.appointmentCount > 0 && (
                          <span className="ml-1">({emp.appointmentCount} wizyt)</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <UserX className="h-3 w-3" />
                        Wolne
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── Navigation Cards (existing) ─────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Kalendarz</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj wizytami i harmonogramem pracownikow
          </p>
          <Button asChild>
            <Link href="/dashboard/calendar">Otworz kalendarz</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Pracownicy</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj zespolem i harmonogramem pracy
          </p>
          <Button asChild>
            <Link href="/dashboard/employees">Zarzadzaj pracownikami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Scissors className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Uslugi</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj oferta uslug salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/services">Zarzadzaj uslugami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Contact className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Klienci</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj baza klientow salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/clients">Zarzadzaj klientami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CalendarPlus className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Rezerwacja</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarezerwuj wizyte - wybierz usluge i pracownika
          </p>
          <Button asChild>
            <Link href="/dashboard/booking">Zarezerwuj wizyte</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Asystent AI</h2>
            {!isProPlan && (
              <Badge variant="secondary" className="gap-1 ml-auto">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mb-4">
            Asystent glosowy, analiza biznesowa i chat AI
          </p>
          <Button asChild>
            <Link href="/dashboard/ai-assistant">Asystent AI</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Rekomendacje AI</h2>
            {!isProPlan && (
              <Badge variant="secondary" className="gap-1 ml-auto">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mb-4">
            Inteligentne rekomendacje oparte na danych salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/ai-recommendations">Rekomendacje AI</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <PenTool className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Generator tresci</h2>
            {!isProPlan && (
              <Badge variant="secondary" className="gap-1 ml-auto">
                <Crown className="h-3 w-3" />
                Pro
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mb-4">
            Tworzenie postow, opisow uslug i newsletterow z AI
          </p>
          <Button asChild>
            <Link href="/dashboard/content-generator">Generator tresci</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Historia platnosci</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Przegladaj wszystkie transakcje i platnosci salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/payments">Historia platnosci</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            <h2 className="text-xl font-semibold">Finanse - Prowizje</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Sledzenie prowizji pracownikow i zarzadzanie stawkami
          </p>
          <Button asChild>
            <Link href="/dashboard/finance">Prowizje pracownikow</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Dane salonu</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Nazwa, adres, telefon i typ dzialalnosci salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/salon">Edytuj dane salonu</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Platnosci</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Konfiguracja integracji Stripe i ustawienia platnosci
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/payments">Ustawienia platnosci</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Powiadomienia</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Historia wyslanych SMS, email i powiadomien push
          </p>
          <Button asChild>
            <Link href="/dashboard/notifications">Przegladaj powiadomienia</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Image className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Galeria</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Portfolio zdjec - przed i po zabiegach
          </p>
          <Button asChild>
            <Link href="/dashboard/gallery">Przegladaj galerie</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Opinie</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Moderacja opinii klientow - zatwierdzaj lub odrzucaj
          </p>
          <Button asChild>
            <Link href="/dashboard/reviews">Moderacja opinii</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Lista oczekujacych</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj lista klientow oczekujacych na wolne terminy
          </p>
          <Button asChild>
            <Link href="/dashboard/waiting-list">Lista oczekujacych</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Cake className="w-5 h-5 text-pink-500" />
            <h2 className="text-xl font-semibold">Prezenty urodzinowe</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Konfiguracja rabatow i prezentow urodzinowych dla klientow
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/notifications">Ustawienia urodzinowe</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Magazyn</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj produktami i stanem magazynowym
          </p>
          <Button asChild>
            <Link href="/dashboard/products">Magazyn produktow</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Raporty</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Raporty przychodow, zuzycia materialow i analityka salonu
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/dashboard/reports/revenue">Raport przychodow</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/materials">Raport materialow</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/services-popularity">Popularnosc uslug</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/employee-occupancy">Obciazenie pracownikow</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/promotions">Efektywnosc promocji</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/employee-popularity">Popularnosc pracownikow</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/cancellations">Analiza anulacji</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/service-profitability">Rentownosc uslug</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/materials-profitloss">Zysk/Strata materialow</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/monthly-comparison">Porownanie miesieczne</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/yearly-comparison">Porownanie roczne</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/reports/employee-payroll">Raport wynagrodzen</Link>
            </Button>
          </div>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Percent className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Promocje</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj promocjami i rabatami salonu
          </p>
          <Button asChild>
            <Link href="/dashboard/promotions">Zarzadzaj promocjami</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Ticket className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Kody promocyjne</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Generuj i zarzadzaj kodami rabatowymi
          </p>
          <Button asChild>
            <Link href="/dashboard/promo-codes">Kody promocyjne</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Program lojalnosciowy</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Konfiguracja systemu punktow i nagrod dla klientow
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/loyalty">Ustawienia programu</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Printer className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Drukarka fiskalna</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Konfiguracja integracji z drukarka fiskalna i kasa
          </p>
          <Button asChild>
            <Link href="/dashboard/settings/fiscal">Ustawienia fiskalne</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Faktury</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Historia wystawionych faktur i rachunkow
          </p>
          <Button asChild>
            <Link href="/dashboard/invoices">Historia faktur</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold">Subskrypcja</h2>
          </div>
          <p className="text-muted-foreground mb-4">
            Zarzadzaj planem subskrypcji i platnosciami
          </p>
          <Button asChild>
            <Link href="/dashboard/subscription">Zarzadzaj subskrypcja</Link>
          </Button>
        </div>

        <div className="p-6 border border-border rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Profile</h2>
          <p className="text-muted-foreground mb-4">
            Manage your account settings and preferences
          </p>
          <div className="space-y-2">
            <p>
              <strong>Name:</strong> {session.user.name}
            </p>
            <p>
              <strong>Email:</strong> {session.user.email}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Inline Salon Creation for logged-in users without a salon
// ────────────────────────────────────────────────────────────

function CreateSalonPrompt({
  session,
  onCreated,
}: {
  session: { user: { name?: string | null; email: string } };
  onCreated: () => void;
}) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const plans = [
    {
      slug: PLANS.basic.slug,
      name: PLANS.basic.name,
      price: PLANS.basic.priceLabel,
      features: [
        "Zarzadzanie wizytami",
        "Kalendarz pracownikow",
        "Baza klientow",
        "Raporty podstawowe",
      ],
    },
    {
      slug: PLANS.pro.slug,
      name: PLANS.pro.name,
      price: PLANS.pro.priceLabel,
      features: [
        "Wszystko z Basic",
        "Asystent AI",
        "Zaawansowane raporty",
        "Marketing i newsletter",
      ],
    },
  ];

  const handleCreate = async () => {
    if (!selectedPlan) return;
    setIsCreating(true);
    setError("");

    try {
      const res = await fetch("/api/register-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planSlug: selectedPlan,
          email: session.user.email,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onCreated();
      } else {
        setError(data.error || "Nie udalo sie utworzyc salonu");
      }
    } catch {
      setError("Wystapil blad polaczenia");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
      </div>
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <CardTitle>Utworz swoj salon</CardTitle>
            <p className="text-muted-foreground text-sm">
              Wybierz plan i rozpocznij {TRIAL_DAYS}-dniowy okres probny
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {plans.map((plan) => (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => setSelectedPlan(plan.slug)}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedPlan === plan.slug
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{plan.name}</span>
                    {plan.slug === "pro" && (
                      <Badge variant="secondary">
                        <Crown className="h-3 w-3 mr-1" />
                        AI
                      </Badge>
                    )}
                  </div>
                  <p className="text-lg font-bold mb-3">{plan.price}</p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <Zap className="h-3 w-3 text-primary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button
              className="w-full"
              disabled={!selectedPlan || isCreating}
              onClick={handleCreate}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Tworzenie salonu...
                </>
              ) : (
                <>
                  <Building2 className="h-4 w-4 mr-2" />
                  Utworz salon z {TRIAL_DAYS}-dniowym trialem
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
