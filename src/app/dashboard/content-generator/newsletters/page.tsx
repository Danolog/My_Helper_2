"use client";

import { useState, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { NewsletterConfigCard } from "./_components/newsletter-config-card";
import { NewsletterHeader } from "./_components/newsletter-header";
import { NewsletterPreviewCard } from "./_components/newsletter-preview-card";
import { NewsletterTabSwitcher } from "./_components/newsletter-tab-switcher";
import { SavedNewslettersCard } from "./_components/saved-newsletters-card";
import dynamic from "next/dynamic";

const SendNewsletterDialog = dynamic(() => import("./_components/send-newsletter-dialog").then((m) => m.SendNewsletterDialog));
import { useNewsletterGenerator } from "./_hooks/use-newsletter-generator";
import { useSavedNewsletters } from "./_hooks/use-saved-newsletters";

function NewslettersContent() {
  const [activeTab, setActiveTab] = useState<"create" | "saved">("create");

  const saved = useSavedNewsletters();
  const generator = useNewsletterGenerator(saved.fetchSavedNewsletters);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <NewsletterHeader
        templateName={generator.template?.name}
        onClearTemplate={generator.handleClearTemplate}
      />

      <NewsletterTabSwitcher
        activeTab={activeTab}
        savedCount={saved.savedNewsletters.length}
        onTabChange={setActiveTab}
      />

      {activeTab === "create" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <NewsletterConfigCard
            topic={generator.topic}
            onTopicChange={generator.setTopic}
            goals={generator.goals}
            onGoalsChange={generator.setGoals}
            tone={generator.tone}
            onToneChange={generator.setTone}
            length={generator.length}
            onLengthChange={generator.setLength}
            includeCallToAction={generator.includeCallToAction}
            onIncludeCallToActionChange={generator.setIncludeCallToAction}
            isGenerating={generator.isGenerating}
            onGenerate={generator.handleGenerate}
          />

          <NewsletterPreviewCard
            isGenerating={generator.isGenerating}
            generatedNewsletter={generator.generatedNewsletter}
            isEditingNewsletter={generator.isEditingNewsletter}
            editedSubject={generator.editedSubject}
            onEditedSubjectChange={generator.setEditedSubject}
            editedContent={generator.editedContent}
            onEditedContentChange={generator.setEditedContent}
            copied={generator.copied}
            isSaving={generator.isSaving}
            onCopy={generator.handleCopy}
            onToggleEdit={generator.handleToggleNewsletterEdit}
            onSaveEdit={generator.handleSaveNewsletterEdit}
            onCancelEdit={generator.handleCancelEdit}
            onSave={generator.handleSave}
            onRegenerate={generator.handleRegenerate}
          />
        </div>
      ) : (
        <SavedNewslettersCard
          savedNewsletters={saved.savedNewsletters}
          loadingSaved={saved.loadingSaved}
          onSend={saved.handleOpenSendDialog}
        />
      )}

      <SendNewsletterDialog
        newsletter={saved.sendingNewsletter}
        open={saved.sendDialogOpen}
        onOpenChange={saved.setSendDialogOpen}
        onSent={saved.handleSendComplete}
      />
    </div>
  );
}

export default function NewslettersPage() {
  return (
    <ProPlanGate
      featureName="Newslettery AI"
      featureDescription="AI tworzy profesjonalne newslettery emailowe dopasowane do Twojego salonu - promocyjne, informacyjne i sezonowe."
      proBenefits={[
        "Generowanie newsletterow promocyjnych i informacyjnych",
        "6 celow newslettera (promocja, reaktywacja, nowosci i wiecej)",
        "5 tonow komunikacji do wyboru",
        "Automatyczny tytul i wezwanie do dzialania",
        "Zapis i historia newsletterow",
        "Kontekst salonu i uslug wbudowany w AI",
        "Wysylanie do klientow ze zgoda marketingowa",
      ]}
    >
      <Suspense fallback={<div className="container mx-auto p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
        <NewslettersContent />
      </Suspense>
    </ProPlanGate>
  );
}
