"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Lock, Calendar, Users, Scissors, CalendarPlus, Contact, CreditCard, Receipt, MessageSquare, Image, Star, Clock, Cake, Package, BarChart3, Percent, Ticket, Gift, DollarSign, Printer, FileText, Crown, Bot, Lightbulb, PenTool, Timer, AlertTriangle, Loader2, RefreshCw, ExternalLink, Sunrise, CalendarDays, ShieldAlert, Zap, Info } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { useSession } from "@/lib/auth-client";

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

  const fetchRecommendations = async () => {
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
      if (error !== "not-pro") {
        setError(e instanceof Error ? e.message : "Wystapil nieoczekiwany blad");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const { isProPlan, isTrialing, trialDaysRemaining } = useSubscription();

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
                : "Korzystasz z pelnych funkcji w ramach 14-dniowego okresu probnego."
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

      {/* Daily AI Recommendations - shown for Pro plan users */}
      {isProPlan && <DailyRecommendations />}

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
