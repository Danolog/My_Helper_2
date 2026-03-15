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
    <div className="container mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link href="/dashboard/ai-assistant">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
              <Brain className="h-5 w-5 sm:h-6 sm:w-6 text-primary shrink-0" />
              <span className="truncate">Asystent biznesowy AI</span>
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
          className="self-start sm:self-auto shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${analyticsLoading ? "animate-spin" : ""}`}
          />
          Odswiez dane
        </Button>
      </div>

      <Tabs defaultValue="alerts" className="space-y-6">
        <TabsList className="flex w-full overflow-x-auto no-scrollbar sm:grid sm:grid-cols-5">
          <TabsTrigger value="alerts" className="flex-none sm:flex-1 gap-1 px-3 text-xs sm:text-sm">
            <Bell className="h-4 w-4 shrink-0" />
            Alerty
          </TabsTrigger>
          <TabsTrigger value="review-alerts" className="flex-none sm:flex-1 gap-1 px-3 text-xs sm:text-sm">
            <MessageSquareWarning className="h-4 w-4 shrink-0" />
            Opinie
          </TabsTrigger>
          <TabsTrigger value="suggestions" className="flex-none sm:flex-1 gap-1 px-3 text-xs sm:text-sm">
            <Lightbulb className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Sugestie AI</span>
            <span className="sm:hidden">Sugestie</span>
          </TabsTrigger>
          <TabsTrigger value="chat" className="flex-none sm:flex-1 gap-1 px-3 text-xs sm:text-sm">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Asystent AI</span>
            <span className="sm:hidden">Chat</span>
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="flex-none sm:flex-1 gap-1 px-3 text-xs sm:text-sm">
            <TrendingUp className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Dane salonu</span>
            <span className="sm:hidden">Dane</span>
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
