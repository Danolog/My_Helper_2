"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { mutationFetch } from "@/lib/api-client";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";

interface PushManagerState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  permission: NotificationPermission | "default";
  error: string | null;
  subscriptionCount: number;
}

export function PushNotificationManager() {
  const [state, setState] = useState<PushManagerState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    permission: "default",
    error: null,
    subscriptionCount: 0,
  });

  const checkSubscriptionStatus = useCallback(async () => {
    try {
      // Check browser support
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState((s) => ({
          ...s,
          isSupported: false,
          isLoading: false,
          error: "Przegladarka nie obsluguje powiadomien push",
        }));
        return;
      }

      const permission = Notification.permission;

      // Check if we have subscriptions on the server
      const res = await fetch("/api/push/subscribe");
      const data = await res.json();

      setState((s) => ({
        ...s,
        isSupported: true,
        isSubscribed: data.success ? data.data.isSubscribed : false,
        subscriptionCount: data.success ? data.data.count : 0,
        permission,
        isLoading: false,
      }));
    } catch {
      setState((s) => ({
        ...s,
        isSupported: true,
        isLoading: false,
        error: "Blad sprawdzania statusu powiadomien",
      }));
    }
  }, []);

  useEffect(() => {
    checkSubscriptionStatus();
  }, [checkSubscriptionStatus]);

  const subscribe = async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState((s) => ({
          ...s,
          permission,
          isLoading: false,
          error: "Odmowiono dostepu do powiadomien. Zmien ustawienia przegladarki.",
        }));
        return;
      }

      // Reuse existing registration (e.g. from SwRegister) or register fresh.
      let registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        registration = await navigator.serviceWorker.register("/sw.js");
      }
      await navigator.serviceWorker.ready;

      // Subscribe to push
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error("VAPID public key not configured");
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
      });

      // Send subscription to server
      const res = await mutationFetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userAgent: navigator.userAgent,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to save subscription");
      }

      setState((s) => ({
        ...s,
        isSubscribed: true,
        permission: "granted",
        isLoading: false,
        subscriptionCount: s.subscriptionCount + (data.data.created ? 1 : 0),
      }));
    } catch {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: "Nie udalo sie wlaczyc powiadomien push. Sprawdz ustawienia przegladarki i sprobuj ponownie.",
      }));
    }
  };

  const unsubscribe = async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      // Get current subscription from service worker
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        const subscription =
          await registration.pushManager.getSubscription();
        if (subscription) {
          // Unsubscribe from browser
          await subscription.unsubscribe();

          // Remove from server
          await mutationFetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        }
      }

      setState((s) => ({
        ...s,
        isSubscribed: false,
        isLoading: false,
        subscriptionCount: Math.max(0, s.subscriptionCount - 1),
      }));
    } catch {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: "Nie udalo sie wylaczyc powiadomien push",
      }));
    }
  };

  const sendTestNotification = async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await mutationFetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.data?.error || "Failed to send test");
      }
      setState((s) => ({ ...s, isLoading: false }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : "Blad wysylania testu",
      }));
    }
  };

  if (!state.isSupported && !state.isLoading) {
    return (
      <div className="border rounded-lg p-4 bg-muted/50">
        <div className="flex items-center gap-2 text-muted-foreground">
          <BellOff className="w-5 h-5" />
          <span className="text-sm">
            Powiadomienia push nie sa obslugiwane w tej przegladarce
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {state.isSubscribed ? (
            <BellRing className="w-5 h-5 text-green-600" />
          ) : (
            <Bell className="w-5 h-5 text-muted-foreground" />
          )}
          <div>
            <h3 className="font-medium text-sm">Powiadomienia Push</h3>
            <p className="text-xs text-muted-foreground">
              {state.isSubscribed
                ? `Wlaczone (${state.subscriptionCount} ${state.subscriptionCount === 1 ? "urzadzenie" : "urzadzen"})`
                : "Wylaczone - wlacz aby otrzymywac przypomnienia o wizytach"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {state.isSubscribed && (
            <Button
              variant="outline"
              size="sm"
              onClick={sendTestNotification}
              disabled={state.isLoading}
            >
              {state.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Test"
              )}
            </Button>
          )}
          <Button
            variant={state.isSubscribed ? "outline" : "default"}
            size="sm"
            onClick={state.isSubscribed ? unsubscribe : subscribe}
            disabled={state.isLoading}
          >
            {state.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : state.isSubscribed ? (
              <BellOff className="w-4 h-4 mr-1" />
            ) : (
              <Bell className="w-4 h-4 mr-1" />
            )}
            {state.isSubscribed ? "Wylacz" : "Wlacz"}
          </Button>
        </div>
      </div>

      {state.error && (
        <div className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2">
          {state.error}
        </div>
      )}
    </div>
  );
}

/**
 * Convert a base64-encoded VAPID key to Uint8Array for PushManager.subscribe()
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
