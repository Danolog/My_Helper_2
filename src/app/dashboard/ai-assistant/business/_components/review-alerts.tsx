"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Loader2,
  XCircle,
  RefreshCw,
  Star,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MessageSquareWarning,
  ThumbsDown,
  Clock,
  User,
  Scissors,
  Users,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ReviewAlertData } from "../_types";

// ────────────────────────────────────────────────────────────
// Star rating display
// ────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────
// Single review alert card with expandable response suggestion
// ────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────
// Review alerts list (fetches review alerts on mount)
// ────────────────────────────────────────────────────────────

export function ReviewAlerts() {
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
    } catch {
      setError("Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej.");
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
