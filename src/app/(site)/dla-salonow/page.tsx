"use client";

import { MotionConfig } from "framer-motion";
import { DlaSalonowClientCta } from "./_components/DlaSalonowClientCta";
import { DlaSalonowCta } from "./_components/DlaSalonowCta";
import { DlaSalonowFeatures } from "./_components/DlaSalonowFeatures";
import { DlaSalonowHero } from "./_components/DlaSalonowHero";
import { DlaSalonowImageBreak } from "./_components/DlaSalonowImageBreak";
import { DlaSalonowPricing } from "./_components/DlaSalonowPricing";
import { DlaSalonowTestimonials } from "./_components/DlaSalonowTestimonials";
import { DlaSalonowTrustBar } from "./_components/DlaSalonowTrustBar";

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
    <div className="flex-1">
      <DlaSalonowHero />
      <DlaSalonowTrustBar />
      <DlaSalonowFeatures />
      <DlaSalonowImageBreak />
      <DlaSalonowClientCta />
      <DlaSalonowPricing />
      <DlaSalonowTestimonials />
      <DlaSalonowCta />
    </div>
    </MotionConfig>
  );
}
