"use client";

import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import {
  Scissors,
  Crown,
  Check,
  ArrowRight,
  Star,
  Search,
  CalendarCheck,
  Calendar,
  Users,
  BarChart3,
  Bot,
  Sparkles,
  Clock,
  Heart,
  Shield,
  MessageCircle,
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
import { cn } from "@/lib/utils";
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

const FEATURES = [
  {
    icon: Calendar,
    title: "Inteligentny kalendarz",
    description: "Zarzadzaj wizytami, grafikami pracownikow i dostepnoscia w jednym miejscu.",
    color: "rose" as const,
  },
  {
    icon: Users,
    title: "Kartoteka klientow",
    description: "Pelna historia wizyt, preferencje, notatki i automatyczne przypomnienia.",
    color: "sage" as const,
  },
  {
    icon: BarChart3,
    title: "Raporty i analityka",
    description: "Sledzenie przychodow, popularnosci uslug i efektywnosci pracownikow.",
    color: "gold" as const,
  },
  {
    icon: Bot,
    title: "Asystent AI",
    description: "Inteligentne rekomendacje, analiza biznesowa i generowanie tresci.",
    color: "rose" as const,
  },
  {
    icon: Shield,
    title: "Platnosci online",
    description: "Bezpieczne platnosci zadatkow przez Stripe i rezerwacje online 24/7.",
    color: "sage" as const,
  },
  {
    icon: Heart,
    title: "Program lojalnosciowy",
    description: "Buduj relacje z klientami przez system punktow, promocje i prezenty.",
    color: "gold" as const,
  },
] as const;

const TRUST_STATS = [
  { value: "30+", label: "Funkcji" },
  { value: "AI", label: "Asystent glosowy" },
  { value: "24/7", label: "Rezerwacje online" },
  { value: "100%", label: "Polski produkt" },
] as const;

const TESTIMONIALS = [
  {
    name: "Tester Beta",
    role: "Wlascicielka salonu fryzjerskiego",
    quote: "MyHelper to swietne narzedzie do zarzadzania salonem. Rezerwacje online i kalendarz pracownikow dzialaja bezblednie.",
    rating: 5,
  },
  {
    name: "Tester Beta",
    role: "Kosmetyczka",
    quote: "Asystent AI pomaga planowac promocje i tworzyc posty na social media. Duza oszczednosc czasu.",
    rating: 5,
  },
  {
    name: "Tester Beta",
    role: "Wlascicielka SPA",
    quote: "Konkurencyjna cena w porownaniu z innymi rozwiazaniami na rynku, a funkcjonalnosc na wysokim poziomie.",
    rating: 5,
  },
] as const;

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
    <div className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden min-h-[90vh] flex items-center" aria-label="Strona glowna MyHelper">
        {/* Warm background matching design system */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-card to-background overflow-hidden" aria-hidden="true">
          <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-primary/[0.04] dark:bg-primary/[0.08] blur-[100px]" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-gold/[0.06] dark:bg-gold/[0.10] blur-[80px]" />
        </div>

        <div className="container mx-auto px-4 pt-20 pb-24 md:pt-32 md:pb-32 relative z-10">
          <div className="max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full border border-primary/30 bg-primary/5 text-sm text-primary mb-10 shadow-[0_0_15px_rgba(var(--primary),0.1)] backdrop-blur-md"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium tracking-wide">Alternatywa Premium dla Booksy z AI</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
              className="font-[family-name:var(--font-playfair)] text-4xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-9xl font-bold tracking-tight leading-[1] mb-8"
            >
              Twój Salon,<br />
              znacznie więcej
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              className="text-lg md:text-2xl text-muted-foreground/90 max-w-3xl mx-auto mb-12 leading-relaxed font-light"
            >
              Zarządzaj salonem z niespotykaną elegancją. Rezerwacje online, inteligentny kalendarz,
              asystent AI i luksusowe doświadczenie dla Twoich klientów.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
              className="flex flex-col sm:flex-row items-center justify-center gap-5 mb-20"
            >
              <Button asChild size="lg" className="h-14 px-10 text-lg rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.2)] hover:-translate-y-1 transition-all bg-primary text-primary-foreground">
                <Link href="/register">
                  Zacznij za darmo
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-14 px-10 text-lg rounded-full border-border/80 hover:bg-primary/5 hover:text-primary transition-all backdrop-blur-sm">
                <Link href="/salons">
                  <Search className="h-5 w-5 mr-2" />
                  Przeglądaj salony
                </Link>
              </Button>
            </motion.div>

            {/* Hero Illustration — Dashboard Mockup */}
            <div className="relative max-w-3xl mx-auto">
              <div className="aspect-[16/9] rounded-3xl bg-gradient-to-br from-primary/[0.07] via-primary/[0.03] to-gold/[0.06] border border-primary/10 overflow-hidden relative shadow-[var(--shadow-warm-xl)]">
                <div className="absolute top-[-20%] right-[-15%] w-[50%] h-[70%] rounded-full bg-primary/[0.08] blur-[80px]" aria-hidden="true" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[40%] h-[60%] rounded-full bg-gold/[0.10] blur-[60px]" aria-hidden="true" />
                <div className="absolute inset-0 flex items-center justify-center p-6 md:p-10">
                  <div className="relative w-full max-w-md">
                    {/* Calendar card */}
                    <div className="bg-card/90 backdrop-blur-sm rounded-2xl shadow-[var(--shadow-warm-lg)] border border-border/30 p-5 md:p-6">
                      <div className="flex items-center gap-2.5 mb-4">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Calendar className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">Kalendarz wizyt</div>
                          <div className="text-xs text-muted-foreground">Luty 2026</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-7 gap-1.5">
                        {["Pn","Wt","Śr","Cz","Pt","Sb","Nd"].map((d) => (
                          <div key={d} className="text-[10px] text-center text-muted-foreground/60 pb-1 font-medium">{d}</div>
                        ))}
                        {Array.from({ length: 28 }, (_, i) => {
                          const hasAppt = [3, 8, 10, 15, 17, 22].includes(i);
                          const isToday = i === 12;
                          return (
                            <div
                              key={i}
                              className={cn(
                                "aspect-square rounded-md flex flex-col items-center justify-center text-[10px]",
                                isToday && "bg-primary text-primary-foreground font-bold",
                                hasAppt && !isToday && "bg-primary/10 text-primary font-medium",
                                !hasAppt && !isToday && "text-muted-foreground/40"
                              )}
                            >
                              <span>{i + 1}</span>
                              {hasAppt && !isToday && <div className="w-1 h-1 rounded-full bg-primary mt-0.5" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* Stats floating card */}
                    <div className="absolute -right-4 md:-right-12 top-2 md:top-4 bg-card/90 backdrop-blur-sm border border-border/30 rounded-xl p-3 md:p-4 shadow-[var(--shadow-warm-md)]">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <CalendarCheck className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">+340 wizyt</div>
                          <div className="text-xs text-muted-foreground">w tym tygodniu</div>
                        </div>
                      </div>
                    </div>
                    {/* Rating floating card */}
                    <div className="absolute -left-4 md:-left-12 -bottom-2 md:-bottom-4 bg-card/90 backdrop-blur-sm border border-border/30 rounded-xl p-3 md:p-4 shadow-[var(--shadow-warm-md)]">
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <Star key={i} className="h-3.5 w-3.5 fill-gold text-gold" />
                          ))}
                        </div>
                        <span className="text-sm font-semibold">4.9</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Od naszych klientow</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="border-y bg-muted/30 dark:bg-muted/50 dark:border-y-border/20">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {TRUST_STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-bold text-primary">
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-4 py-20 md:py-28" aria-labelledby="features-heading">
        <div className="text-center mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <Badge variant="outline" className="text-sm px-5 py-2 mb-6 border-primary/20 text-primary">
              <Sparkles className="h-4 w-4 mr-2" />
              Ekskluzywne Funkcje
            </Badge>
            <h2 id="features-heading" className="font-[family-name:var(--font-playfair)] text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Wszystko czego potrzebujesz
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-xl font-light">
              Kompleksowe narzędzie do zarządzania luksusowym salonem —
              od intuicyjnych rezerwacji po zaawansowaną analitykę i AI.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            const colorMap = {
              rose: "bg-gradient-to-br from-primary/20 to-primary/5 group-hover:from-primary/30 group-hover:to-primary/10",
              sage: "bg-gradient-to-br from-sage/20 to-sage/5 group-hover:from-sage/30 group-hover:to-sage/10",
              gold: "bg-gradient-to-br from-gold/20 to-gold/5 group-hover:from-gold/30 group-hover:to-gold/10",
            };
            const iconColorMap = {
              rose: "text-primary group-hover:text-primary/80",
              sage: "text-sage group-hover:text-sage-light",
              gold: "text-gold group-hover:text-gold-light",
            };
            return (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Card
                  className="group relative overflow-hidden bg-card/50 dark:bg-card/80 backdrop-blur-xl border-border/40 hover:border-primary/40 hover:shadow-[var(--shadow-warm-lg)] transition-all duration-500 h-full"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/0 dark:from-white/5 dark:to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" aria-hidden="true" />
                  <CardHeader className="pb-4 relative z-10">
                    <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-all duration-500 group-hover:scale-110", colorMap[feature.color])} aria-hidden="true">
                      <Icon className={cn("h-6 w-6 transition-colors duration-500", iconColorMap[feature.color])} />
                    </div>
                    <CardTitle className="font-[family-name:var(--font-playfair)] text-2xl font-semibold">
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="relative z-10">
                    <p className="text-base text-muted-foreground leading-relaxed font-light">
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Image break */}
      <section className="relative h-80 md:h-[500px] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <motion.img
          initial={{ scale: 1.1 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          src="/salon-stylist.jpg"
          alt="Stylista pracujacy w salonie fryzjerskim"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
        <div className="absolute inset-0 flex items-center">
          <div className="container mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className="max-w-xl"
            >
              <h3 className="font-[family-name:var(--font-playfair)] text-4xl md:text-5xl font-bold mb-4 leading-tight">
                Zaprojektowane dla profesjonalistów
              </h3>
              <p className="text-muted-foreground text-xl font-light leading-relaxed">
                Stworzone z myślą o fryzjerach, kosmetyczkach i wszystkich specjalistach branży beauty poszukujących bezkompromisowej jakości.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Client CTA */}
      <section className="container mx-auto px-4 py-24" aria-labelledby="client-heading">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <Card className="border-border/40 bg-card/40 backdrop-blur-xl max-w-3xl mx-auto shadow-[0_8px_30px_rgb(0,0,0,0.06)] overflow-hidden relative group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
            <CardHeader className="text-center pb-4 relative z-10 pt-10">
              <div className="flex items-center justify-center gap-3 mb-6" aria-hidden="true">
                <div className="p-3 rounded-full bg-primary/10">
                  <Search className="h-6 w-6 text-primary" />
                </div>
                <div className="p-3 rounded-full bg-primary/10">
                  <CalendarCheck className="h-6 w-6 text-primary" />
                </div>
              </div>
              <CardTitle id="client-heading" className="font-[family-name:var(--font-playfair)] text-4xl font-bold">
                Szukasz salonu?
              </CardTitle>
              <CardDescription className="text-lg mt-3 font-light text-muted-foreground/90">
                Przeglądaj ekskluzywne salony, rezerwuj wizyty i zarządzaj swoim czasem z klasą.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 pb-10 relative z-10">
              <Button asChild size="lg" className="rounded-full h-12 px-8 bg-foreground text-background hover:bg-foreground/90">
                <Link href="/salons">
                  Przeglądaj salony
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="rounded-full h-12 px-8 border-border/80">
                <Link href="/portal/login">
                  Zaloguj się
                </Link>
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </section>

      {/* Pricing */}
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

      {/* Testimonials */}
      <section className="container mx-auto px-4 py-24 md:py-32" aria-labelledby="testimonials-heading">
        <div className="text-center mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
          >
            <Badge variant="outline" className="text-sm px-5 py-2 mb-6 border-primary/20 text-primary">
              <MessageCircle className="h-4 w-4 mr-2" aria-hidden="true" />
              Opinie
            </Badge>
            <h2 id="testimonials-heading" className="font-[family-name:var(--font-playfair)] text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Co mówią nasi klienci
            </h2>
            <p className="text-muted-foreground/90 max-w-2xl mx-auto text-xl font-light">
              Dołącz do grona zadowolonych właścicieli salonów premium.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {TESTIMONIALS.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: index * 0.15 }}
            >
              <Card className="border-border/40 bg-card/60 backdrop-blur-sm hover:-translate-y-2 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08)] transition-all duration-500 h-full">
                <CardContent className="pt-10 px-8 pb-8 flex flex-col h-full">
                  <div className="flex gap-1 mb-6">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <Star key={i} className="h-5 w-5 fill-gold-light text-gold-light" />
                    ))}
                  </div>
                  <p className="text-lg text-foreground/80 leading-relaxed mb-8 italic font-light flex-1">
                    &ldquo;{testimonial.quote}&rdquo;
                  </p>
                  <div className="pt-6 border-t border-border/40">
                    <div className="font-semibold text-base mb-1">{testimonial.name}</div>
                    <div className="text-sm text-primary/80">{testimonial.role}</div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden" aria-label="Zacheta do rejestracji">
        <div
          className="absolute inset-0 -z-10"
          aria-hidden="true"
          style={{
            background: `
              radial-gradient(ellipse 70% 50% at 30% 50%, oklch(0.60 0.12 45 / 6%) 0%, transparent 70%),
              radial-gradient(ellipse 60% 40% at 70% 60%, oklch(0.73 0.14 80 / 8%) 0%, transparent 60%)
            `,
          }}
        />
        <div className="container mx-auto px-4 py-28 md:py-36 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <Clock className="h-10 w-10 text-primary mx-auto mb-8" />
            <h2 className="font-[family-name:var(--font-playfair)] text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Gotowy na zmianę?
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-xl font-light mb-12">
              Dołącz do setek salonów, które już wzmocniły swój wizerunek.
              14 dni za darmo, bez zobowiązań.
            </p>
            <Button asChild size="lg" className="h-16 px-12 text-lg rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.18)] hover:-translate-y-1 transition-all">
              <Link href="/register">
                Rozpocznij ekskluzywny dostęp
                <ArrowRight className="h-5 w-5 ml-2" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>
    </div>
    </MotionConfig>
  );
}
