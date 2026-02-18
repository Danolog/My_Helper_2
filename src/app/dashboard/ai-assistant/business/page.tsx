"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  Loader2,
  Send,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  CalendarDays,
  Users,
  Star,
  Package,
  RefreshCw,
  Copy,
  Check,
  XCircle,
  AlertTriangle,
  Lightbulb,
  Zap,
  Info,
  ExternalLink,
  ShieldAlert,
  Bell,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  MessageSquareWarning,
  ThumbsDown,
  Clock,
  User,
  Scissors,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { toast } from "sonner";
import type { Components } from "react-markdown";

// ────────────────────────────────────────────────────────────
// Markdown rendering components (reused from chat page pattern)
// ────────────────────────────────────────────────────────────

const H1: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = (props) => (
  <h1 className="mt-2 mb-3 text-2xl font-bold" {...props} />
);
const H2: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = (props) => (
  <h2 className="mt-2 mb-2 text-xl font-semibold" {...props} />
);
const H3: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = (props) => (
  <h3 className="mt-2 mb-2 text-lg font-semibold" {...props} />
);
const Paragraph: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = (
  props
) => <p className="mb-3 leading-7 text-sm" {...props} />;
const UL: React.FC<React.HTMLAttributes<HTMLUListElement>> = (props) => (
  <ul className="mb-3 ml-5 list-disc space-y-1 text-sm" {...props} />
);
const OL: React.FC<React.OlHTMLAttributes<HTMLOListElement>> = (props) => (
  <ol className="mb-3 ml-5 list-decimal space-y-1 text-sm" {...props} />
);
const LI: React.FC<React.LiHTMLAttributes<HTMLLIElement>> = (props) => (
  <li className="leading-6" {...props} />
);
const Anchor: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement>> = (
  props
) => (
  <a
    className="underline underline-offset-2 text-primary hover:opacity-90"
    target="_blank"
    rel="noreferrer noopener"
    {...props}
  />
);
const Blockquote: React.FC<React.BlockquoteHTMLAttributes<HTMLElement>> = (
  props
) => (
  <blockquote
    className="mb-3 border-l-2 border-border pl-3 text-muted-foreground"
    {...props}
  />
);
const Code: Components["code"] = ({ children, className, ...props }) => {
  const match = /language-(\w+)/.exec(className || "");
  const isInline = !match;
  if (isInline) {
    return (
      <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props}>
        {children}
      </code>
    );
  }
  return (
    <pre className="mb-3 w-full overflow-x-auto rounded-md bg-muted p-3">
      <code className="text-xs leading-5" {...props}>
        {children}
      </code>
    </pre>
  );
};
const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = (
  props
) => (
  <div className="mb-3 overflow-x-auto">
    <table className="w-full border-collapse text-sm" {...props} />
  </div>
);
const TH: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = (
  props
) => (
  <th
    className="border border-border bg-muted px-2 py-1 text-left"
    {...props}
  />
);
const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = (
  props
) => <td className="border border-border px-2 py-1" {...props} />;

const markdownComponents: Components = {
  h1: H1,
  h2: H2,
  h3: H3,
  p: Paragraph,
  ul: UL,
  ol: OL,
  li: LI,
  a: Anchor,
  blockquote: Blockquote,
  code: Code,
  table: Table,
  th: TH,
  td: TD,
};

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

interface AnalyticsData {
  generatedAt: string;
  period: string;
  overview: {
    totalClients: number;
    totalEmployees: number;
    totalServices: number;
    newClientsThisMonth: number;
  };
  appointments: {
    last30Days: number;
    previous30Days: number;
    growthPercent: string;
    byStatus: Record<string, number>;
    cancellationRate: string;
  };
  revenue: {
    last30Days: number;
    previous30Days: number;
    growthPercent: string;
    currency: string;
  };
  topServices: { serviceName: string; servicePrice: string; count: number }[];
  topEmployees: {
    firstName: string;
    lastName: string;
    count: number;
  }[];
  reviews: {
    averageRating: string;
    totalReviews: number;
    recent: {
      rating: number;
      comment: string | null;
      status: string;
      createdAt: string;
    }[];
  };
  inventory: {
    lowStockProducts: {
      name: string;
      quantity: string;
      minQuantity: string | null;
      unit: string | null;
    }[];
    lowStockCount: number;
  };
}

// ────────────────────────────────────────────────────────────
// Copy button component
// ────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Skopiowano do schowka");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-muted rounded transition-colors"
      title="Kopiuj"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Analytics Dashboard Cards
// ────────────────────────────────────────────────────────────

function AnalyticsSummary({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">
          Ladowanie danych salonu...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const growthPercent = data.appointments.growthPercent;
  const revenueGrowth = data.revenue.growthPercent;

  return (
    <div className="space-y-4">
      {/* Key metrics */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Przychod (30 dni)</span>
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">
              {data.revenue.last30Days.toFixed(0)} PLN
            </div>
            {revenueGrowth !== "N/A" && (
              <div className="flex items-center gap-1 mt-1">
                {Number(revenueGrowth) > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-600" />
                ) : Number(revenueGrowth) < 0 ? (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                ) : (
                  <Minus className="h-3 w-3 text-yellow-500" />
                )}
                <span className="text-xs text-muted-foreground">
                  {Number(revenueGrowth) > 0 ? "+" : ""}
                  {revenueGrowth}% vs poprz.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Wizyty (30 dni)</span>
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">{data.appointments.last30Days}</div>
            {growthPercent !== "N/A" && (
              <div className="flex items-center gap-1 mt-1">
                {Number(growthPercent) > 0 ? (
                  <TrendingUp className="h-3 w-3 text-green-600" />
                ) : Number(growthPercent) < 0 ? (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                ) : (
                  <Minus className="h-3 w-3 text-yellow-500" />
                )}
                <span className="text-xs text-muted-foreground">
                  {Number(growthPercent) > 0 ? "+" : ""}
                  {growthPercent}% vs poprz.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Klienci</span>
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">{data.overview.totalClients}</div>
            <div className="text-xs text-muted-foreground mt-1">
              +{data.overview.newClientsThisMonth} nowych w tym mies.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Srednia ocena</span>
              <Star className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="text-lg font-bold">
              {data.reviews.averageRating}/5
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {data.reviews.totalReviews} opinii
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary info */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        {/* Top services */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Najpopularniejsze uslugi
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {data.topServices.length === 0 ? (
              <p className="text-xs text-muted-foreground">Brak danych</p>
            ) : (
              <div className="space-y-1.5">
                {data.topServices.slice(0, 3).map((svc, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate">{svc.serviceName}</span>
                    <Badge variant="secondary" className="text-xs ml-2">
                      {svc.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top employees */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Najaktywniejszi pracownicy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {data.topEmployees.length === 0 ? (
              <p className="text-xs text-muted-foreground">Brak danych</p>
            ) : (
              <div className="space-y-1.5">
                {data.topEmployees.slice(0, 3).map((emp, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate">
                      {emp.firstName} {emp.lastName}
                    </span>
                    <Badge variant="secondary" className="text-xs ml-2">
                      {emp.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low stock alerts */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Package className="h-3 w-3" />
              Niski stan magazynowy
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {data.inventory.lowStockCount === 0 ? (
              <p className="text-xs text-green-600">
                Wszystkie produkty w normie
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.inventory.lowStockProducts.slice(0, 3).map((p, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="truncate text-red-600">{p.name}</span>
                    <span className="text-muted-foreground ml-2">
                      {p.quantity} {p.unit || "szt."}
                    </span>
                  </div>
                ))}
                {data.inventory.lowStockCount > 3 && (
                  <p className="text-xs text-muted-foreground">
                    +{data.inventory.lowStockCount - 3} wiecej
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Business Alerts Component (negative trend warnings)
// ────────────────────────────────────────────────────────────

interface BusinessAlertData {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  problem: string;
  impact: string;
  suggestions: string[];
  metric: {
    label: string;
    current: number | string;
    previous: number | string;
    changePercent: number;
    unit: string;
  };
  actionHref?: string;
  actionLabel?: string;
}

const SEVERITY_STYLES: Record<
  string,
  {
    border: string;
    bg: string;
    icon: string;
    badge: string;
    badgeText: string;
  }
> = {
  critical: {
    border: "border-red-300 dark:border-red-800",
    bg: "bg-red-50 dark:bg-red-950/50",
    icon: "text-red-600 dark:text-red-400",
    badge: "bg-red-600 text-white",
    badgeText: "Krytyczny",
  },
  warning: {
    border: "border-orange-300 dark:border-orange-800",
    bg: "bg-orange-50 dark:bg-orange-950/50",
    icon: "text-orange-600 dark:text-orange-400",
    badge: "bg-orange-500 text-white",
    badgeText: "Ostrzezenie",
  },
  info: {
    border: "border-blue-200 dark:border-blue-800",
    bg: "bg-blue-50 dark:bg-blue-950/50",
    icon: "text-blue-600 dark:text-blue-400",
    badge: "bg-blue-500 text-white",
    badgeText: "Informacja",
  },
};

const DEFAULT_SEVERITY_STYLE = {
  border: "border-blue-200 dark:border-blue-800",
  bg: "bg-blue-50 dark:bg-blue-950/50",
  icon: "text-blue-600 dark:text-blue-400",
  badge: "bg-blue-500 text-white",
  badgeText: "Informacja",
};

function AlertCard({ alert }: { alert: BusinessAlertData }) {
  const [expanded, setExpanded] = useState(false);
  const styles = SEVERITY_STYLES[alert.severity] ?? DEFAULT_SEVERITY_STYLE;
  const SeverityIcon =
    alert.severity === "critical"
      ? ShieldAlert
      : alert.severity === "warning"
        ? AlertTriangle
        : Info;

  return (
    <Card className={`border-2 ${styles.border} ${styles.bg} transition-all`}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${styles.icon}`}>
            <SeverityIcon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${styles.badge}`}
              >
                {styles.badgeText}
              </span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {alert.category}
              </Badge>
              {alert.metric.changePercent !== 0 && (
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-1.5 py-0 ${
                    alert.metric.changePercent < 0
                      ? "text-red-700 dark:text-red-300"
                      : "text-green-700 dark:text-green-300"
                  }`}
                >
                  {alert.metric.changePercent > 0 ? "+" : ""}
                  {alert.metric.changePercent}%
                </Badge>
              )}
            </div>
            <h4 className="font-semibold text-sm mb-1">{alert.title}</h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {alert.problem}
            </p>

            {/* Metric summary */}
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span>
                Teraz: <strong>{alert.metric.current}</strong>
              </span>
              {alert.metric.previous !== "-" && alert.metric.previous !== 0 && (
                <span>
                  Poprzednio: <strong>{alert.metric.previous}</strong>
                </span>
              )}
            </div>

            {/* Expand/collapse for details */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-3 text-xs font-medium text-primary hover:underline"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Zwiń szczegóły
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Zobacz wpływ i sugestie ({alert.suggestions.length})
                </>
              )}
            </button>

            {/* Expanded details */}
            {expanded && (
              <div className="mt-3 space-y-3">
                {/* Impact */}
                <div className="p-3 rounded-lg bg-background/50 border">
                  <p className="text-xs font-medium mb-1 text-muted-foreground">
                    Potencjalny wplyw:
                  </p>
                  <p className="text-sm">{alert.impact}</p>
                </div>

                {/* Suggestions */}
                <div>
                  <p className="text-xs font-medium mb-2 text-muted-foreground">
                    Sugerowane dzialania:
                  </p>
                  <ul className="space-y-1.5">
                    {alert.suggestions.map((suggestion, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                        <span>{suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Action link */}
                {alert.actionLabel && alert.actionHref && (
                  <Link
                    href={alert.actionHref}
                    className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium text-primary hover:underline bg-primary/5 px-3 py-1.5 rounded-md"
                  >
                    {alert.actionLabel}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BusinessAlerts() {
  const [alerts, setAlerts] = useState<BusinessAlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    critical: 0,
    warning: 0,
    info: 0,
    total: 0,
  });

  const fetchAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/alerts");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac alertow");
      }
      const json = await res.json();
      setAlerts(json.alerts || []);
      setCounts({
        critical: json.criticalCount || 0,
        warning: json.warningCount || 0,
        info: json.infoCount || 0,
        total: json.totalAlerts || 0,
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">
          Skanuje dane salonu w poszukiwaniu problemow...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchAlerts}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-green-500 mx-auto mb-3" />
          <h3 className="font-medium mb-1">Brak wykrytych problemow!</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            AI przeanalizowalo dane Twojego salonu i nie znalazlo zadnych
            negatywnych trendow ani problemow wymagajacych uwagi. Wszystko
            wyglada dobrze!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Wykryto <strong>{counts.total}</strong>{" "}
            {counts.total === 1
              ? "problem"
              : counts.total < 5
                ? "problemy"
                : "problemow"}
          </p>
          <div className="flex items-center gap-1.5">
            {counts.critical > 0 && (
              <Badge className="bg-red-600 text-white text-[10px] px-1.5 py-0">
                {counts.critical} krytycznych
              </Badge>
            )}
            {counts.warning > 0 && (
              <Badge className="bg-orange-500 text-white text-[10px] px-1.5 py-0">
                {counts.warning} ostrzezen
              </Badge>
            )}
            {counts.info > 0 && (
              <Badge className="bg-blue-500 text-white text-[10px] px-1.5 py-0">
                {counts.info} informacji
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAlerts}
          disabled={loading}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}
          />
          Skanuj ponownie
        </Button>
      </div>

      {/* Alert cards */}
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Proactive Suggestions Component
// ────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  type: "warning" | "opportunity" | "action" | "insight";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  metric?: string;
  actionLabel?: string;
  actionHref?: string;
}

const SUGGESTION_ICONS: Record<string, React.ElementType> = {
  warning: AlertTriangle,
  opportunity: Lightbulb,
  action: Zap,
  insight: Info,
};

const SUGGESTION_COLORS: Record<string, string> = {
  warning: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950",
  opportunity:
    "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  action:
    "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  insight:
    "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950",
};

const SUGGESTION_ICON_COLORS: Record<string, string> = {
  warning: "text-red-600 dark:text-red-400",
  opportunity: "text-green-600 dark:text-green-400",
  action: "text-blue-600 dark:text-blue-400",
  insight: "text-yellow-600 dark:text-yellow-400",
};

const PRIORITY_BADGES: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  medium:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "Wysoki",
  medium: "Sredni",
  low: "Niski",
};

function ProactiveSuggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/suggestions");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac sugestii");
      }
      const json = await res.json();
      setSuggestions(json.suggestions || []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">
          Analizuje dane salonu i generuje sugestie...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchSuggestions}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Sparkles className="h-10 w-10 text-green-500 mx-auto mb-3" />
          <h3 className="font-medium mb-1">Wszystko wyglada swietnie!</h3>
          <p className="text-sm text-muted-foreground">
            Nie znaleziono zadnych pilnych sugestii. Twoj salon dziala
            prawidlowo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {suggestions.length}{" "}
          {suggestions.length === 1
            ? "sugestia"
            : suggestions.length < 5
              ? "sugestie"
              : "sugestii"}{" "}
          na podstawie analizy danych salonu
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSuggestions}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Odswiez
        </Button>
      </div>

      {suggestions.map((suggestion) => {
        const Icon = SUGGESTION_ICONS[suggestion.type] || Info;
        const colorClass = SUGGESTION_COLORS[suggestion.type] || "";
        const iconColor = SUGGESTION_ICON_COLORS[suggestion.type] || "";
        const priorityBadge = PRIORITY_BADGES[suggestion.priority] || "";
        const priorityLabel = PRIORITY_LABELS[suggestion.priority] || "";

        return (
          <Card
            key={suggestion.id}
            className={`border ${colorClass} transition-colors`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 ${iconColor}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-semibold text-sm">
                      {suggestion.title}
                    </h4>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${priorityBadge}`}
                    >
                      {priorityLabel}
                    </Badge>
                    {suggestion.metric && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {suggestion.metric}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {suggestion.description}
                  </p>
                  {suggestion.actionLabel && suggestion.actionHref && (
                    <Link
                      href={suggestion.actionHref}
                      className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary hover:underline"
                    >
                      {suggestion.actionLabel}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Review Alerts Component (negative review notifications with response suggestions)
// ────────────────────────────────────────────────────────────

interface ReviewAlertData {
  id: string;
  reviewId: string;
  rating: number;
  comment: string | null;
  clientName: string;
  employeeName: string;
  serviceName: string;
  appointmentDate: string | null;
  createdAt: string;
  severity: "critical" | "warning";
  suggestedResponse: string;
  responseType: "ai" | "template";
}

function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < rating
              ? "text-yellow-500 fill-yellow-500"
              : "text-gray-300 dark:text-gray-600"
          }`}
        />
      ))}
    </div>
  );
}

function ReviewAlertCard({ alert }: { alert: ReviewAlertData }) {
  const [expanded, setExpanded] = useState(false);
  const [responseCopied, setResponseCopied] = useState(false);
  const isCritical = alert.severity === "critical";

  const handleCopyResponse = async () => {
    try {
      await navigator.clipboard.writeText(alert.suggestedResponse);
      setResponseCopied(true);
      toast.success("Sugerowana odpowiedz skopiowana");
      setTimeout(() => setResponseCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };

  return (
    <Card
      className={`border-2 transition-all ${
        isCritical
          ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/50"
          : "border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/50"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 ${
              isCritical
                ? "text-red-600 dark:text-red-400"
                : "text-orange-600 dark:text-orange-400"
            }`}
          >
            <ThumbsDown className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            {/* Header badges */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  isCritical ? "bg-red-600 text-white" : "bg-orange-500 text-white"
                }`}
              >
                {isCritical ? "Krytyczny" : "Ostrzezenie"}
              </span>
              <StarRating rating={alert.rating} />
              <span className="text-xs text-muted-foreground">
                {alert.rating}/5
              </span>
              {alert.responseType === "ai" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                  Odpowiedz AI
                </Badge>
              )}
            </div>

            {/* Client & service info */}
            <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {alert.clientName}
              </span>
              <span className="flex items-center gap-1">
                <Scissors className="h-3 w-3" />
                {alert.serviceName}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {alert.employeeName}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(alert.createdAt).toLocaleDateString("pl-PL", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>

            {/* Comment */}
            {alert.comment ? (
              <div className="p-3 rounded-lg bg-background/60 border mb-2">
                <p className="text-sm italic leading-relaxed">&ldquo;{alert.comment}&rdquo;</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-2 italic">
                (Brak komentarza - tylko ocena)
              </p>
            )}

            {/* Expand/collapse for suggested response */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-1 text-xs font-medium text-primary hover:underline"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Ukryj sugerowana odpowiedz
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Zobacz sugerowana odpowiedz
                </>
              )}
            </button>

            {/* Suggested response */}
            {expanded && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <MessageSquareWarning className="h-3.5 w-3.5" />
                    Sugerowana odpowiedz{" "}
                    {alert.responseType === "ai" ? "(wygenerowana przez AI)" : "(szablon)"}:
                  </p>
                  <button
                    onClick={handleCopyResponse}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {responseCopied ? (
                      <>
                        <Check className="h-3 w-3 text-green-500" />
                        Skopiowano
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Kopiuj
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 rounded-lg bg-background border">
                  <p className="text-sm leading-relaxed">{alert.suggestedResponse}</p>
                </div>
                <Link
                  href="/dashboard/reviews"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline bg-primary/5 px-3 py-1.5 rounded-md"
                >
                  Przejdz do moderacji opinii
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewAlerts() {
  const [alerts, setAlerts] = useState<ReviewAlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalNegative, setTotalNegative] = useState(0);

  const fetchReviewAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/business/review-alerts");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac alertow o opiniach");
      }
      const json = await res.json();
      setAlerts(json.alerts || []);
      setTotalNegative(json.totalNegativeReviews || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wystapil nieoczekiwany blad");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviewAlerts();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-3 text-sm text-muted-foreground">
          Skanuje opinie klientow...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <XCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchReviewAlerts}>
            Sprobuj ponownie
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Star className="h-10 w-10 text-green-500 mx-auto mb-3" />
          <h3 className="font-medium mb-1">Brak negatywnych opinii!</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            W ostatnich 30 dniach nie znaleziono opinii z ocena 3 lub nizej.
            Twoi klienci sa zadowoleni!
          </p>
        </CardContent>
      </Card>
    );
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            <strong>{totalNegative}</strong> negatywnych opinii w ostatnich 30 dniach
            {totalNegative > alerts.length && (
              <span> (pokazano {alerts.length} najnowszych)</span>
            )}
          </p>
          <div className="flex items-center gap-1.5">
            {criticalCount > 0 && (
              <Badge className="bg-red-600 text-white text-[10px] px-1.5 py-0">
                {criticalCount} krytycznych
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="bg-orange-500 text-white text-[10px] px-1.5 py-0">
                {warningCount} ostrzezen
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchReviewAlerts}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Skanuj ponownie
        </Button>
      </div>

      {/* Alert cards */}
      {alerts.map((alert) => (
        <ReviewAlertCard key={alert.id} alert={alert} />
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Suggested prompts
// ────────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "Jak wyglada wydajnosc mojego salonu?",
  "Ktore uslugi sa najpopularniejsze?",
  "Jak moge zwiekszyc przychody?",
  "Jaki jest wskaznik anulacji i jak go poprawic?",
  "Jakie sa aktualne trendy w mojej branzy?",
  "Jak wypadam na tle konkurencji i jak sie wyrozniac?",
];

// ────────────────────────────────────────────────────────────
// Main Business Assistant Content
// ────────────────────────────────────────────────────────────

function BusinessAssistantContent() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch analytics data
  const fetchAnalytics = async () => {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await fetch("/api/ai/business/analytics");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Blad serwera" }));
        throw new Error(err.error || "Nie udalo sie pobrac danych");
      }
      const json = await res.json();
      setAnalytics(json.analytics);
    } catch (e) {
      setAnalyticsError(
        e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"
      );
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Build the message history for the API from chat messages
  const buildAPIMessages = (newUserText: string) => {
    const history = chatMessages.map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant",
      parts: [{ type: "text", text: msg.text }],
    }));
    history.push({
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: newUserText }],
    });
    return history;
  };

  // Send message to business AI
  const sendMessage = async (text?: string) => {
    const messageText = (text || chatInput).trim();
    if (!messageText || chatLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: messageText,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const apiMessages = buildAPIMessages(messageText);

      const res = await fetch("/api/ai/business/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(
          errData?.error || "Blad komunikacji z asystentem AI"
        );
      }

      // Read streaming response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Brak odpowiedzi");

      const decoder = new TextDecoder();
      let fullText = "";
      const assistantId = crypto.randomUUID();

      // Add empty assistant message
      setChatMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          text: "",
          timestamp: new Date(),
        },
      ]);

      // Buffer for partial lines across chunks
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in buffer
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
              // Re-throw stream errors (not JSON parse errors)
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
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, text: fullText } : msg
          )
        );
      }
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Blad: ${e instanceof Error ? e.message : "Wystapil nieoczekiwany blad"}`,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = () => {
    setChatMessages([]);
    toast.success("Rozmowa wyczyszczona");
  };

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
              <Brain className="h-6 w-6 text-primary" />
              Asystent biznesowy AI
            </h1>
            <p className="text-muted-foreground text-sm">
              Analizuj dane salonu i pytaj o wyniki biznesowe
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAnalytics}
          disabled={analyticsLoading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${analyticsLoading ? "animate-spin" : ""}`}
          />
          Odswiez dane
        </Button>
      </div>

      <Tabs defaultValue="alerts" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="alerts">
            <Bell className="h-4 w-4 mr-2" />
            Alerty
          </TabsTrigger>
          <TabsTrigger value="review-alerts">
            <MessageSquareWarning className="h-4 w-4 mr-2" />
            Opinie
          </TabsTrigger>
          <TabsTrigger value="suggestions">
            <Lightbulb className="h-4 w-4 mr-2" />
            Sugestie AI
          </TabsTrigger>
          <TabsTrigger value="chat">
            <Sparkles className="h-4 w-4 mr-2" />
            Asystent AI
          </TabsTrigger>
          <TabsTrigger value="dashboard">
            <TrendingUp className="h-4 w-4 mr-2" />
            Dane salonu
          </TabsTrigger>
        </TabsList>

        {/* Alerts Tab - Problem Detection */}
        <TabsContent value="alerts">
          <BusinessAlerts />
        </TabsContent>

        {/* Review Alerts Tab - Negative Review Notifications */}
        <TabsContent value="review-alerts">
          <ReviewAlerts />
        </TabsContent>

        {/* Suggestions Tab */}
        <TabsContent value="suggestions">
          <ProactiveSuggestions />
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="space-y-4">
          <Card className="border-0 shadow-none">
            <CardContent className="p-0">
              {/* Chat messages area */}
              <div className="min-h-[400px] max-h-[500px] overflow-y-auto space-y-3 mb-4 p-1">
                {chatMessages.length === 0 && (
                  <div className="text-center py-12">
                    <Brain className="h-12 w-12 mx-auto mb-4 text-primary/30" />
                    <h3 className="font-medium mb-2">
                      Asystent biznesowy AI
                    </h3>
                    <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                      Zapytaj o wyniki Twojego salonu. AI analizuje rzeczywiste
                      dane z bazy danych - wizyty, przychody, klientow,
                      pracownikow, opinie i magazyn.
                    </p>

                    {/* Suggested prompts */}
                    <div className="grid gap-2 max-w-lg mx-auto grid-cols-1 sm:grid-cols-2">
                      {SUGGESTED_PROMPTS.map((prompt, idx) => (
                        <button
                          key={idx}
                          onClick={() => sendMessage(prompt)}
                          className="text-left text-xs p-3 border rounded-lg hover:bg-muted transition-colors"
                        >
                          <Sparkles className="h-3 w-3 text-primary inline mr-1.5" />
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`group p-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground ml-auto max-w-[85%]"
                        : "bg-muted max-w-[85%]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">
                          {msg.role === "user" ? "Ty" : "AI Asystent"}
                        </span>
                        <span className="text-xs opacity-60">
                          {msg.timestamp.toLocaleTimeString("pl-PL", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {msg.role === "assistant" && msg.text && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <CopyButton text={msg.text} />
                        </div>
                      )}
                    </div>
                    <div className="prose prose-sm max-w-none">
                      {msg.role === "assistant" ? (
                        <ReactMarkdown components={markdownComponents}>
                          {msg.text}
                        </ReactMarkdown>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">
                          {msg.text}
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted max-w-[85%]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      AI analizuje dane salonu...
                    </span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="border-t pt-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage();
                  }}
                  className="flex gap-2"
                >
                  <input
                    ref={inputRef}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Zapytaj o wyniki salonu..."
                    className="flex-1 p-2.5 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                    disabled={chatLoading}
                  />
                  <Button
                    type="submit"
                    disabled={!chatInput.trim() || chatLoading}
                  >
                    {chatLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
                {chatMessages.length > 0 && (
                  <div className="flex justify-end mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearChat}
                      className="text-xs text-muted-foreground"
                    >
                      Wyczysc rozmowe
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard">
          <AnalyticsSummary
            data={analytics}
            loading={analyticsLoading}
            error={analyticsError}
            onRefresh={fetchAnalytics}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Export with Pro plan gate
// ────────────────────────────────────────────────────────────

export default function BusinessAssistantPage() {
  return (
    <ProPlanGate
      featureName="Asystent biznesowy AI"
      featureDescription="Asystent biznesowy AI analizuje dane Twojego salonu i pomaga podejmowac lepsze decyzje."
      proBenefits={[
        "Analiza przychodow, wizyt i trendow",
        "Rekomendacje optymalizacji biznesu",
        "Informacje o popularnosci uslug",
        "Analiza wynikow pracownikow",
        "Monitoring stanu magazynowego",
      ]}
    >
      <BusinessAssistantContent />
    </ProPlanGate>
  );
}
