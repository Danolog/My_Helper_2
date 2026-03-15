"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { getTemplateById } from "@/lib/content-templates";
import { isValidGoal, isValidTone, isValidLength } from "../_types";
import type { GoalType, Tone, Length, GeneratedNewsletter } from "../_types";

export function useNewsletterGenerator(onSaved: () => void) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const templateId = searchParams.get("template");
  const template = templateId ? getTemplateById(templateId) : undefined;
  const preset = template?.newsletterPreset;

  const [topic, setTopic] = useState("");
  const [goals, setGoals] = useState<GoalType>("promotion");
  const [tone, setTone] = useState<Tone>("professional");
  const [length, setLength] = useState<Length>("medium");
  const [includeCallToAction, setIncludeCallToAction] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNewsletter, setGeneratedNewsletter] =
    useState<GeneratedNewsletter | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingNewsletter, setIsEditingNewsletter] = useState(false);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedContent, setEditedContent] = useState("");

  // Apply template preset values on mount (or when template changes)
  useEffect(() => {
    if (!preset) return;
    setTopic(preset.topic);
    if (isValidGoal(preset.goals)) setGoals(preset.goals);
    if (isValidTone(preset.tone)) setTone(preset.tone);
    if (isValidLength(preset.length)) setLength(preset.length);
    setIncludeCallToAction(preset.includeCallToAction);
  }, [preset]);

  /** Remove the template query param and reset form to defaults. */
  const handleClearTemplate = useCallback(() => {
    router.replace("/dashboard/content-generator/newsletters");
    setTopic("");
    setGoals("promotion");
    setTone("professional");
    setLength("medium");
    setIncludeCallToAction(true);
    setGeneratedNewsletter(null);
    setIsEditingNewsletter(false);
    setEditedSubject("");
    setEditedContent("");
  }, [router]);

  const handleGenerate = useCallback(async () => {
    if (!topic.trim()) {
      toast.error("Podaj temat lub cel newslettera");
      return;
    }

    setIsGenerating(true);
    setGeneratedNewsletter(null);

    try {
      const response = await mutationFetch("/api/ai/content/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          goals,
          tone,
          length,
          includeCallToAction,
          save: false,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas generowania newslettera");
        return;
      }

      setGeneratedNewsletter(data);
      setEditedSubject(data.subject);
      setEditedContent(data.content);
      setIsEditingNewsletter(false);
      toast.success("Newsletter wygenerowany pomyslnie!");
    } catch {
      toast.error(
        "Nie udalo sie wygenerowac newslettera. Sprobuj ponownie."
      );
    } finally {
      setIsGenerating(false);
    }
  }, [topic, goals, tone, length, includeCallToAction]);

  const handleSave = useCallback(async () => {
    if (!generatedNewsletter) return;

    // Save the currently displayed (possibly edited) content
    const subjectToSave = editedSubject || generatedNewsletter.subject;
    const contentToSave = editedContent || generatedNewsletter.content;

    setIsSaving(true);
    try {
      const response = await mutationFetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subjectToSave,
          content: contentToSave,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas zapisywania");
        return;
      }

      if (data.savedId) {
        // Apply edited values to the generated newsletter state
        setGeneratedNewsletter({
          ...generatedNewsletter,
          subject: subjectToSave,
          content: contentToSave,
          savedId: data.savedId,
        });
        setIsEditingNewsletter(false);
        toast.success("Newsletter zapisany!");
        // Refresh saved list
        onSaved();
      }
    } catch {
      toast.error("Nie udalo sie zapisac newslettera.");
    } finally {
      setIsSaving(false);
    }
  }, [generatedNewsletter, editedSubject, editedContent, onSaved]);

  const handleCopy = useCallback(async () => {
    if (!generatedNewsletter) return;
    const subjectToCopy = editedSubject || generatedNewsletter.subject;
    const contentToCopy = editedContent || generatedNewsletter.content;
    const fullText = `Temat: ${subjectToCopy}\n\n${contentToCopy}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast.success("Skopiowano do schowka!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  }, [generatedNewsletter, editedSubject, editedContent]);

  const handleToggleNewsletterEdit = useCallback(() => {
    if (!isEditingNewsletter && generatedNewsletter) {
      setEditedSubject(editedSubject || generatedNewsletter.subject);
      setEditedContent(editedContent || generatedNewsletter.content);
    }
    setIsEditingNewsletter(!isEditingNewsletter);
  }, [isEditingNewsletter, generatedNewsletter, editedSubject, editedContent]);

  const handleSaveNewsletterEdit = useCallback(() => {
    if (generatedNewsletter) {
      setGeneratedNewsletter({
        ...generatedNewsletter,
        subject: editedSubject,
        content: editedContent,
        wordCount: editedContent.split(/\s+/).filter(Boolean).length,
      });
      setIsEditingNewsletter(false);
      toast.success("Zmiany zapisane!");
    }
  }, [generatedNewsletter, editedSubject, editedContent]);

  const handleCancelEdit = useCallback(() => {
    if (generatedNewsletter) {
      setEditedSubject(generatedNewsletter.subject);
      setEditedContent(generatedNewsletter.content);
    }
    setIsEditingNewsletter(false);
  }, [generatedNewsletter]);

  const handleRegenerate = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  return {
    // Template
    template,
    handleClearTemplate,
    // Form state
    topic,
    setTopic,
    goals,
    setGoals,
    tone,
    setTone,
    length,
    setLength,
    includeCallToAction,
    setIncludeCallToAction,
    // Generation
    isGenerating,
    generatedNewsletter,
    handleGenerate,
    handleRegenerate,
    // Copy
    copied,
    handleCopy,
    // Save
    isSaving,
    handleSave,
    // Editing
    isEditingNewsletter,
    editedSubject,
    setEditedSubject,
    editedContent,
    setEditedContent,
    handleToggleNewsletterEdit,
    handleSaveNewsletterEdit,
    handleCancelEdit,
  };
}
