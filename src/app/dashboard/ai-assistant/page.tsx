"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Brain,
  Lightbulb,
  MessageSquare,
  Mic,
  PenTool,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useModules } from "@/components/dashboard/modules-provider";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { Button } from "@/components/ui/button";
import type { ModuleKey } from "@/lib/features";

interface AiTile {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  /** Kafelek widoczny tylko gdy moduł jest włączony (hardOff ukrywa go globalnie). */
  module?: ModuleKey;
}

const AI_TILES: AiTile[] = [
  {
    icon: PenTool,
    title: "Generator tresci",
    description:
      "Posty social media, newslettery, opisy uslug, grafiki i wideo tworzone przez AI",
    href: "/dashboard/content-generator",
    cta: "Otworz generator",
  },
  {
    icon: Brain,
    title: "Asystent biznesowy",
    description: "Analizuj dane salonu i pytaj AI o wyniki biznesowe",
    href: "/dashboard/ai-assistant/business",
    cta: "Otworz asystenta",
  },
  {
    icon: TrendingUp,
    title: "Analiza trendow",
    description:
      "Identyfikuj wzorce i trendy w danych salonu - porownania miesieczne i tygodniowe",
    href: "/dashboard/ai-assistant/trends",
    cta: "Analizuj trendy",
  },
  {
    icon: Lightbulb,
    title: "Rekomendacje AI",
    description: "Codzienne i tygodniowe rekomendacje dzialan dla Twojego salonu",
    href: "/dashboard/ai-recommendations",
    cta: "Zobacz rekomendacje",
  },
  {
    icon: MessageSquare,
    title: "Chat AI",
    description: "Rozmowa z asystentem AI o Twoim biznesie",
    href: "/chat",
    cta: "Otworz chat",
  },
  {
    icon: BarChart3,
    title: "Zuzycie i koszty AI",
    description: "Monitoruj wykorzystanie funkcji AI i limity planu",
    href: "/dashboard/ai-usage",
    cta: "Zobacz zuzycie",
  },
  {
    icon: Mic,
    title: "Asystent glosowy",
    description:
      "Automatyczne odbieranie polaczen i umawianie wizyt przez telefon",
    href: "/dashboard/ai-assistant/voice",
    cta: "Konfiguruj",
    module: "voiceAi",
  },
];

function AiAssistantContent() {
  const modules = useModules();
  const visibleTiles = AI_TILES.filter(
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
            <Bot className="h-6 w-6 text-primary" />
            Asystent AI
          </h1>
          <p className="text-muted-foreground">
            Twoj inteligentny asystent biznesowy
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visibleTiles.map((tile) => (
          <div key={tile.href} className="p-6 border rounded-lg space-y-3">
            <tile.icon className="h-8 w-8 text-primary" />
            <h3 className="font-semibold">{tile.title}</h3>
            <p className="text-sm text-muted-foreground">{tile.description}</p>
            <Button asChild size="sm">
              <Link href={tile.href}>{tile.cta}</Link>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AiAssistantPage() {
  return (
    <ProPlanGate
      featureName="Asystent AI"
      featureDescription="Asystent AI pomaga w zarzadzaniu salonem - tworzy tresci marketingowe, analizuje dane i podpowiada najlepsze decyzje biznesowe."
      proBenefits={[
        "Generator tresci - posty, newslettery, grafiki i wideo",
        "Analiza danych biznesowych i rekomendacje",
        "Chat AI z kontekstem Twojego salonu",
        "Proaktywne sugestie optymalizacji",
        "Analiza trendow i konkurencji",
      ]}
    >
      <AiAssistantContent />
    </ProPlanGate>
  );
}
