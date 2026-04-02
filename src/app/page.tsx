"use client";

import Link from "next/link";
import { Scissors, Search } from "lucide-react";
import { motion, MotionConfig } from "framer-motion";

export default function RoleSelector() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
        {/* Background */}
        <div
          className="from-card to-background absolute inset-0 -z-10 bg-gradient-to-b"
          aria-hidden="true"
        >
          <div className="bg-primary/[0.04] dark:bg-primary/[0.08] absolute top-[-10%] right-[-5%] h-[500px] w-[500px] rounded-full blur-[100px]" />
          <div className="bg-gold/[0.06] dark:bg-gold/[0.10] absolute bottom-[-10%] left-[-5%] h-[400px] w-[400px] rounded-full blur-[80px]" />
        </div>

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-12 flex items-center gap-2.5"
        >
          <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-xl">
            <Scissors className="text-primary h-5 w-5" />
          </div>
          <span className="text-gradient-rose font-[family-name:var(--font-playfair)] text-3xl font-bold tracking-tight">
            MyHelper
          </span>
        </motion.div>

        {/* Cards */}
        <div className="grid w-full max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <Link
              href="/dla-salonow"
              className="group border-border/40 bg-card/60 hover:border-primary/40 block rounded-3xl border p-8 text-center backdrop-blur-xl transition-all duration-500 hover:shadow-[var(--shadow-warm-lg)]"
            >
              <div className="bg-primary/10 group-hover:bg-primary/20 mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-500 group-hover:scale-110">
                <Scissors className="text-primary h-8 w-8" />
              </div>
              <h2 className="mb-2 font-[family-name:var(--font-playfair)] text-2xl font-bold">
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
              className="group border-border/40 bg-card/60 hover:border-primary/40 block rounded-3xl border p-8 text-center backdrop-blur-xl transition-all duration-500 hover:shadow-[var(--shadow-warm-lg)]"
            >
              <div className="bg-primary/10 group-hover:bg-primary/20 mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-500 group-hover:scale-110">
                <Search className="text-primary h-8 w-8" />
              </div>
              <h2 className="mb-2 font-[family-name:var(--font-playfair)] text-2xl font-bold">
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
            className="text-muted-foreground hover:text-primary text-sm transition-colors"
          >
            Mam konto — zaloguj się
          </Link>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
