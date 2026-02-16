"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Crown,
  Zap,
  Calendar,
  Users,
  BarChart3,
  Bot,
  MessageSquare,
  Megaphone,
  Star,
  ArrowRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";

type Plan = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

/**
 * Comparison table features.
 * Each row: category label, feature name, available in Basic, available in Pro.
 */
const COMPARISON_FEATURES = [
  {
    category: "Zarzadzanie salonem",
    features: [
      { name: "Kalendarz pracownikow", basic: true, pro: true },
      { name: "Grafiki i zmianowka", basic: true, pro: true },
      { name: "Kartoteka klientow", basic: true, pro: true },
      { name: "Zarzadzanie uslugami i wariantami", basic: true, pro: true },
      { name: "Galeria zdjec salonu", basic: true, pro: true },
    ],
  },
  {
    category: "Rezerwacje i platnosci",
    features: [
      { name: "System rezerwacji online", basic: true, pro: true },
      { name: "Portal klienta z rezerwacja", basic: true, pro: true },
      { name: "Platnosci zadatkow (Stripe + Blik)", basic: true, pro: true },
      { name: "Powiadomienia SMS i email", basic: true, pro: true },
      { name: "System opinii i ocen", basic: true, pro: true },
    ],
  },
  {
    category: "Magazyn i finanse",
    features: [
      { name: "Magazyn produktow", basic: true, pro: true },
      { name: "Raporty i statystyki", basic: true, pro: true },
      { name: "Integracja z drukarka fiskalna", basic: true, pro: true },
      { name: "Faktury i paragony", basic: true, pro: true },
      { name: "Promocje i program lojalnosciowy", basic: true, pro: true },
    ],
  },
  {
    category: "Asystent AI",
    features: [
      { name: "Asystent glosowy (odbieranie polaczen)", basic: false, pro: true },
      { name: "Asystent biznesowy (analiza danych)", basic: false, pro: true },
      { name: "Asystent content (generowanie tresci)", basic: false, pro: true },
      { name: "Rekomendacje AI na dashboardzie", basic: false, pro: true },
      { name: "Analiza trendow i konkurencji", basic: false, pro: true },
    ],
  },
  {
    category: "Marketing AI",
    features: [
      { name: "Generowanie postow na social media", basic: false, pro: true },
      { name: "Generowanie opisow uslug", basic: false, pro: true },
      { name: "Tworzenie newsletterow", basic: false, pro: true },
      { name: "Widget planowania marketingowego", basic: false, pro: true },
      { name: "Proaktywne sugestie biznesowe", basic: false, pro: true },
    ],
  },
  {
    category: "Wsparcie",
    features: [
      { name: "Wsparcie email", basic: true, pro: true },
      { name: "Priorytetowe wsparcie techniczne", basic: false, pro: true },
    ],
  },
];

function FeatureAvailability({ available }: { available: boolean }) {
  if (available) {
    return (
      <div className="flex items-center justify-center">
        <Check className="h-5 w-5 text-green-600" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center">
      <X className="h-5 w-5 text-muted-foreground/40" />
    </div>
  );
}

export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/subscription-plans");
        if (!res.ok) throw new Error("Failed to fetch plans");
        const data = await res.json();
        if (data.success) {
          setPlans(data.data);
        } else {
          throw new Error(data.error || "Unknown error");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load plans");
      } finally {
        setLoading(false);
      }
    }
    fetchPlans();
  }, []);

  /**
   * Initiates the checkout flow for the given plan.
   * Redirects unauthenticated users to registration, then
   * calls the checkout API and navigates to the Stripe session
   * URL (or the dev-mode fallback redirect).
   */
  const handleCheckout = useCallback(
    async (planSlug: string) => {
      if (!session?.user) {
        // Not authenticated -- redirect to register with plan preselected
        router.push(`/register?plan=${planSlug}`);
        return;
      }

      setCheckoutLoading(planSlug);

      try {
        const res = await fetch("/api/subscriptions/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planSlug }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          toast.error(data.error || "Nie udalo sie rozpoczac platnosci");
          return;
        }

        // Navigate to the checkout URL (Stripe or dev fallback)
        if (data.url) {
          window.location.href = data.url;
        }
      } catch {
        toast.error("Wystapil blad podczas laczenia z systemem platnosci");
      } finally {
        setCheckoutLoading(null);
      }
    },
    [session, router],
  );

  const basicPlan = plans.find((p) => p.slug === "basic");
  const proPlan = plans.find((p) => p.slug === "pro");

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto text-center">
          <div className="animate-pulse space-y-8">
            <div className="h-10 bg-muted rounded w-64 mx-auto" />
            <div className="h-6 bg-muted rounded w-96 mx-auto" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
              <div className="h-96 bg-muted rounded-xl" />
              <div className="h-96 bg-muted rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto text-center space-y-4">
          <p className="text-destructive font-medium">{error}</p>
          <Button onClick={() => window.location.reload()}>Sprobuj ponownie</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center space-y-4 mb-12">
          <Badge variant="secondary" className="text-sm px-4 py-1">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Cennik
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Wybierz plan dla siebie
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Przystepna cenowo alternatywa dla Booksy. Zacznij od planu Basic i w
            dowolnym momencie przejdz na Pro z asystentem AI.
          </p>
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* Basic Plan */}
          {basicPlan && (
            <Card className="relative flex flex-col border-2 hover:shadow-lg transition-shadow">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950">
                    <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <CardTitle className="text-2xl">{basicPlan.name}</CardTitle>
                </div>
                <CardDescription className="text-base">
                  Pelne zarzadzanie salonem bez narzedzi AI. Idealny na start.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      {parseFloat(basicPlan.priceMonthly).toFixed(0)}
                    </span>
                    <span className="text-lg text-muted-foreground">
                      PLN / mies.
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Rozliczenie miesiecznie przez Stripe
                  </p>
                </div>

                <div className="space-y-3 flex-1">
                  {basicPlan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2.5">
                      <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <Button
                    className="w-full"
                    size="lg"
                    variant="outline"
                    disabled={checkoutLoading !== null}
                    onClick={() => handleCheckout("basic")}
                  >
                    {checkoutLoading === "basic" ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Przetwarzanie...
                      </>
                    ) : (
                      <>
                        Zacznij za darmo
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    14 dni okresu probnego bez zobowiazan
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Pro Plan */}
          {proPlan && (
            <Card className="relative flex flex-col border-2 border-primary hover:shadow-lg transition-shadow">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="px-4 py-1 text-sm shadow-sm">
                  <Star className="h-3.5 w-3.5 mr-1.5" />
                  Najpopularniejszy
                </Badge>
              </div>
              <CardHeader className="pb-4 pt-8">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">{proPlan.name}</CardTitle>
                </div>
                <CardDescription className="text-base">
                  Pelna funkcjonalnosc z asystentem AI glosowym, biznesowym i
                  content marketingowym.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">
                      {parseFloat(proPlan.priceMonthly).toFixed(0)}
                    </span>
                    <span className="text-lg text-muted-foreground">
                      PLN / mies.
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Rozliczenie miesiecznie przez Stripe
                  </p>
                </div>

                <div className="space-y-3 flex-1">
                  {proPlan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2.5">
                      <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <Button
                    className="w-full"
                    size="lg"
                    disabled={checkoutLoading !== null}
                    onClick={() => handleCheckout("pro")}
                  >
                    {checkoutLoading === "pro" ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Przetwarzanie...
                      </>
                    ) : (
                      <>
                        Wybierz Pro
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    14 dni okresu probnego bez zobowiazan
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
          <div className="flex flex-col items-center text-center p-4 rounded-lg border bg-card">
            <Calendar className="h-8 w-8 text-primary mb-2" />
            <span className="text-sm font-medium">Kalendarz</span>
            <span className="text-xs text-muted-foreground">i grafiki</span>
          </div>
          <div className="flex flex-col items-center text-center p-4 rounded-lg border bg-card">
            <Users className="h-8 w-8 text-primary mb-2" />
            <span className="text-sm font-medium">Rezerwacje</span>
            <span className="text-xs text-muted-foreground">online</span>
          </div>
          <div className="flex flex-col items-center text-center p-4 rounded-lg border bg-card">
            <BarChart3 className="h-8 w-8 text-primary mb-2" />
            <span className="text-sm font-medium">Raporty</span>
            <span className="text-xs text-muted-foreground">i statystyki</span>
          </div>
          <div className="flex flex-col items-center text-center p-4 rounded-lg border bg-card">
            <Bot className="h-8 w-8 text-primary mb-2" />
            <span className="text-sm font-medium">Asystent AI</span>
            <span className="text-xs text-muted-foreground">tylko Pro</span>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="mb-16">
          <div className="text-center space-y-3 mb-8">
            <h2 className="text-3xl font-bold">Porownanie planow</h2>
            <p className="text-muted-foreground">
              Szczegolowe porownanie funkcji dostepnych w kazdym planie
            </p>
          </div>

          <div className="rounded-xl border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-6 py-4 font-semibold text-sm min-w-[280px]">
                      Funkcja
                    </th>
                    <th className="text-center px-6 py-4 font-semibold text-sm w-32">
                      <div className="flex flex-col items-center gap-1">
                        <Zap className="h-4 w-4 text-blue-600" />
                        <span>Basic</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {basicPlan
                            ? `${parseFloat(basicPlan.priceMonthly).toFixed(0)} PLN/mies.`
                            : ""}
                        </span>
                      </div>
                    </th>
                    <th className="text-center px-6 py-4 font-semibold text-sm w-32">
                      <div className="flex flex-col items-center gap-1">
                        <Crown className="h-4 w-4 text-primary" />
                        <span>Pro</span>
                        <span className="text-xs text-muted-foreground font-normal">
                          {proPlan
                            ? `${parseFloat(proPlan.priceMonthly).toFixed(0)} PLN/mies.`
                            : ""}
                        </span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_FEATURES.map((category) => (
                    <React.Fragment key={`cat-${category.category}`}>
                      <tr
                        className="bg-muted/30"
                      >
                        <td
                          colSpan={3}
                          className="px-6 py-3 font-semibold text-sm flex items-center gap-2"
                        >
                          {category.category === "Asystent AI" && (
                            <Bot className="h-4 w-4 text-primary" />
                          )}
                          {category.category === "Marketing AI" && (
                            <Megaphone className="h-4 w-4 text-primary" />
                          )}
                          {category.category === "Rezerwacje i platnosci" && (
                            <Calendar className="h-4 w-4 text-primary" />
                          )}
                          {category.category === "Zarzadzanie salonem" && (
                            <Users className="h-4 w-4 text-primary" />
                          )}
                          {category.category === "Magazyn i finanse" && (
                            <BarChart3 className="h-4 w-4 text-primary" />
                          )}
                          {category.category === "Wsparcie" && (
                            <MessageSquare className="h-4 w-4 text-primary" />
                          )}
                          {category.category}
                        </td>
                      </tr>
                      {category.features.map((feature) => (
                        <tr
                          key={`feat-${feature.name}`}
                          className="border-t hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-6 py-3 text-sm">{feature.name}</td>
                          <td className="px-6 py-3">
                            <FeatureAvailability available={feature.basic} />
                          </td>
                          <td className="px-6 py-3">
                            <FeatureAvailability available={feature.pro} />
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="text-center space-y-6 py-12 border-t">
          <h2 className="text-2xl font-bold">
            Gotowy, zeby zaczac?
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Dolacz do grona salonow korzystajacych z MyHelper. Zacznij z
            14-dniowym okresem probnym - bez zobowiazan.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              variant="outline"
              disabled={checkoutLoading !== null}
              onClick={() => handleCheckout("basic")}
            >
              {checkoutLoading === "basic" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Zacznij z Basic
            </Button>
            <Button
              size="lg"
              disabled={checkoutLoading !== null}
              onClick={() => handleCheckout("pro")}
            >
              {checkoutLoading === "pro" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Wybierz Pro
              <Crown className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
