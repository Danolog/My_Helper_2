"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  DollarSign,
  CalendarDays,
  Users,
  Star,
  XCircle,
  Briefcase,
  Loader2,
  Send,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { getUserFriendlyMessage } from "@/lib/error-messages";
import { mutationFetch } from "@/lib/api-client";

// Types for trends API response
type TrendDirection = "up" | "down" | "stable";

type InsightType = "positive" | "negative" | "info";

interface Insight {
  type: InsightType;
  message: string;
}

interface RevenueTrends {
  currentMonth: number;
  previousMonth: number;
  changePercent: number;
  trend: TrendDirection;
  weeklyCurrentRevenue: number;
  weeklyPreviousRevenue: number;
  weeklyChangePercent: number;
  weeklyTrend: TrendDirection;
  monthlyBreakdown: { month: string; revenue: number }[];
}

interface AppointmentTrends {
  currentMonth: number;
  previousMonth: number;
  changePercent: number;
  trend: TrendDirection;
  weeklyCurrentCount: number;
  weeklyPreviousCount: number;
  weeklyChangePercent: number;
  weeklyTrend: TrendDirection;
}

interface ClientTrends {
  newClientsThisMonth: number;
  newClientsPrevMonth: number;
  changePercent: number;
  trend: TrendDirection;
  totalClients: number;
  returningClientsThisMonth: number;
  returningClientsPrevMonth: number;
}

interface ServiceTrend {
  serviceName: string;
  currentCount: number;
  previousCount: number;
  changePercent: number;
  trend: TrendDirection;
}

interface EmployeeTrend {
  employeeName: string;
  currentRevenue: number;
  previousRevenue: number;
  changePercent: number;
  trend: TrendDirection;
}

interface CancellationTrends {
  currentRate: number;
  previousRate: number;
  trend: TrendDirection;
}

interface RatingTrends {
  currentAvg: number;
  previousAvg: number;
  currentCount: number;
  previousCount: number;
  trend: TrendDirection;
}

interface Period {
  currentMonth: string;
  previousMonth: string;
  currentWeek: string;
  previousWeek: string;
}

interface TrendsData {
  period: Period;
  revenue: RevenueTrends;
  appointments: AppointmentTrends;
  clients: ClientTrends;
  servicePopularity: ServiceTrend[];
  employeePerformance: EmployeeTrend[];
  cancellations: CancellationTrends;
  ratings: RatingTrends;
  insights: Insight[];
}

// Chat message type
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

function TrendIcon({ trend, size = 16 }: { trend: TrendDirection; size?: number }) {
  if (trend === "up") return <TrendingUp className="text-green-600" style={{ width: size, height: size }} />;
  if (trend === "down") return <TrendingDown className="text-red-500" style={{ width: size, height: size }} />;
  return <Minus className="text-yellow-500" style={{ width: size, height: size }} />;
}

function TrendBadge({ trend, percent }: { trend: TrendDirection; percent: number }) {
  const colors =
    trend === "up"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : trend === "down"
      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";

  const icon =
    trend === "up" ? (
      <ArrowUpRight className="h-3 w-3" />
    ) : trend === "down" ? (
      <ArrowDownRight className="h-3 w-3" />
    ) : (
      <Minus className="h-3 w-3" />
    );

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
      {icon}
      {trend === "stable" ? "Stabilny" : `${percent > 0 ? "+" : ""}${percent}%`}
    </span>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const colors =
    insight.type === "positive"
      ? "border-l-green-500 bg-green-50 dark:bg-green-900/10"
      : insight.type === "negative"
      ? "border-l-red-500 bg-red-50 dark:bg-red-900/10"
      : "border-l-blue-500 bg-blue-50 dark:bg-blue-900/10";

  const icon =
    insight.type === "positive" ? (
      <TrendingUp className="h-4 w-4 text-green-600" />
    ) : insight.type === "negative" ? (
      <TrendingDown className="h-4 w-4 text-red-500" />
    ) : (
      <Sparkles className="h-4 w-4 text-blue-500" />
    );

  return (
    <div className={`border-l-4 rounded-r-lg p-3 ${colors}`}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <p className="text-sm">{insight.message}</p>
      </div>
    </div>
  );
}

function MetricCard({
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
}: {
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
}) {
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

function TrendsContent() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchTrends = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/trends");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch trends");
      }
      const json = await res.json();
      setData(json.data);
    } catch (e) {
      setError("Nie udalo sie zaladowac danych. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrends();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const askAboutTrends = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      // Build context with current trends data
      const trendsContext = data
        ? `\nAKTUALNE TRENDY BIZNESOWE:\n` +
          `Okres: ${data.period.currentMonth} vs ${data.period.previousMonth}\n` +
          `Przychod: ${data.revenue.currentMonth} PLN (${data.revenue.trend === "up" ? "wzrost" : data.revenue.trend === "down" ? "spadek" : "stabilny"} ${data.revenue.changePercent}%)\n` +
          `Wizyty: ${data.appointments.currentMonth} (${data.appointments.trend === "up" ? "wzrost" : data.appointments.trend === "down" ? "spadek" : "stabilny"} ${data.appointments.changePercent}%)\n` +
          `Nowi klienci: ${data.clients.newClientsThisMonth} (${data.clients.trend === "up" ? "wzrost" : data.clients.trend === "down" ? "spadek" : "stabilny"} ${data.clients.changePercent}%)\n` +
          `Klienci ogolem: ${data.clients.totalClients}, powracajacy: ${data.clients.returningClientsThisMonth}\n` +
          `Wskaznik anulacji: ${data.cancellations.currentRate}% (poprzednio: ${data.cancellations.previousRate}%)\n` +
          `Srednia ocena: ${data.ratings.currentAvg}/5 (poprzednio: ${data.ratings.previousAvg}/5)\n` +
          `\nPopularnosc uslug:\n${data.servicePopularity.map((s) => `  - ${s.serviceName}: ${s.currentCount} wizyt (${s.trend === "up" ? "↑" : s.trend === "down" ? "↓" : "→"} ${s.changePercent}%)`).join("\n")}\n` +
          `\nWyniki pracownikow:\n${data.employeePerformance.map((e) => `  - ${e.employeeName}: ${e.currentRevenue} PLN (${e.trend === "up" ? "↑" : e.trend === "down" ? "↓" : "→"} ${e.changePercent}%)`).join("\n")}\n` +
          `\nWnioski AI:\n${data.insights.map((i) => `  [${i.type}] ${i.message}`).join("\n")}`
        : "";

      const systemMessage = {
        role: "system" as const,
        parts: [
          {
            type: "text",
            text:
              `Jestes ekspertem od analizy trendow biznesowych salonu kosmetycznego. Odpowiadaj TYLKO po polsku. ` +
              `Bazuj na dostarczonych danych trendow. Uzywaj konkretnych liczb i porownuj okresy. ` +
              `Identyfikuj trendy wzrostowe i spadkowe. Dawaj praktyczne rekomendacje.` +
              trendsContext,
          },
        ],
      };

      const userMessage = {
        role: "user" as const,
        parts: [{ type: "text", text }],
      };

      const res = await mutationFetch("/api/ai/business/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [systemMessage, userMessage],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Blad komunikacji z AI");
      }

      // Read streaming response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";
      const assistantId = crypto.randomUUID();

      // Add empty assistant message
      setChatMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", text: "", timestamp: new Date() },
      ]);

      // Buffer for partial lines across chunks
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // UI Message Stream Protocol: data: {"type":"text","text":"..."}
          if (trimmed.startsWith("data: ")) {
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "text" && typeof parsed.text === "string") {
                fullText += parsed.text;
              } else if (parsed.type === "error" && parsed.errorText) {
                throw new Error(parsed.errorText);
              }
            } catch (parseErr) {
              if (
                parseErr instanceof Error &&
                !parseErr.message.includes("Unexpected") &&
                !parseErr.message.includes("JSON")
              ) {
                throw parseErr;
              }
            }
          }
          // Also support legacy Data Stream Protocol: 0:"text content"
          else if (trimmed.startsWith("0:")) {
            try {
              const textContent = JSON.parse(trimmed.slice(2));
              if (typeof textContent === "string") {
                fullText += textContent;
              }
            } catch {
              // Not valid JSON, skip
            }
          }
        }

        setChatMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? { ...msg, text: fullText } : msg))
        );
      }
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: getUserFriendlyMessage(e, "Wystapil blad podczas komunikacji z asystentem AI. Sprobuj ponownie."),
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/ai-assistant">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              Analiza trendow
            </h1>
          </div>
        </div>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Analizowanie danych...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/ai-assistant">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              Analiza trendow
            </h1>
          </div>
        </div>
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={fetchTrends}>Sprobuj ponownie</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/ai-assistant">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-primary" />
              Analiza trendow
            </h1>
            <p className="text-muted-foreground text-sm">
              Porownanie: {data.period.currentMonth} vs {data.period.previousMonth}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTrends} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Odswiez
        </Button>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Przeglad</TabsTrigger>
          <TabsTrigger value="details">Szczegoly</TabsTrigger>
          <TabsTrigger value="insights">Wnioski AI</TabsTrigger>
          <TabsTrigger value="ask">Zapytaj AI</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
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
                    ? "✅ Spadek anulacji - pozytywny trend"
                    : data.cancellations.trend === "up"
                    ? "⚠️ Wzrost anulacji - wymaga uwagi"
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
        </TabsContent>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-6">
          {/* Service Popularity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Popularnosc uslug
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.servicePopularity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak danych o uslugach w tym okresie.</p>
              ) : (
                <div className="space-y-3">
                  {data.servicePopularity.map((svc, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <TrendIcon trend={svc.trend} />
                        <div>
                          <p className="text-sm font-medium">{svc.serviceName}</p>
                          <p className="text-xs text-muted-foreground">
                            {svc.currentCount} wizyt (poprz.: {svc.previousCount})
                          </p>
                        </div>
                      </div>
                      <TrendBadge trend={svc.trend} percent={svc.changePercent} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Employee Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-5 w-5" />
                Wyniki pracownikow (przychod)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.employeePerformance.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak danych o pracownikach w tym okresie.</p>
              ) : (
                <div className="space-y-3">
                  {data.employeePerformance.map((emp, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <TrendIcon trend={emp.trend} />
                        <div>
                          <p className="text-sm font-medium">{emp.employeeName}</p>
                          <p className="text-xs text-muted-foreground">
                            {emp.currentRevenue.toFixed(2)} PLN (poprz.: {emp.previousRevenue.toFixed(2)} PLN)
                          </p>
                        </div>
                      </div>
                      <TrendBadge trend={emp.trend} percent={emp.changePercent} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Weekly comparison summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Porownanie tygodniowe</CardTitle>
              <p className="text-xs text-muted-foreground">
                {data.period.currentWeek} vs {data.period.previousWeek}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Przychod</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{data.revenue.weeklyCurrentRevenue.toFixed(2)} PLN</span>
                      <TrendBadge trend={data.revenue.weeklyTrend} percent={data.revenue.weeklyChangePercent} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Wizyty</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{data.appointments.weeklyCurrentCount}</span>
                      <TrendBadge trend={data.appointments.weeklyTrend} percent={data.appointments.weeklyChangePercent} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Poprz. tydzien przychod</span>
                    <span>{data.revenue.weeklyPreviousRevenue.toFixed(2)} PLN</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Poprz. tydzien wizyty</span>
                    <span>{data.appointments.weeklyPreviousCount}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Insights Tab */}
        <TabsContent value="insights" className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Wnioski i rekomendacje AI</h2>
            <Badge variant="secondary">{data.insights.length}</Badge>
          </div>

          {data.insights.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Brak wnioskow do wyswietlenia. Dodaj wiecej danych do systemu.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {data.insights.map((insight, idx) => (
                <InsightCard key={idx} insight={insight} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Ask AI Tab */}
        <TabsContent value="ask" className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Zapytaj o trendy</h2>
          </div>

          <Card>
            <CardContent className="pt-6">
              {/* Chat messages */}
              <div className="min-h-[300px] max-h-[400px] overflow-y-auto space-y-3 mb-4">
                {chatMessages.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Zadaj pytanie o trendy biznesowe Twojego salonu</p>
                    <div className="mt-4 space-y-2">
                      <button
                        onClick={() => setChatInput("Jakie trendy widzisz w moich danych?")}
                        className="block mx-auto text-xs text-primary hover:underline"
                      >
                        &quot;Jakie trendy widzisz w moich danych?&quot;
                      </button>
                      <button
                        onClick={() => setChatInput("Ktore uslugi rosna, a ktore spadaja?")}
                        className="block mx-auto text-xs text-primary hover:underline"
                      >
                        &quot;Ktore uslugi rosna, a ktore spadaja?&quot;
                      </button>
                      <button
                        onClick={() => setChatInput("Jak poprawic wskaznik anulacji?")}
                        className="block mx-auto text-xs text-primary hover:underline"
                      >
                        &quot;Jak poprawic wskaznik anulacji?&quot;
                      </button>
                    </div>
                  </div>
                )}
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-auto max-w-[80%]"
                        : "bg-muted max-w-[80%]"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{msg.role === "user" ? "Ty" : "AI"}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted max-w-[80%]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">AI analizuje trendy...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  askAboutTrends();
                }}
                className="flex gap-2"
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Zapytaj o trendy..."
                  className="flex-1 p-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                  disabled={chatLoading}
                />
                <Button type="submit" size="sm" disabled={!chatInput.trim() || chatLoading}>
                  {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function BusinessTrendsPage() {
  return (
    <ProPlanGate
      featureName="Analiza trendow"
      featureDescription="Analiza trendow biznesowych pomaga identyfikowac wzorce i podejmowac lepsze decyzje."
      proBenefits={[
        "Analiza trendow przychodow i wizyt",
        "Porownania miesieczne i tygodniowe",
        "Popularnosc uslug i wyniki pracownikow",
        "Wnioski AI i rekomendacje",
        "Chat z AI o trendach",
      ]}
    >
      <TrendsContent />
    </ProPlanGate>
  );
}
