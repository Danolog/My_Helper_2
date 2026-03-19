"use client";

import { useState } from "react";
import {
  Brain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  Lightbulb,
  BarChart3,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReadAloudButton } from "@/components/ui/read-aloud-button";
import { useSubscription } from "@/hooks/use-subscription";

interface ClientInsights {
  churnRisk: number;
  spendingTrend: string;
  topServices: string[];
  visitFrequency: string;
  reengagementSuggestions: string[];
  summary: string;
}

interface ClientInsightsTabProps {
  clientId: string;
}

/**
 * AI-powered client insights tab for the client profile page.
 * Requires Pro plan — shows an upgrade prompt for Basic plan users.
 * On demand, calls the AI endpoint to analyze client data and displays
 * churn risk, spending trends, visit frequency, and re-engagement suggestions.
 */
export function ClientInsightsTab({ clientId }: ClientInsightsTabProps) {
  const { isProPlan } = useSubscription();
  const [insights, setInsights] = useState<ClientInsights | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/clients/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (data.success) {
        setInsights(data.insights);
      } else {
        toast.error(data.error || "Nie udalo sie pobrac analizy");
      }
    } catch {
      toast.error("Blad podczas pobierania analizy AI");
    } finally {
      setLoading(false);
    }
  };

  // Basic plan users see an upgrade prompt
  if (!isProPlan) {
    return (
      <Card data-testid="insights-pro-gate">
        <CardContent className="py-12 text-center">
          <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold text-lg mb-2">Analiza AI klienta</h3>
          <p className="text-muted-foreground mb-4">
            Dostepne tylko w Planie Pro
          </p>
          <Button variant="outline" asChild>
            <a href="/dashboard/subscription">Zmien na Pro</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Initial state — prompt user to generate insights
  if (!insights && !loading) {
    return (
      <Card data-testid="insights-generate-prompt">
        <CardContent className="py-12 text-center">
          <Brain className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold text-lg mb-2">Analiza AI klienta</h3>
          <p className="text-muted-foreground mb-4">
            AI przeanalizuje historie wizyt, wydatki i preferencje klienta
          </p>
          <Button onClick={fetchInsights} data-testid="generate-insights-btn">
            <Sparkles className="h-4 w-4 mr-2" />
            Generuj analize
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Card data-testid="insights-loading">
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-primary" />
          <p className="text-muted-foreground">
            Analizowanie danych klienta...
          </p>
        </CardContent>
      </Card>
    );
  }

  // Insights are loaded — render the full analysis
  const churnRisk = insights!.churnRisk;
  const churnLevel =
    churnRisk <= 3 ? "low" : churnRisk <= 6 ? "medium" : "high";

  const churnConfig = {
    low: {
      color:
        "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
      icon: <CheckCircle className="h-4 w-4" />,
      label: "Niskie ryzyko",
    },
    medium: {
      color:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Srednie ryzyko",
    },
    high: {
      color: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
      icon: <AlertTriangle className="h-4 w-4" />,
      label: "Wysokie ryzyko",
    },
  };

  const churn = churnConfig[churnLevel];

  return (
    <div className="space-y-6" data-testid="insights-results">
      {/* Header with refresh button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Analiza AI klienta</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchInsights}
          disabled={loading}
          data-testid="refresh-insights-btn"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Odswiez
        </Button>
      </div>

      {/* Summary Card */}
      <Card data-testid="insights-summary-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Podsumowanie
            </CardTitle>
            <ReadAloudButton text={insights!.summary} />
          </div>
        </CardHeader>
        <CardContent>
          <p
            className="text-muted-foreground leading-relaxed"
            data-testid="insights-summary-text"
          >
            {insights!.summary}
          </p>
        </CardContent>
      </Card>

      {/* Metrics Grid: Churn Risk + Spending + Visit Frequency */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Churn Risk */}
        <Card data-testid="insights-churn-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ryzyko odejscia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <span
                className="text-3xl font-bold"
                data-testid="insights-churn-value"
              >
                {churnRisk}/10
              </span>
              <Badge
                className={`gap-1 ${churn.color}`}
                data-testid="insights-churn-badge"
              >
                {churn.icon}
                {churn.label}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Spending Trend */}
        <Card data-testid="insights-spending-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              Trend wydatkow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-2">
              {insights!.spendingTrend
                .toLowerCase()
                .includes("rosn") ? (
                <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              ) : insights!.spendingTrend
                  .toLowerCase()
                  .includes("malej") ? (
                <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              ) : (
                <TrendingUp className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <p
                className="text-sm"
                data-testid="insights-spending-text"
              >
                {insights!.spendingTrend}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Visit Frequency */}
        <Card data-testid="insights-frequency-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              Czestotliwosc wizyt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm" data-testid="insights-frequency-text">
              {insights!.visitFrequency}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Services */}
      {insights!.topServices.length > 0 && (
        <Card data-testid="insights-services-card">
          <CardHeader>
            <CardTitle className="text-lg">Najczesciej wybierane uslugi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2" data-testid="insights-services-list">
              {insights!.topServices.map((service, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="text-sm"
                >
                  {service}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Re-engagement Suggestions */}
      {insights!.reengagementSuggestions.length > 0 && (
        <Card data-testid="insights-suggestions-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Sugestie dzialania
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul
              className="space-y-3"
              data-testid="insights-suggestions-list"
            >
              {insights!.reengagementSuggestions.map(
                (suggestion, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0 mt-0.5">
                      {index + 1}
                    </span>
                    <p className="text-sm">{suggestion}</p>
                  </li>
                ),
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
