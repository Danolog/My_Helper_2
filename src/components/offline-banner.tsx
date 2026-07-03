"use client";

import { useEffect, useState } from "react";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";

/**
 * Global banner that displays when the user goes offline.
 * Shows a reconnection message when they come back online.
 */
export function OfflineBanner() {
  const { isOnline, wasOffline } = useNetworkStatus();
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (wasOffline && isOnline) {
      // setState odroczony do callbacku timera — synchroniczny setState w ciele
      // efektu kaskaduje re-render (react-hooks/set-state-in-effect).
      const showTimer = setTimeout(() => setShowReconnected(true), 0);
      const hideTimer = setTimeout(() => setShowReconnected(false), 5000);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
    return undefined;
  }, [wasOffline, isOnline]);

  if (isOnline && !showReconnected) {
    return null;
  }

  if (isOnline && showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 left-0 right-0 z-[9999] bg-green-600 text-white px-4 py-2.5 text-center text-sm font-medium shadow-lg animate-in slide-in-from-top duration-300"
      >
        <div className="flex items-center justify-center gap-2">
          <Wifi className="h-4 w-4" />
          <span>Polaczenie przywrocone. Mozesz kontynuowac prace.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-[9999] bg-destructive text-destructive-foreground px-4 py-2.5 text-center text-sm font-medium shadow-lg animate-in slide-in-from-top duration-300"
    >
      <div className="flex items-center justify-center gap-2">
        <WifiOff className="h-4 w-4" />
        <span>
          Brak polaczenia z internetem. Sprawdz polaczenie sieciowe i sprobuj
          ponownie.
        </span>
        <button
          onClick={() => window.location.reload()}
          className="ml-2 inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 text-xs font-medium hover:bg-white/30 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Odswierz
        </button>
      </div>
    </div>
  );
}
