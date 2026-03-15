"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Loader2,
  XCircle,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Zap,
  Info,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getUserFriendlyMessage } from "@/lib/error-messages";
import {
  SUGGESTION_COLORS,
  SUGGESTION_ICON_COLORS,
  PRIORITY_BADGES,
  PRIORITY_LABELS,
} from "../_types";
import type { Suggestion } from "../_types";

const SUGGESTION_ICONS: Record<string, React.ElementType> = {
  warning: AlertTriangle,
  opportunity: Lightbulb,
  action: Zap,
  insight: Info,
};

export function ProactiveSuggestions() {
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
        getUserFriendlyMessage(e, "Wystapil nieoczekiwany blad. Sprobuj ponownie pozniej."),
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
