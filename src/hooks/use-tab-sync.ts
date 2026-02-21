"use client";

import { useEffect, useCallback, useRef, useState } from "react";

const CHANNEL_NAME = "myhelper-tab-sync";

export type TabSyncResource =
  | "clients"
  | "services"
  | "products"
  | "appointments"
  | "employees"
  | "promotions"
  | "notifications"
  | "gallery"
  | "reviews"
  | "subscription"
  | "settings"
  | "reports";

interface TabSyncMessage {
  type: "data-changed";
  resource: TabSyncResource;
  timestamp: number;
  tabId: string;
}

/**
 * Hook for cross-tab data synchronization.
 *
 * Uses BroadcastChannel API to notify other tabs when data changes,
 * and listens for changes from other tabs to trigger refetch.
 *
 * Also refetches data when the tab regains focus (visibility change)
 * to catch any changes made while the tab was in the background.
 *
 * Usage:
 * ```tsx
 * const { notifyChange } = useTabSync("clients", fetchClients);
 *
 * // After a successful mutation (create, update, delete):
 * await fetch("/api/clients", { method: "POST", ... });
 * notifyChange(); // Tells other tabs to refetch
 * ```
 */
export function useTabSync(
  resource: TabSyncResource,
  onRefetch: () => void | Promise<void>
) {
  // Generate a unique ID for this tab instance, stable across re-renders
  const [tabId] = useState(() => `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onRefetchRef = useRef(onRefetch);
  const lastFetchRef = useRef<number>(0);
  // Lazily initialize lastFetchRef on first render
  if (lastFetchRef.current === 0) {
    lastFetchRef.current = Date.now();
  }

  // Keep onRefetch ref up to date
  useEffect(() => {
    onRefetchRef.current = onRefetch;
  }, [onRefetch]);

  // Set up BroadcastChannel listener
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = channel;

      channel.onmessage = (event: MessageEvent<TabSyncMessage>) => {
        const msg = event.data;
        // Only react to messages from OTHER tabs about OUR resource
        if (
          msg.type === "data-changed" &&
          msg.resource === resource &&
          msg.tabId !== tabId
        ) {
          lastFetchRef.current = Date.now();
          onRefetchRef.current();
        }
      };

      return () => {
        channel.close();
        channelRef.current = null;
      };
    } catch {
      // BroadcastChannel not supported or blocked
      return;
    }
  }, [resource, tabId]);

  // Refetch on tab focus (visibility change)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Only refetch if tab was hidden for more than 5 seconds
        const timeSinceLastFetch = Date.now() - lastFetchRef.current;
        if (timeSinceLastFetch > 5000) {
          lastFetchRef.current = Date.now();
          onRefetchRef.current();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Notify other tabs of a data change
  const notifyChange = useCallback(() => {
    lastFetchRef.current = Date.now();
    try {
      if (channelRef.current) {
        const message: TabSyncMessage = {
          type: "data-changed",
          resource,
          timestamp: Date.now(),
          tabId,
        };
        channelRef.current.postMessage(message);
      }
    } catch {
      // Channel might be closed or errored
    }
  }, [resource, tabId]);

  return { notifyChange };
}
