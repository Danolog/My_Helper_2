"use client";

import { useEffect } from "react";

/** Interval between service worker update checks (60 minutes). */
const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and manages its lifecycle.
 *
 * - Registers `/sw.js` on mount.
 * - Polls for updates every 60 minutes via `registration.update()`.
 * - Dispatches a `sw-update-available` custom event when a new version is
 *   found waiting, so other components (e.g. SwUpdateToast) can prompt the
 *   user to refresh.
 * - Reloads the page when the new service worker takes control
 *   (`controllerchange`).
 *
 * Renders nothing -- this is a side-effect-only component.
 */
export function SwRegister() {
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return undefined;
    }

    let updateInterval: ReturnType<typeof setInterval> | null = null;

    const registerSW = async () => {
      try {
        const registration =
          await navigator.serviceWorker.register("/sw.js");

        // If there is already a waiting worker, notify immediately.
        if (registration.waiting) {
          window.dispatchEvent(new CustomEvent("sw-update-available"));
        }

        // Watch the installing worker -- when it reaches "installed" and a
        // controller already exists it means this is an *update*, not the
        // first install.
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener("statechange", () => {
            if (
              installingWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              window.dispatchEvent(new CustomEvent("sw-update-available"));
            }
          });
        });

        // Periodically check for new versions.
        updateInterval = setInterval(() => {
          registration.update().catch(() => {
            // Silently ignore update-check failures (e.g. offline).
          });
        }, SW_UPDATE_INTERVAL_MS);
      } catch (_error) {
        console.error("[SwRegister] Service worker registration failed");
      }
    };

    registerSW();

    // Reload the page when the new service worker takes over.
    const onControllerChange = () => {
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );

    return () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
