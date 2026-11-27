"use client";

import { MotionConfig } from "framer-motion";
import { DlaSalonowCta } from "./dla-salonow/_components/DlaSalonowCta";
import { DlaSalonowFeatures } from "./dla-salonow/_components/DlaSalonowFeatures";
import { DlaSalonowHero } from "./dla-salonow/_components/DlaSalonowHero";
import { DlaSalonowImageBreak } from "./dla-salonow/_components/DlaSalonowImageBreak";
import { DlaSalonowPricing } from "./dla-salonow/_components/DlaSalonowPricing";
import { DlaSalonowTrustBar } from "./dla-salonow/_components/DlaSalonowTrustBar";

/**
 * Strona główna `/` — strona sprzedażowa dla właścicieli salonów. Bez wyboru
 * roli i bez sekcji dla klientów: katalog salonów jest zamrożony
 * (`salonCatalog` w src/lib/features.ts), a klient wchodzi na stronę salonu
 * z linku od salonu. Dawny adres `/dla-salonow` przekierowuje tutaj.
 */
export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex-1">
        <DlaSalonowHero />
        <DlaSalonowTrustBar />
        <DlaSalonowFeatures />
        <DlaSalonowImageBreak />
        <DlaSalonowPricing />
        <DlaSalonowCta />
      </div>
    </MotionConfig>
  );
}
