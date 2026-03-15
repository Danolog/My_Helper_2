"use client";

import { motion } from "framer-motion";

export function DlaSalonowImageBreak() {
  return (
    <section className="relative h-80 md:h-[500px] overflow-hidden">
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
  );
}
