"use client";

import Link from "next/link";
import { ArrowLeft, Bot, Mic, Brain, MessageSquare, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";

function AiAssistantContent() {
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
        <div className="p-6 border rounded-lg space-y-3">
          <Mic className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Asystent glosowy</h3>
          <p className="text-sm text-muted-foreground">
            Automatyczne odbieranie polaczen i umawianie wizyt przez telefon
          </p>
          <Button asChild size="sm">
            <Link href="/dashboard/ai-assistant/voice">Konfiguruj</Link>
          </Button>
        </div>
        <div className="p-6 border rounded-lg space-y-3">
          <Brain className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Asystent biznesowy</h3>
          <p className="text-sm text-muted-foreground">
            Analizuj dane salonu i pytaj AI o wyniki biznesowe
          </p>
          <Button asChild size="sm">
            <Link href="/dashboard/ai-assistant/business">Otworz asystenta</Link>
          </Button>
        </div>
        <div className="p-6 border rounded-lg space-y-3">
          <TrendingUp className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Analiza trendow</h3>
          <p className="text-sm text-muted-foreground">
            Identyfikuj wzorce i trendy w danych salonu - porownania miesieczne i tygodniowe
          </p>
          <Button asChild size="sm">
            <Link href="/dashboard/ai-assistant/trends">Analizuj trendy</Link>
          </Button>
        </div>
        <div className="p-6 border rounded-lg space-y-3">
          <MessageSquare className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Chat AI</h3>
          <p className="text-sm text-muted-foreground">
            Rozmowa z asystentem AI o Twoim biznesie
          </p>
          <Button asChild size="sm">
            <Link href="/chat">Otworz chat</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AiAssistantPage() {
  return (
    <ProPlanGate
      featureName="Asystent AI"
      featureDescription="Asystent AI pomaga w zarzadzaniu salonem - odbiera polaczenia, analizuje dane i podpowiada najlepsze decyzje biznesowe."
      proBenefits={[
        "Asystent glosowy - automatyczne odbieranie polaczen",
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
