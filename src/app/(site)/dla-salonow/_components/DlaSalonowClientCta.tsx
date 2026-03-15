"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Search,
  CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DlaSalonowClientCta() {
  return (
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
              <Link href="/dla-klientow">
                Portal klienta
              </Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </section>
  );
}
