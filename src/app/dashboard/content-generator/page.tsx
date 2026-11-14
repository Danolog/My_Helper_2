"use client";

import Link from "next/link";
import {
  ArrowLeft,
  PenTool,
  Instagram,
  Mail,
  FileText,
  ArrowRight,
  BookOpen,
  CalendarClock,
  Clapperboard,
  Video,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { useModules } from "@/components/dashboard/modules-provider";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/lib/features";

interface GeneratorTile {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  /** Kafelek widoczny tylko gdy moduł jest włączony (hardOff ukrywa go globalnie). */
  module?: ModuleKey;
}

const GENERATOR_TILES: GeneratorTile[] = [
  {
    icon: Instagram,
    title: "Posty social media",
    description: "Generowanie angazujacych postow na Instagram, Facebook i TikTok",
    href: "/dashboard/content-generator/social-posts",
    module: "socialPosts",
  },
  {
    icon: FileText,
    title: "Opisy uslug",
    description:
      "Generuj profesjonalne opisy AI w edycji uslugi - otworz usluge i kliknij \"Generuj opis\"",
    href: "/dashboard/services",
  },
  {
    icon: Mail,
    title: "Newslettery",
    description: "Tworzenie newsletterow promocyjnych i informacyjnych",
    href: "/dashboard/content-generator/newsletters",
    module: "newsletters",
  },
  {
    icon: BookOpen,
    title: "Szablony tresci",
    description: "Gotowe szablony do szybkiego tworzenia tresci",
    href: "/dashboard/content-generator/templates",
  },
  {
    icon: Clapperboard,
    title: "Klipy wideo AI",
    description: "Krotkie klipy promocyjne 4-8 sekund generowane przez Veo 3.1",
    href: "/dashboard/content-generator/social-posts#video",
    module: "socialPosts",
  },
  {
    icon: Smartphone,
    title: "Animowane Stories",
    description: "Animowane story 9:16 z szablonami i zdjeciami z galerii",
    href: "/dashboard/content-generator/social-posts#stories",
    module: "socialPosts",
  },
  {
    icon: Video,
    title: "Testimoniale wideo",
    description: "Scenariusze testimoniali wideo z pytaniami i wskazowkami",
    href: "/dashboard/content-generator/testimonials",
    module: "videoGen",
  },
  {
    icon: CalendarClock,
    title: "Zaplanowane posty",
    description: "Zarzadzaj zaplanowanymi publikacjami na social media",
    href: "/dashboard/content-generator/scheduled",
    module: "socialPosts",
  },
];

function ContentGeneratorContent() {
  const modules = useModules();
  const visibleTiles = GENERATOR_TILES.filter(
    (tile) => !tile.module || modules[tile.module]
  );

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
        {visibleTiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="p-6 border rounded-lg space-y-3 hover:border-primary hover:shadow-md transition-all group cursor-pointer"
          >
            <tile.icon className="h-8 w-8 text-primary" />
            <h3 className="font-semibold flex items-center gap-2">
              {tile.title}
              <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </h3>
            <p className="text-sm text-muted-foreground">{tile.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ContentGeneratorPage() {
  return (
    <ProPlanGate
      featureName="Generator tresci"
      featureDescription="AI tworzy profesjonalne opisy usług dopasowane do Twojego salonu."
      proBenefits={[
        "Profesjonalne opisy uslug",
        "Gotowe szablony tresci",
        "Dostosowane do branzy beauty i wellness",
      ]}
    >
      <ContentGeneratorContent />
    </ProPlanGate>
  );
}
