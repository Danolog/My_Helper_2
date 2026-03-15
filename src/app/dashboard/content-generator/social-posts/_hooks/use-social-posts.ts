import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { getTemplateById } from "@/lib/content-templates";
import {
  isValidPlatform,
  isValidPostType,
  isValidTone,
  getDefaultScheduleDate,
} from "../_types";
import type { Platform, PostType, Tone, GeneratedPost } from "../_types";

export function useSocialPosts() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const templateId = searchParams.get("template");
  const template = templateId ? getTemplateById(templateId) : undefined;
  const preset = template?.socialPreset;

  // Form state
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [postType, setPostType] = useState<PostType>("service_highlight");
  const [tone, setTone] = useState<Tone>("professional");
  const [context, setContext] = useState("");
  const [includeEmoji, setIncludeEmoji] = useState(true);
  const [includeHashtags, setIncludeHashtags] = useState(true);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(
    null
  );
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPost, setEditedPost] = useState("");

  // Scheduling state
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(getDefaultScheduleDate());
  const [isScheduling, setIsScheduling] = useState(false);

  // Apply template preset values on mount (or when template changes)
  useEffect(() => {
    if (!preset) return;
    if (isValidPlatform(preset.platform)) setPlatform(preset.platform);
    if (isValidPostType(preset.postType)) setPostType(preset.postType);
    if (isValidTone(preset.tone)) setTone(preset.tone);
    setContext(preset.context);
    setIncludeEmoji(preset.includeEmoji);
    setIncludeHashtags(preset.includeHashtags);
  }, [preset]);

  /** Remove the template query param and reset form to defaults. */
  const handleClearTemplate = useCallback(() => {
    router.replace("/dashboard/content-generator/social-posts");
    setPlatform("instagram");
    setPostType("service_highlight");
    setTone("professional");
    setContext("");
    setIncludeEmoji(true);
    setIncludeHashtags(true);
    setGeneratedPost(null);
    setIsEditing(false);
    setEditedPost("");
  }, [router]);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setGeneratedPost(null);

    try {
      const response = await mutationFetch("/api/ai/content/social-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          postType,
          context: context.trim() || undefined,
          tone,
          includeEmoji,
          includeHashtags,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas generowania posta");
        return;
      }

      setGeneratedPost(data);
      setEditedPost(data.post);
      setIsEditing(false);
      toast.success("Post wygenerowany pomyslnie!");
    } catch {
      toast.error("Nie udalo sie wygenerowac posta. Sprobuj ponownie.");
    } finally {
      setIsGenerating(false);
    }
  }, [platform, postType, context, tone, includeEmoji, includeHashtags]);

  const handleCopy = useCallback(async () => {
    if (!generatedPost) return;
    try {
      const textToCopy =
        isEditing || editedPost !== generatedPost.post
          ? editedPost
          : generatedPost.post;
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success("Skopiowano do schowka!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  }, [generatedPost, isEditing, editedPost]);

  const handleToggleEdit = useCallback(() => {
    if (!isEditing && generatedPost) {
      setEditedPost(editedPost || generatedPost.post);
    }
    setIsEditing(!isEditing);
  }, [isEditing, generatedPost, editedPost]);

  const handleSaveEdit = useCallback(() => {
    if (generatedPost) {
      setGeneratedPost({
        ...generatedPost,
        post: editedPost,
        characterCount: editedPost.length,
      });
      setIsEditing(false);
      toast.success("Zmiany zapisane!");
    }
  }, [generatedPost, editedPost]);

  const handleCancelEdit = useCallback(() => {
    if (generatedPost) {
      setEditedPost(generatedPost.post);
    }
    setIsEditing(false);
  }, [generatedPost]);

  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  const handleSchedule = useCallback(async () => {
    if (!generatedPost) return;

    const scheduledDateTime = new Date(scheduleDate);
    if (scheduledDateTime <= new Date()) {
      toast.error("Data publikacji musi byc w przyszlosci");
      return;
    }

    setIsScheduling(true);

    try {
      const response = await mutationFetch("/api/scheduled-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: generatedPost.platform,
          postType: generatedPost.postType,
          content: generatedPost.post,
          hashtags: generatedPost.hashtags,
          tone,
          scheduledAt: scheduledDateTime.toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas planowania posta");
        return;
      }

      toast.success(
        `Post zaplanowany na ${scheduledDateTime.toLocaleDateString("pl-PL", {
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      );
      setShowScheduleDialog(false);
      setScheduleDate(getDefaultScheduleDate());
    } catch {
      toast.error("Nie udalo sie zaplanowac posta. Sprobuj ponownie.");
    } finally {
      setIsScheduling(false);
    }
  }, [generatedPost, scheduleDate, tone]);

  /** Open the schedule dialog and reset the date to default. */
  const handleOpenScheduleDialog = useCallback(() => {
    setScheduleDate(getDefaultScheduleDate());
    setShowScheduleDialog(true);
  }, []);

  return {
    // Template
    template,
    handleClearTemplate,
    // Form state
    platform,
    setPlatform,
    postType,
    setPostType,
    tone,
    setTone,
    context,
    setContext,
    includeEmoji,
    setIncludeEmoji,
    includeHashtags,
    setIncludeHashtags,
    // Generation
    isGenerating,
    generatedPost,
    handleGenerate,
    handleRegenerate,
    // Copy
    copied,
    handleCopy,
    // Editing
    isEditing,
    editedPost,
    setEditedPost,
    handleToggleEdit,
    handleSaveEdit,
    handleCancelEdit,
    // Scheduling
    showScheduleDialog,
    setShowScheduleDialog,
    scheduleDate,
    setScheduleDate,
    isScheduling,
    handleSchedule,
    handleOpenScheduleDialog,
  };
}
