"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Loader2,
  XCircle,
  RefreshCw,
  ShieldAlert,
  AlertTriangle,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getUserFriendlyMessage } from "@/lib/error-messages";
import { SEVERITY_STYLES, DEFAULT_SEVERITY_STYLE } from "../_types";
import type { BusinessAlertData } from "../_types";

// ────────────────────────────────────────────────────────────
// Single alert card with expandable details
// ────────────────────────────────────────────────────────────

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
                  Zwi{"\u0144"} szczeg{"\u00f3"}ly
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Zobacz wp{"\u0142"}yw i sugestie ({alert.suggestions.length})
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

// ────────────────────────────────────────────────────────────
// Business alerts list (fetches alerts on mount)
// ────────────────────────────────────────────────────────────

export function BusinessAlerts() {
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
        getUserFriendlyMessage(e, "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."),
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
