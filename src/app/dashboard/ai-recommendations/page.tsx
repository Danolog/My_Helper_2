"use client";

import Link from "next/link";
import { ArrowLeft, Lightbulb, TrendingUp, Target, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";

function AiRecommendationsContent() {
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
            <Lightbulb className="h-6 w-6 text-primary" />
            Rekomendacje AI
          </h1>
          <p className="text-muted-foreground">
            Inteligentne rekomendacje oparte na danych Twojego salonu
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="p-6 border rounded-lg space-y-3">
          <TrendingUp className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Analiza trendow</h3>
          <p className="text-sm text-muted-foreground">
            Identyfikuj rosnace i malejace trendy w uslugach salonu
          </p>
        </div>
        <div className="p-6 border rounded-lg space-y-3">
          <Target className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Optymalizacja cen</h3>
          <p className="text-sm text-muted-foreground">
            Sugestie cenowe oparte na popycie i konkurencji
          </p>
        </div>
        <div className="p-6 border rounded-lg space-y-3">
          <BarChart3 className="h-8 w-8 text-primary" />
          <h3 className="font-semibold">Prognoza przychodow</h3>
          <p className="text-sm text-muted-foreground">
            Przewidywanie przychodow na podstawie historycznych danych
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AiRecommendationsPage() {
  return (
    <ProPlanGate
      featureName="Rekomendacje AI"
      featureDescription="Sztuczna inteligencja analizuje dane Twojego salonu i generuje rekomendacje, ktore pomoga Ci zwiekszyc przychody."
      proBenefits={[
        "Analiza trendow w uslugach i przychodach",
        "Rekomendacje cenowe oparte na danych",
        "Prognoza przychodow i obciazenia",
        "Identyfikacja najbardziej dochodowych uslug",
        "Analiza konkurencji w Twojej okolicy",
      ]}
    >
      <AiRecommendationsContent />
    </ProPlanGate>
  );
}
