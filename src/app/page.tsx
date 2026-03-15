"use client";

import Link from "next/link";
import { Scissors, Search } from "lucide-react";
import { motion, MotionConfig } from "framer-motion";

export default function RoleSelector() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
        {/* Background */}
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-b from-card to-background"
          aria-hidden="true"
        >
          <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-primary/[0.04] dark:bg-primary/[0.08] blur-[100px]" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-gold/[0.06] dark:bg-gold/[0.10] blur-[80px]" />
        </div>

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-2.5 mb-12"
        >
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
            <Scissors className="h-5 w-5 text-primary" />
          </div>
          <span className="font-[family-name:var(--font-playfair)] text-3xl font-bold tracking-tight text-gradient-rose">
            MyHelper
          </span>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl w-full">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <Link
              href="/dla-salonow"
              className="group block rounded-3xl border border-border/40 bg-card/60 backdrop-blur-xl p-8 text-center hover:border-primary/40 hover:shadow-[var(--shadow-warm-lg)] transition-all duration-500"
            >
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-500">
                <Scissors className="h-8 w-8 text-primary" />
              </div>
              <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold mb-2">
                Prowadzę salon
              </h2>
              <p className="text-muted-foreground text-sm font-light">
                Zarządzaj wizytami, zespołem i klientami
              </p>
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Link
              href="/dla-klientow"
              className="group block rounded-3xl border border-border/40 bg-card/60 backdrop-blur-xl p-8 text-center hover:border-primary/40 hover:shadow-[var(--shadow-warm-lg)] transition-all duration-500"
            >
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-500">
                <Search className="h-8 w-8 text-primary" />
              </div>
              <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold mb-2">
                Szukam salonu
              </h2>
              <p className="text-muted-foreground text-sm font-light">
                Znajdź salon i zarezerwuj wizytę online
              </p>
            </Link>
          </motion.div>
        </div>

        {/* Login link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-10"
        >
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            Mam konto — zaloguj się
          </Link>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
