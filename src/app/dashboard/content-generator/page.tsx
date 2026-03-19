"use client";

import Link from "next/link";
import { ArrowLeft, PenTool, Instagram, Mail, FileText, ArrowRight, BookOpen, CalendarClock, Clapperboard, Video, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";

function ContentGeneratorContent() {
  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PenTool className="h-6 w-6 text-primary" />
            Generator tresci
          </h1>
          <p className="text-muted-foreground">
            Tworzenie tresci marketingowych z pomoca AI
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/dashboard/content-generator/social-posts"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <Instagram className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Posty social media
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Generowanie angazujacych postow na Instagram, Facebook i TikTok
          </p>
        </Link>
        <div className="p-6 border rounded-lg space-y-3">
          <FileText className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Opisy uslug</h3>
          <p className="text-sm text-muted-foreground">
            Profesjonalne opisy uslug przyciagajace nowych klientow
          </p>
        </div>
        <Link
          href="/dashboard/content-generator/newsletters"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <Mail className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Newslettery
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Tworzenie newsletterow promocyjnych i informacyjnych
          </p>
        </Link>
        <Link
          href="/dashboard/content-generator/templates"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <BookOpen className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Szablony tresci
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Gotowe szablony do szybkiego tworzenia tresci
          </p>
        </Link>
        <Link
          href="/dashboard/content-generator/social-posts#video"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <Clapperboard className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Klipy wideo AI
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Krotkie klipy promocyjne 4-8 sekund generowane przez Veo 3.1
          </p>
        </Link>
        <Link
          href="/dashboard/content-generator/social-posts#stories"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <Smartphone className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Animowane Stories
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Animowane story 9:16 z szablonami i zdjeciami z galerii
          </p>
        </Link>
        <Link
          href="/dashboard/content-generator/testimonials"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <Video className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Testimoniale wideo
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Scenariusze testimoniali wideo z pytaniami i wskazowkami
          </p>
        </Link>
        <Link
          href="/dashboard/content-generator/scheduled"
          className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
        >
          <CalendarClock className="h-8 w-8 text-primary" />
          <h3 className="font-semibold flex items-center gap-2">
            Zaplanowane posty
            <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
          </h3>
          <p className="text-sm text-muted-foreground">
            Zarzadzaj zaplanowanymi publikacjami na social media
          </p>
        </Link>
      </div>
    </div>
  );
}

export default function ContentGeneratorPage() {
  return (
    <ProPlanGate
      featureName="Generator tresci"
      featureDescription="AI tworzy profesjonalne tresci marketingowe dopasowane do Twojego salonu - posty na social media, opisy uslug i newslettery."
      proBenefits={[
        "Generowanie postow na social media (Instagram, Facebook)",
        "Profesjonalne opisy uslug",
        "Tworzenie newsletterow promocyjnych",
        "Widget planowania marketingowego",
        "Dostosowane do branzy beauty i wellness",
      ]}
    >
      <ContentGeneratorContent />
    </ProPlanGate>
  );
}
