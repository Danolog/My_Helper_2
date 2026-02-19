"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseUnsavedChangesOptions {
  /** Whether the form currently has unsaved changes */
  isDirty: boolean;
  /** Whether to show browser beforeunload warning (default: true) */
  warnOnUnload?: boolean;
  /** Custom message for the dialog (not used by modern browsers for beforeunload) */
  message?: string;
}

interface UseUnsavedChangesResult {
  /** Whether the unsaved changes dialog is currently open */
  showDialog: boolean;
  /** The URL the user was trying to navigate to */
  pendingUrl: string | null;
  /** Confirm navigation (discard changes and navigate) */
  confirmNavigation: () => void;
  /** Cancel navigation (stay on page) */
  cancelNavigation: () => void;
}

/**
 * Hook to warn users about unsaved changes when trying to navigate away.
 *
 * Handles three navigation scenarios:
 * 1. Browser close/refresh (beforeunload event)
 * 2. Client-side link clicks (intercepts <a> tag clicks)
 * 3. Browser back/forward buttons (popstate event)
 *
 * Usage:
 * ```tsx
 * const { showDialog, confirmNavigation, cancelNavigation } = useUnsavedChanges({
 *   isDirty: formHasChanges,
 * });
 *
 * return (
 *   <>
 *     <form>...</form>
 *     <UnsavedChangesDialog
 *       open={showDialog}
 *       onConfirm={confirmNavigation}
 *       onCancel={cancelNavigation}
 *     />
 *   </>
 * );
 * ```
 */
export function useUnsavedChanges(
  options: UseUnsavedChangesOptions
): UseUnsavedChangesResult {
  const { isDirty, warnOnUnload = true } = options;
  const [showDialog, setShowDialog] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const isDirtyRef = useRef(false);
  const historyPushedRef = useRef(false);
  const isNavigatingRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // 1. Browser beforeunload warning (for refresh/close)
  useEffect(() => {
    if (!warnOnUnload) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (isDirtyRef.current) {
        e.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [warnOnUnload]);

  // 2. Intercept client-side link clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!isDirtyRef.current || isNavigatingRef.current) return;

      // Find the closest <a> element
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href) return;

      // Only intercept same-origin navigation
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return;

      // Don't intercept if same page (hash links, etc.)
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      // Don't intercept if modifier keys are pressed (open in new tab)
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      // Don't intercept if target is _blank
      if (target.target === "_blank") return;

      // Prevent navigation and show dialog
      e.preventDefault();
      e.stopPropagation();
      setPendingUrl(href);
      setShowDialog(true);
    };

    // Use capture phase to intercept before Next.js router handles it
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  // 3. Intercept browser back/forward buttons
  useEffect(() => {
    if (!isDirty) {
      // If not dirty, clean up any extra history entry
      if (historyPushedRef.current) {
        historyPushedRef.current = false;
      }
      return;
    }

    // Push a sentinel history entry when form becomes dirty
    if (!historyPushedRef.current) {
      window.history.pushState({ unsavedChanges: true }, "", window.location.href);
      historyPushedRef.current = true;
    }

    const handlePopState = (_e: PopStateEvent) => {
      if (!isDirtyRef.current || isNavigatingRef.current) return;

      // User pressed back - push state again to stay on page and show dialog
      window.history.pushState({ unsavedChanges: true }, "", window.location.href);
      setPendingUrl("__back__");
      setShowDialog(true);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDirty]);

  // Confirm: allow navigation
  const confirmNavigation = useCallback(() => {
    isNavigatingRef.current = true;
    setShowDialog(false);

    const url = pendingUrl;
    setPendingUrl(null);

    if (url === "__back__") {
      // For back button: go back twice (sentinel + actual back)
      if (historyPushedRef.current) {
        historyPushedRef.current = false;
        window.history.go(-2);
      } else {
        window.history.back();
      }
    } else if (url) {
      // For link clicks: navigate to the stored URL
      // Remove sentinel history entry first
      if (historyPushedRef.current) {
        historyPushedRef.current = false;
        window.history.back();
        // Small delay to allow history.back() to complete before navigation
        setTimeout(() => {
          window.location.href = url;
        }, 50);
      } else {
        window.location.href = url;
      }
    }
  }, [pendingUrl]);

  // Cancel: stay on page
  const cancelNavigation = useCallback(() => {
    setShowDialog(false);
    setPendingUrl(null);
  }, []);

  return {
    showDialog,
    pendingUrl,
    confirmNavigation,
    cancelNavigation,
  };
}
