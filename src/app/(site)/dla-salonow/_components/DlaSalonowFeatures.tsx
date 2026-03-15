"use client";

import { motion } from "framer-motion";
import {
  Calendar,
  Users,
  BarChart3,
  Bot,
  Shield,
  Heart,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

export function DlaSalonowFeatures() {
  return (
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
  );
}
