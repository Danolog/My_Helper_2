"use client";

import Link from "next/link";
import { ArrowLeft, Video } from "lucide-react";
import { TestimonialTemplate } from "@/components/content-generator/testimonial-template";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { Button } from "@/components/ui/button";

function TestimonialsContent() {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Video className="h-6 w-6 text-primary" />
            Szablony testimoniali wideo
          </h1>
          <p className="text-muted-foreground">
            AI generuje tekstowe scenariusze do nagrywania testimoniali klientow
          </p>
        </div>
      </div>

      <TestimonialTemplate />
    </div>
  );
}

export default function TestimonialsPage() {
  return (
    <ProPlanGate
      featureName="Szablony testimoniali wideo"
      featureDescription="AI tworzy profesjonalne scenariusze testimoniali wideo — pytania, wskazowki nagrywania i hashtagi dopasowane do Twojego salonu."
      proBenefits={[
        "Scenariusze testimoniali dla Instagram, TikTok, YouTube i Facebook",
        "Gotowe pytania prowadzace klienta przez doswiadczenie",
        "4 tony komunikacji do wyboru",
        "Wskazowki nagrywania (oswietlenie, kamera, tlo)",
        "Automatyczne hashtagi dopasowane do platformy",
        "Kopiowanie calego szablonu jednym kliknieciem",
      ]}
    >
      <TestimonialsContent />
    </ProPlanGate>
  );
}
