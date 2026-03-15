"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { PostConfigCard } from "./_components/post-config-card";
import { PostPreviewCard } from "./_components/post-preview-card";
import { SocialPostsHeader } from "./_components/social-posts-header";
import { useSocialPosts } from "./_hooks/use-social-posts";

function SocialPostsContent() {
  const sp = useSocialPosts();

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <SocialPostsHeader
        templateName={sp.template?.name}
        onClearTemplate={sp.handleClearTemplate}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column - Configuration */}
        <PostConfigCard
          platform={sp.platform}
          onPlatformChange={sp.setPlatform}
          postType={sp.postType}
          onPostTypeChange={sp.setPostType}
          tone={sp.tone}
          onToneChange={sp.setTone}
          context={sp.context}
          onContextChange={sp.setContext}
          includeEmoji={sp.includeEmoji}
          onIncludeEmojiChange={sp.setIncludeEmoji}
          includeHashtags={sp.includeHashtags}
          onIncludeHashtagsChange={sp.setIncludeHashtags}
          isGenerating={sp.isGenerating}
          onGenerate={sp.handleGenerate}
        />

        {/* Right column - Generated post */}
        <PostPreviewCard
          isGenerating={sp.isGenerating}
          generatedPost={sp.generatedPost}
          isEditing={sp.isEditing}
          editedPost={sp.editedPost}
          onEditedPostChange={sp.setEditedPost}
          copied={sp.copied}
          onCopy={sp.handleCopy}
          onToggleEdit={sp.handleToggleEdit}
          onSaveEdit={sp.handleSaveEdit}
          onCancelEdit={sp.handleCancelEdit}
          onRegenerate={sp.handleRegenerate}
          showScheduleDialog={sp.showScheduleDialog}
          onShowScheduleDialogChange={sp.setShowScheduleDialog}
          scheduleDate={sp.scheduleDate}
          onScheduleDateChange={sp.setScheduleDate}
          isScheduling={sp.isScheduling}
          onSchedule={sp.handleSchedule}
          onOpenScheduleDialog={sp.handleOpenScheduleDialog}
        />
      </div>
    </div>
  );
}

export default function SocialPostsPage() {
  return (
    <ProPlanGate
      featureName="Posty social media"
      featureDescription="AI generuje angazujace posty na Instagram, Facebook i TikTok dopasowane do Twojego salonu."
      proBenefits={[
        "Posty na Instagram, Facebook i TikTok",
        "7 typow postow (promocja, porady, metamorfoza i wiecej)",
        "5 tonow komunikacji do wyboru",
        "Automatyczne hashtagi i emoji",
        "Kontekst salonu i uslug wbudowany w AI",
        "Planowanie publikacji na przyszlosc",
      ]}
    >
      <Suspense fallback={<div className="container mx-auto p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
        <SocialPostsContent />
      </Suspense>
    </ProPlanGate>
  );
}
