"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function DlaSalonowCta() {
  return (
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
  );
}
