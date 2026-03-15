"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Scissors,
  Crown,
  Check,
  ArrowRight,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLANS, TRIAL_DAYS } from "@/lib/constants";

const PLANS_PREVIEW = {
  basic: {
    name: PLANS.basic.name,
    price: PLANS.basic.priceMonthly,
    description:
      "Pelne zarzadzanie salonem bez narzedzi AI. Idealny na start.",
    features: [
      "Kalendarz pracownikow i grafiki",
      "Rezerwacje online i platnosci",
      "Kartoteka klientow",
      "Raporty i statystyki",
      "Powiadomienia SMS i email",
    ],
  },
  pro: {
    name: PLANS.pro.name,
    price: PLANS.pro.priceMonthly,
    description:
      "Pelna funkcjonalnosc z asystentem AI glosowym, biznesowym i content marketingowym.",
    features: [
      "Wszystko z planu Basic",
      "Asystent glosowy AI",
      "Asystent biznesowy AI",
      "Generowanie tresci marketingowych",
      "Proaktywne sugestie i analizy",
    ],
  },
} as const;

export function DlaSalonowPricing() {
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
            Wybierz odpowiedni pakiet
          </h2>
          <p className="text-muted-foreground/90 max-w-xl mx-auto text-xl font-light">
            Przejrzyste zasady. {TRIAL_DAYS}-dniowy okres próbny.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
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
                    {PLANS_PREVIEW.basic.name}
                  </CardTitle>
                </div>
                <CardDescription className="text-base font-light">{PLANS_PREVIEW.basic.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col px-8 pb-10">
                <div className="mb-8 border-b border-border/40 pb-8">
                  <div className="flex items-baseline gap-2">
                    <span className="font-[family-name:var(--font-playfair)] text-6xl font-bold">{PLANS_PREVIEW.basic.price}</span>
                    <span className="text-base text-muted-foreground/80 font-light">PLN / mies.</span>
                  </div>
                </div>
                <div className="space-y-4 flex-1">
                  {PLANS_PREVIEW.basic.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-base font-light">{feature}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-10">
                  <Button asChild className="w-full rounded-full h-14 text-lg bg-foreground/5 hover:bg-foreground/10 text-foreground border border-border/60 box-border" variant="ghost">
                    <Link href="/register?plan=basic">
                      Zacznij za darmo
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="relative flex flex-col border border-primary/30 hover:border-primary/60 bg-gradient-to-b from-card to-card/60 dark:from-card/90 dark:to-card/70 backdrop-blur-xl hover:shadow-[0_8px_40px_rgba(var(--gold),0.15)] dark:hover:shadow-[var(--shadow-warm-lg)] transition-all duration-500 h-full overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40" />
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                <Badge variant="default" className="px-5 py-1.5 text-sm shadow-md rounded-full bg-primary hover:bg-primary/80 text-primary-foreground border-none">
                  <Star className="h-4 w-4 mr-2 fill-background" />
                  Najczęstszy Wybór
                </Badge>
              </div>
              <CardHeader className="pb-6 pt-12 px-8 relative z-10">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center" aria-hidden="true">
                    <Crown className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="font-[family-name:var(--font-playfair)] text-3xl">
                    {PLANS_PREVIEW.pro.name}
                  </CardTitle>
                </div>
                <CardDescription className="text-base font-light text-muted-foreground/90">{PLANS_PREVIEW.pro.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col px-8 pb-10 relative z-10">
                <div className="mb-8 border-b border-border/40 pb-8">
                  <div className="flex items-baseline gap-2">
                    <span className="font-[family-name:var(--font-playfair)] text-6xl font-bold">{PLANS_PREVIEW.pro.price}</span>
                    <span className="text-base text-muted-foreground/80 font-light">PLN / mies.</span>
                  </div>
                </div>
                <div className="space-y-4 flex-1">
                  {PLANS_PREVIEW.pro.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-base font-light">{feature}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-10">
                  <Button asChild className="w-full rounded-full shadow-[0_4px_15px_rgba(var(--primary),0.2)] hover:shadow-[0_6px_20px_rgba(var(--primary),0.3)] transition-all h-14 text-lg bg-primary text-primary-foreground" size="lg">
                    <Link href="/register?plan=pro">
                      Wybierz Pro
                      <ArrowRight className="h-5 w-5 ml-2" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="text-center mt-12">
          <Button asChild variant="link" className="text-base text-muted-foreground hover:text-foreground">
            <Link href="/pricing">
              Szczegółowe porównanie planów
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
