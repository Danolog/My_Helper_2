"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  DollarSign,
  Image,
  Video,
  TrendingUp,
  Loader2,
  Info,
  Sparkles,
} from "lucide-react";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface UsageStat {
  type: string;
  provider: string;
  count: number;
  estimatedCost: string;
  costPerUse: number;
}

interface UsageResponse {
  success: boolean;
  period: string;
  startDate: string;
  usage: UsageStat[];
  totalMediaCost: string;
  note: string;
}

// ────────────────────────────────────────────────────────────
// Display label maps
// ────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  image: { label: "Obrazy", icon: Image },
  video: { label: "Wideo", icon: Video },
  banner: { label: "Banery", icon: Image },
};

const PROVIDER_LABELS: Record<string, string> = {
  google_imagen: "Google Imagen",
  google_veo: "Google Veo",
  sharp: "Sharp (serwer)",
};

const PERIOD_LABELS: Record<string, string> = {
  week: "Ostatni tydzien",
  month: "Ostatni miesiac",
  year: "Ostatni rok",
};

/**
 * Number of days in the selected period. Used for monthly cost projection.
 */
const PERIOD_DAYS: Record<string, number> = {
  week: 7,
  month: 30,
  year: 365,
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function getTypeLabel(type: string) {
  return TYPE_LABELS[type]?.label ?? type;
}

function getTypeIcon(type: string) {
  return TYPE_LABELS[type]?.icon ?? Sparkles;
}

function getProviderLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

function formatCost(cost: string | number): string {
  const num = typeof cost === "string" ? parseFloat(cost) : cost;
  return `$${num.toFixed(2)}`;
}

// ────────────────────────────────────────────────────────────
// Main content (wrapped by ProPlanGate)
// ────────────────────────────────────────────────────────────

function AIUsageContent() {
  const [period, setPeriod] = useState<string>("month");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/ai/usage?period=${period}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ?? `Blad serwera (${res.status})`,
        );
      }
      const json: UsageResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Nie udalo sie pobrac danych",
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Derived values
  const totalItems = data
    ? data.usage.reduce((sum, u) => sum + u.count, 0)
    : 0;
  const totalCost = data ? parseFloat(data.totalMediaCost) : 0;
  const avgCost = totalItems > 0 ? totalCost / totalItems : 0;

  // Monthly cost projection based on current usage rate
  const periodDays = PERIOD_DAYS[period] ?? 30;
  const dailyRate = periodDays > 0 ? totalCost / periodDays : 0;
  const monthlyProjection = dailyRate * 30;

  // Find the most-used feature
  const mostUsed = data?.usage.reduce<UsageStat | null>((max, stat) => {
    if (!max || stat.count > max.count) return stat;
    return max;
  }, null);

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Koszty AI
          </h1>
          <p className="text-muted-foreground">
            Monitoring zuzycia i szacowane koszty funkcji AI
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Ostatni tydzien</SelectItem>
            <SelectItem value="month">Ostatni miesiac</SelectItem>
            <SelectItem value="year">Ostatni rok</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card className="border-destructive">
          <CardContent className="py-6 text-center text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={fetchUsage}
            >
              Sprobuj ponownie
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Data loaded */}
      {data && !loading && !error && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Wygenerowane media
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalItems}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {PERIOD_LABELS[period] ?? period}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  Szacowany koszt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCost(totalCost)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Tylko media (obrazy, wideo, banery)
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Prognoza miesieczna
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCost(monthlyProjection)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Na podstawie biezacego tempa zuzycia
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Most used feature */}
          {mostUsed && (
            <Card className="bg-muted/30">
              <CardContent className="py-4 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium">
                    Najczesciej uzywana funkcja:{" "}
                    <span className="text-primary">
                      {getTypeLabel(mostUsed.type)}
                    </span>{" "}
                    ({getProviderLabel(mostUsed.provider)})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {mostUsed.count}{" "}
                    {mostUsed.count === 1
                      ? "uzycie"
                      : mostUsed.count < 5
                        ? "uzycia"
                        : "uzyc"}{" "}
                    &middot; {formatCost(mostUsed.estimatedCost)} laczny koszt
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Usage breakdown */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Szczegoly zuzycia
            </h2>

            {data.usage.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Brak danych o zuzyciu w wybranym okresie.</p>
                  <p className="text-xs mt-1">
                    Generuj obrazy, banery lub wideo, aby zobaczyc statystyki.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {/* Column headers */}
                <div className="hidden md:grid md:grid-cols-5 gap-4 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <span>Typ</span>
                  <span>Dostawca</span>
                  <span className="text-right">Ilosc</span>
                  <span className="text-right">Koszt/szt.</span>
                  <span className="text-right">Laczny koszt</span>
                </div>

                {data.usage.map((stat) => {
                  const Icon = getTypeIcon(stat.type);
                  return (
                    <Card key={`${stat.type}-${stat.provider}`}>
                      <CardContent className="py-3 px-4">
                        <div className="grid md:grid-cols-5 gap-2 md:gap-4 items-center">
                          {/* Type */}
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-primary shrink-0" />
                            <span className="font-medium">
                              {getTypeLabel(stat.type)}
                            </span>
                          </div>

                          {/* Provider */}
                          <div>
                            <Badge variant="outline" className="text-xs">
                              {getProviderLabel(stat.provider)}
                            </Badge>
                          </div>

                          {/* Count */}
                          <div className="md:text-right">
                            <span className="md:hidden text-xs text-muted-foreground mr-1">
                              Ilosc:
                            </span>
                            <span className="font-medium">{stat.count}</span>
                          </div>

                          {/* Cost per use */}
                          <div className="md:text-right">
                            <span className="md:hidden text-xs text-muted-foreground mr-1">
                              Koszt/szt.:
                            </span>
                            <span className="text-muted-foreground">
                              {stat.costPerUse === 0
                                ? "Bezplatne"
                                : formatCost(stat.costPerUse)}
                            </span>
                          </div>

                          {/* Total cost */}
                          <div className="md:text-right">
                            <span className="md:hidden text-xs text-muted-foreground mr-1">
                              Laczny:
                            </span>
                            <span className="font-semibold">
                              {formatCost(stat.estimatedCost)}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

                {/* Total row */}
                <Card className="bg-muted/50 border-2">
                  <CardContent className="py-3 px-4">
                    <div className="grid md:grid-cols-5 gap-2 md:gap-4 items-center">
                      <div className="md:col-span-2 font-semibold">
                        Suma
                      </div>
                      <div className="md:text-right font-medium">
                        {totalItems}
                      </div>
                      <div className="md:text-right text-muted-foreground">
                        {totalItems > 0
                          ? `sr. ${formatCost(avgCost)}`
                          : "-"}
                      </div>
                      <div className="md:text-right font-bold text-lg">
                        {formatCost(totalCost)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Text AI note + cost reference table */}
          <Card className="border-dashed">
            <CardContent className="py-4">
              <div className="flex gap-3">
                <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">
                      Koszty tekstowe AI nie sa sledzone indywidualnie
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {data.note}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Cennik referencyjny funkcji AI:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <span>Auto-podsumowanie: $0.002</span>
                      <span>Wglad w klienta: $0.004</span>
                      <span>Wyszukiwanie AI: $0.002</span>
                      <span>Powiadomienia AI: $0.001</span>
                      <span>Komendy glosowe: $0.001</span>
                      <span>TTS (ElevenLabs): $0.003</span>
                      <span>STT (ElevenLabs): $0.002</span>
                      <span>Grafika (Imagen): $0.01</span>
                      <span>Ulepszenie foto: $0 (serwer)</span>
                      <span>Banery: $0.01</span>
                      <span>Ilustracje uslug: $0.01</span>
                      <span>Klipy wideo (Veo): $0.15</span>
                      <span>Szablony testimoniali: $0.002</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Page export — gated behind Pro plan
// ────────────────────────────────────────────────────────────

export default function AIUsagePage() {
  return (
    <ProPlanGate
      featureName="Koszty AI"
      featureDescription="Monitoruj zuzycie funkcji AI w Twoim salonie i sledz szacowane koszty generowania mediow."
      proBenefits={[
        "Podglad kosztow generowania obrazow, wideo i banerow",
        "Prognoza miesieczna na podstawie biezacego zuzycia",
        "Szczegolowy rozklad zuzycia wg typu i dostawcy",
        "Cennik referencyjny wszystkich funkcji AI",
      ]}
    >
      <AIUsageContent />
    </ProPlanGate>
  );
}
