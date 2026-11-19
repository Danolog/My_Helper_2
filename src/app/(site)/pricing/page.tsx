"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Zap,
  Calendar,
  Users,
  BarChart3,
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
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { TRIAL_DAYS } from "@/lib/constants";
import { SOLD_PLAN_SLUG } from "@/lib/plan-catalog";
import { PLAN_SUMMARY, featuresFor } from "@/lib/plan-features";
import { planPriceText } from "@/lib/plan-price";

type Plan = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

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
        setError("Nie udalo sie zaladowac planow cenowych. Sprobuj ponownie pozniej.");
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
        const res = await mutationFetch("/api/subscriptions/checkout", {
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

  const soldPlan = plans.find((p) => p.slug === SOLD_PLAN_SLUG);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto text-center">
          <div className="animate-pulse space-y-8">
            <div className="h-10 bg-muted rounded w-64 mx-auto" />
            <div className="h-6 bg-muted rounded w-96 mx-auto" />
            <div className="max-w-md mx-auto mt-12">
              <div className="h-96 bg-muted rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !soldPlan) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto text-center space-y-4">
          <p className="text-destructive font-medium">
            {error ?? "Nie udalo sie zaladowac planow cenowych. Sprobuj ponownie pozniej."}
          </p>
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
            Jeden plan. Wszystkie funkcje w cenie, bez ukrytych kosztów.
          </h1>
        </div>

        {/* Plan Card */}
        <div className="max-w-md mx-auto mb-16">
          <Card className="relative flex flex-col border-2 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950">
                  <Zap className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle className="text-2xl">{soldPlan.name}</CardTitle>
              </div>
              <CardDescription className="text-base">
                {PLAN_SUMMARY.basic}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold" data-testid="plan-price">
                    {planPriceText(soldPlan.priceMonthly)}
                  </span>
                  <span className="text-lg text-muted-foreground"> / mies.</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Rozliczenie miesiecznie przez Stripe
                </p>
              </div>

              <div className="space-y-3 flex-1">
                {featuresFor(soldPlan.slug, soldPlan.features).map((feature, idx) => (
                  <div key={idx} className="flex items-start gap-2.5">
                    <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                    <span className="text-sm" data-testid="plan-feature">{feature}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <Button
                  className="w-full"
                  size="lg"
                  disabled={checkoutLoading !== null}
                  onClick={() => handleCheckout(SOLD_PLAN_SLUG)}
                >
                  {checkoutLoading === SOLD_PLAN_SLUG ? (
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
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-16">
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
        </div>

        {/* CTA Section */}
        <div className="text-center space-y-6 py-12 border-t">
          <h2 className="text-2xl font-bold">
            Gotowy, zeby zaczac?
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Dolacz do grona salonow korzystajacych z MyHelper. Zacznij z
            {TRIAL_DAYS}-dniowym okresem probnym - bez zobowiazan.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              disabled={checkoutLoading !== null}
              onClick={() => handleCheckout(SOLD_PLAN_SLUG)}
            >
              {checkoutLoading === SOLD_PLAN_SLUG ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Zacznij {TRIAL_DAYS} dni za darmo
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
