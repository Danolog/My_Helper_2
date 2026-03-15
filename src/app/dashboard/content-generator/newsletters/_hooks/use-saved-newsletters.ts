"use client";

import { useState, useEffect, useCallback } from "react";
import type { SavedNewsletter } from "../_types";

export function useSavedNewsletters() {
  const [savedNewsletters, setSavedNewsletters] = useState<SavedNewsletter[]>(
    []
  );
  const [loadingSaved, setLoadingSaved] = useState(true);

  // Send dialog state
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendingNewsletter, setSendingNewsletter] =
    useState<SavedNewsletter | null>(null);

  const fetchSavedNewsletters = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/content/newsletter");
      if (response.ok) {
        const data = await response.json();
        setSavedNewsletters(data.newsletters || []);
      }
    } catch {
      // Non-critical, silently fail
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  // Load saved newsletters on mount
  useEffect(() => {
    fetchSavedNewsletters();
  }, [fetchSavedNewsletters]);

  const handleOpenSendDialog = useCallback((nl: SavedNewsletter) => {
    setSendingNewsletter(nl);
    setSendDialogOpen(true);
  }, []);

  const handleSendComplete = useCallback(() => {
    fetchSavedNewsletters();
  }, [fetchSavedNewsletters]);

  return {
    savedNewsletters,
    loadingSaved,
    fetchSavedNewsletters,
    // Send dialog
    sendDialogOpen,
    setSendDialogOpen,
    sendingNewsletter,
    handleOpenSendDialog,
    handleSendComplete,
  };
}
