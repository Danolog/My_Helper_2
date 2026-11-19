"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Scissors,
  Check,
  ArrowRight,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TRIAL_DAYS } from "@/lib/constants";
import { SOLD_PLAN_SLUG } from "@/lib/plan-catalog";
import { planHighlights } from "@/lib/plan-features";
import { planPriceText } from "@/lib/plan-price";

// Lista funkcji pochodzi z src/lib/plan-features.ts — tu nie wpisujemy
// własnych pozycji (pilnuje PlanFeaturesSingleSource.test.tsx). Nazwa i cena
// planu w sprzedaży pochodzą z /api/subscription-plans, jak na cenniku.
type Plan = {
  id: string;
  name: string;
  slug: string;
  priceMonthly: string;
  features: string[];
  isActive: boolean;
};

const LOAD_ERROR = "Nie udalo sie zaladowac planow cenowych. Sprobuj ponownie pozniej.";

export function DlaSalonowPricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchPlans() {
      try {
        const res = await fetch("/api/subscription-plans");
        if (!res.ok) throw new Error("Failed to fetch plans");
        const data = await res.json();
        if (data.success) {
          if (!cancelled) setPlans(data.data);
        } else {
          throw new Error(data.error || "Unknown error");
        }
      } catch {
        if (!cancelled) setError(LOAD_ERROR);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPlans();
    return () => {
      cancelled = true;
    };
  }, []);

  const soldPlan = plans.find((p) => p.slug === SOLD_PLAN_SLUG);

  return (
    <section id="pricing" className="bg-background relative py-24 md:py-32 overflow-hidden" aria-labelledby="pricing-heading">
      <div className="absolute inset-0 bg-gradient-to-b from-muted/30 to-background/20 -z-10" aria-hidden="true" />
      <div className="absolute top-[20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-[100px] -z-10" aria-hidden="true" />
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center mb-20"
        >
          <Badge variant="outline" className="text-sm px-5 py-2 mb-6 border-gold/40 text-gold-light">
            <Star className="h-4 w-4 mr-2" />
            Inwestycja w Rozwój
          </Badge>
          <h2 id="pricing-heading" className="font-[family-name:var(--font-playfair)] text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Jeden plan. Wszystkie funkcje w cenie, bez ukrytych kosztów.
          </h2>
          <p className="text-muted-foreground/90 max-w-xl mx-auto text-xl font-light">
            Przejrzyste zasady. {TRIAL_DAYS}-dniowy okres próbny.
          </p>
        </motion.div>

        <div className="max-w-md mx-auto">
          {loading ? (
            <div className="h-96 bg-muted rounded-xl animate-pulse" />
          ) : error || !soldPlan ? (
            <p className="text-destructive font-medium">{error ?? LOAD_ERROR}</p>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6 }}
            >
              <Card className="relative flex flex-col border-border/40 hover:border-primary/30 bg-card/60 dark:bg-card/80 backdrop-blur-xl hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:hover:shadow-[var(--shadow-warm-lg)] transition-all duration-500 h-full">
                <CardHeader className="pb-6 pt-10 px-8">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center" aria-hidden="true">
                      <Scissors className="h-6 w-6 text-foreground/70" />
                    </div>
                    <CardTitle className="font-[family-name:var(--font-playfair)] text-3xl">
                      {soldPlan.name}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col px-8 pb-10">
                  <div className="mb-8 border-b border-border/40 pb-8">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-bold" data-testid="plan-price">
                        {planPriceText(soldPlan.priceMonthly)}
                      </span>
                      <span className="text-base text-muted-foreground/80 font-light"> / mies.</span>
                    </div>
                  </div>
                  <div className="space-y-4 flex-1">
                    {planHighlights(SOLD_PLAN_SLUG, 5).map((feature) => (
                      <div key={feature} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span className="text-base font-light" data-testid="plan-feature">{feature}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-10">
                    <Button asChild className="w-full rounded-full shadow-[0_4px_15px_rgba(var(--primary),0.2)] hover:shadow-[0_6px_20px_rgba(var(--primary),0.3)] transition-all h-14 text-lg bg-primary text-primary-foreground" size="lg">
                      <Link href={`/register?plan=${SOLD_PLAN_SLUG}`}>
                        Zacznij za darmo
                        <ArrowRight className="h-5 w-5 ml-2" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>

        <div className="text-center mt-12">
          <Button asChild variant="link" className="text-base text-muted-foreground hover:text-foreground">
            <Link href="/pricing">
              Zobacz pełną listę funkcji
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
