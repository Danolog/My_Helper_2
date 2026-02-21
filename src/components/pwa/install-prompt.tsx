"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** localStorage key used to persist the user's dismissal timestamp. */
const DISMISS_KEY = "pwa-install-dismissed";

/** Duration (in ms) during which the prompt stays hidden after dismissal. */
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Delay (in ms) before showing the banner after the page loads. */
const SHOW_DELAY_MS = 3_000;

/**
 * Extend the global event types so TypeScript recognises the non-standard
 * `beforeinstallprompt` event used by Chromium-based browsers.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Returns `true` if the app is already running in standalone / TWA mode.
 */
function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Returns `true` if the user dismissed the install banner within the
 * configured cooldown period.
 */
function wasDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissed = Number(raw);
    return Date.now() - dismissed < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/**
 * Shows a fixed-position banner prompting the user to install the PWA.
 *
 * The banner is suppressed when:
 * - the app is already running in standalone / installed mode,
 * - the user dismissed it within the last 7 days, or
 * - the browser does not fire `beforeinstallprompt` (Safari, Firefox).
 */
export function InstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Never show the banner if already installed or recently dismissed.
    if (isStandaloneMode() || wasDismissedRecently()) {
      return undefined;
    }

    const onBeforeInstall = (e: Event) => {
      // Prevent the default mini-infobar in Chrome.
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;

      // Show our custom banner after a short delay.
      const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Ignore quota errors -- the banner just won't be suppressed next time.
    }
    setVisible(false);
  };

  const install = async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;

    await prompt.prompt();
    deferredPrompt.current = null;
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
      <div className="bg-background border shadow-lg rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="font-semibold">Zainstaluj MyHelper</p>
            <p className="text-sm text-muted-foreground">
              Dodaj aplikacje do ekranu glownego, aby miec szybki dostep.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={dismiss}>
              Nie teraz
            </Button>
            <Button size="sm" onClick={install}>
              <Download className="h-4 w-4" />
              Zainstaluj
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
