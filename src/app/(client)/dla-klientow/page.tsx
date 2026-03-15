"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import {
  Search,
  CalendarCheck,
  Star,
  ArrowRight,
  MapPin,
  Sparkles,
  Clock,
  Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SalonPreview {
  id: string;
  name: string;
  address: string | null;
  industryType: string | null;
  serviceCount?: number;
  averageRating?: number | null;
  reviewCount?: number;
}

const STEPS = [
  {
    icon: Search,
    title: "Znajdź salon",
    description: "Przeglądaj salony w Twojej okolicy i sprawdź dostępne usługi.",
  },
  {
    icon: CalendarCheck,
    title: "Wybierz usługę i termin",
    description: "Wybierz pracownika, datę i godzinę — bez dzwonienia.",
  },
  {
    icon: Star,
    title: "Zarezerwuj online",
    description: "Potwierdź wizytę jednym kliknięciem. Możesz rezerwować bez konta.",
  },
] as const;

export default function DlaKlientowPage() {
  const [salons, setSalons] = useState<SalonPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const abortController = new AbortController();
    async function fetchSalons() {
      try {
        const res = await fetch("/api/salons?limit=6", {
          signal: abortController.signal,
        });
        const json = await res.json();
        if (json.success && json.data) {
          setSalons(json.data.slice(0, 6));
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    }
    fetchSalons();
    return () => abortController.abort();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden py-20 md:py-32">
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-card to-background overflow-hidden" aria-hidden="true">
            <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] rounded-full bg-primary/[0.04] dark:bg-primary/[0.08] blur-[100px]" />
            <div className="absolute bottom-[-10%] left-[-5%] w-[300px] h-[300px] rounded-full bg-gold/[0.06] dark:bg-gold/[0.10] blur-[80px]" />
          </div>
          <div className="container mx-auto px-4 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Badge variant="outline" className="text-sm px-5 py-2 mb-8 border-primary/30 text-primary">
                <Heart className="h-4 w-4 mr-2" />
                Portal klienta
              </Badge>
              <h1 className="font-[family-name:var(--font-playfair)] text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
                Znajdź idealny salon
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 font-light">
                Przeglądaj salony, rezerwuj wizyty online i zarządzaj swoim czasem.
                Bez zakładania konta — wystarczy imię i telefon.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button asChild size="lg" className="h-14 px-10 text-lg rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.2)] hover:-translate-y-1 transition-all">
                  <Link href="/salons">
                    <Search className="h-5 w-5 mr-2" />
                    Przeglądaj salony
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-14 px-10 text-lg rounded-full">
                  <Link href="/portal/login">
                    Zaloguj się
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-y bg-muted/30 py-20">
          <div className="container mx-auto px-4">
            <div className="text-center mb-14">
              <h2 className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-bold mb-4">
                Jak to działa?
              </h2>
              <p className="text-muted-foreground text-lg font-light">
                Trzy proste kroki do Twojej idealnej wizyty.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-50px" }}
                    transition={{ duration: 0.5, delay: index * 0.15 }}
                    className="text-center"
                  >
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
                      <Icon className="h-7 w-7 text-primary" />
                    </div>
                    <div className="text-sm font-medium text-primary mb-2">
                      Krok {index + 1}
                    </div>
                    <h3 className="font-[family-name:var(--font-playfair)] text-xl font-semibold mb-2">
                      {step.title}
                    </h3>
                    <p className="text-muted-foreground text-sm font-light">
                      {step.description}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Popular salons */}
        {salons.length > 0 && (
          <section className="container mx-auto px-4 py-20">
            <div className="text-center mb-14">
              <Badge variant="outline" className="text-sm px-5 py-2 mb-6 border-primary/20 text-primary">
                <Sparkles className="h-4 w-4 mr-2" />
                Popularne
              </Badge>
              <h2 className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-bold mb-4">
                Popularne salony
              </h2>
              <p className="text-muted-foreground text-lg font-light">
                Odkryj najlepsze salony w Twojej okolicy.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {salons.map((salon, index) => (
                <motion.div
                  key={salon.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                >
                  <Link href={`/salons/${salon.id}`}>
                    <Card className="group hover:border-primary/40 hover:shadow-lg transition-all duration-300 h-full cursor-pointer">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg font-semibold group-hover:text-primary transition-colors">
                          {salon.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {salon.address && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{salon.address}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {salon.averageRating && (
                            <div className="flex items-center gap-1">
                              <Star className="h-3.5 w-3.5 fill-gold text-gold" />
                              <span>{Number(salon.averageRating).toFixed(1)}</span>
                            </div>
                          )}
                          {salon.serviceCount && salon.serviceCount > 0 && (
                            <div className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              <span>{salon.serviceCount} usług</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
            <div className="text-center mt-10">
              <Button asChild variant="outline" size="lg" className="rounded-full">
                <Link href="/salons">
                  Zobacz wszystkie salony
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
          </section>
        )}

        {loading && (
          <section className="container mx-auto px-4 py-20">
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="bg-muted/20 py-20">
          <div className="container mx-auto px-4 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-bold mb-4">
                Gotowy na wizytę?
              </h2>
              <p className="text-muted-foreground text-lg font-light mb-8 max-w-xl mx-auto">
                Przeglądaj salony i zarezerwuj termin online. Możesz też założyć konto, aby śledzić swoje wizyty.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button asChild size="lg" className="rounded-full h-12 px-8">
                  <Link href="/salons">
                    Przeglądaj salony
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-full h-12 px-8">
                  <Link href="/portal/register">
                    Załóż konto klienta
                  </Link>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </MotionConfig>
  );
}
