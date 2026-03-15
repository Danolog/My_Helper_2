"use client";

import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  RefreshCw,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { OverviewTab } from "./_components/overview-tab";
import { DetailsTab } from "./_components/details-tab";
import { InsightsTab } from "./_components/insights-tab";
import { AskTab } from "./_components/ask-tab";
import { useTrendsData } from "./_hooks/use-trends-data";
import { useTrendsChat } from "./_hooks/use-trends-chat";

// ────────────────────────────────────────────────────────────
// Page header — shared between loading, error, and data states
// ────────────────────────────────────────────────────────────

function PageHeader({
  subtitle,
  children,
}: {
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/ai-assistant">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            Analiza trendow
          </h1>
          {subtitle && (
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main Trends Content
// ────────────────────────────────────────────────────────────

function TrendsContent() {
  const { data, loading, error, refresh } = useTrendsData();
  const chat = useTrendsChat(data);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <PageHeader />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Analizowanie danych...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <PageHeader />
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={refresh}>Sprobuj ponownie</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="container mx-auto p-6">
      <PageHeader
        subtitle={`Porownanie: ${data.period.currentMonth} vs ${data.period.previousMonth}`}
      >
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Odswiez
        </Button>
      </PageHeader>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Przeglad</TabsTrigger>
          <TabsTrigger value="details">Szczegoly</TabsTrigger>
          <TabsTrigger value="insights">Wnioski AI</TabsTrigger>
          <TabsTrigger value="ask">Zapytaj AI</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewTab data={data} />
        </TabsContent>

        <TabsContent value="details" className="space-y-6">
          <DetailsTab data={data} />
        </TabsContent>

        <TabsContent value="insights" className="space-y-4">
          <InsightsTab insights={data.insights} />
        </TabsContent>

        <TabsContent value="ask" className="space-y-4">
          <AskTab
            messages={chat.messages}
            input={chat.input}
            setInput={chat.setInput}
            loading={chat.loading}
            sendMessage={chat.sendMessage}
            chatEndRef={chat.chatEndRef}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Export with Pro plan gate
// ────────────────────────────────────────────────────────────

export default function BusinessTrendsPage() {
  return (
    <ProPlanGate
      featureName="Analiza trendow"
      featureDescription="Analiza trendow biznesowych pomaga identyfikowac wzorce i podejmowac lepsze decyzje."
      proBenefits={[
        "Analiza trendow przychodow i wizyt",
        "Porownania miesieczne i tygodniowe",
        "Popularnosc uslug i wyniki pracownikow",
        "Wnioski AI i rekomendacje",
        "Chat z AI o trendach",
      ]}
    >
      <TrendsContent />
    </ProPlanGate>
  );
}
