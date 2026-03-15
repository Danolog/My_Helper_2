"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  Sparkles,
  ArrowRight,
  Search,
  Star,
  CalendarCheck,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DlaSalonowHero() {
  return (
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
  );
}
