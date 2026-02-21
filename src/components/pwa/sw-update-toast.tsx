"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Displays a fixed toast when a new service worker version is waiting to
 * activate.
 *
 * Listens for the `sw-update-available` custom event dispatched by
 * `<SwRegister />`. When the user clicks "Odswierz", the component sends a
 * `SKIP_WAITING` message to the waiting worker so it immediately activates.
 * The `<SwRegister />` component will then pick up the `controllerchange`
 * event and reload the page.
 */
export function SwUpdateToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onUpdateAvailable = () => {
      setVisible(true);
    };

    window.addEventListener("sw-update-available", onUpdateAvailable);

    return () => {
      window.removeEventListener("sw-update-available", onUpdateAvailable);
    };
  }, []);

  const refresh = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    } catch {
      // If messaging fails, fall back to a hard reload.
      window.location.reload();
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-background border shadow-lg rounded-lg p-4">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium">
            Dostepna nowa wersja aplikacji
          </p>
          <Button size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Odswierz
          </Button>
        </div>
      </div>
    </div>
  );
}
