"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  RefreshCw,
  Bell,
  MessageSquareWarning,
  Lightbulb,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsSummary } from "./_components/analytics-summary";
import { BusinessAlerts } from "./_components/business-alerts";
import { ChatTab } from "./_components/chat-tab";
import { ProactiveSuggestions } from "./_components/proactive-suggestions";
import { ReviewAlerts } from "./_components/review-alerts";
import { useAnalytics } from "./_hooks/use-analytics";
import { useBusinessChat } from "./_hooks/use-business-chat";

// ────────────────────────────────────────────────────────────
// Main Business Assistant Content
// ────────────────────────────────────────────────────────────

function BusinessAssistantContent() {
  const {
    analytics,
    loading: analyticsLoading,
    error: analyticsError,
    refresh: refreshAnalytics,
  } = useAnalytics();

  const chat = useBusinessChat();

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/ai-assistant">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              Asystent biznesowy AI
            </h1>
            <p className="text-muted-foreground text-sm">
              Analizuj dane salonu i pytaj o wyniki biznesowe
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAnalytics}
          disabled={analyticsLoading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${analyticsLoading ? "animate-spin" : ""}`}
          />
          Odswiez dane
        </Button>
      </div>

      <Tabs defaultValue="alerts" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="alerts">
            <Bell className="h-4 w-4 mr-2" />
            Alerty
          </TabsTrigger>
          <TabsTrigger value="review-alerts">
            <MessageSquareWarning className="h-4 w-4 mr-2" />
            Opinie
          </TabsTrigger>
          <TabsTrigger value="suggestions">
            <Lightbulb className="h-4 w-4 mr-2" />
            Sugestie AI
          </TabsTrigger>
          <TabsTrigger value="chat">
            <Sparkles className="h-4 w-4 mr-2" />
            Asystent AI
          </TabsTrigger>
          <TabsTrigger value="dashboard">
            <TrendingUp className="h-4 w-4 mr-2" />
            Dane salonu
          </TabsTrigger>
        </TabsList>

        {/* Alerts Tab - Problem Detection */}
        <TabsContent value="alerts">
          <BusinessAlerts />
        </TabsContent>

        {/* Review Alerts Tab - Negative Review Notifications */}
        <TabsContent value="review-alerts">
          <ReviewAlerts />
        </TabsContent>

        {/* Suggestions Tab */}
        <TabsContent value="suggestions">
          <ProactiveSuggestions />
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="space-y-4">
          <ChatTab
            messages={chat.messages}
            input={chat.input}
            setInput={chat.setInput}
            loading={chat.loading}
            sendMessage={chat.sendMessage}
            clearChat={chat.clearChat}
            chatEndRef={chat.chatEndRef}
            inputRef={chat.inputRef}
          />
        </TabsContent>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard">
          <AnalyticsSummary
            data={analytics}
            loading={analyticsLoading}
            error={analyticsError}
            onRefresh={refreshAnalytics}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Export with Pro plan gate
// ────────────────────────────────────────────────────────────

export default function BusinessAssistantPage() {
  return (
    <ProPlanGate
      featureName="Asystent biznesowy AI"
      featureDescription="Asystent biznesowy AI analizuje dane Twojego salonu i pomaga podejmowac lepsze decyzje."
      proBenefits={[
        "Analiza przychodow, wizyt i trendow",
        "Rekomendacje optymalizacji biznesu",
        "Informacje o popularnosci uslug",
        "Analiza wynikow pracownikow",
        "Monitoring stanu magazynowego",
      ]}
    >
      <BusinessAssistantContent />
    </ProPlanGate>
  );
}
