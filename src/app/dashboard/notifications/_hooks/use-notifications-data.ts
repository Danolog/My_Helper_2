"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { Notification, BirthdayClient, InactiveClient } from "../_types";

interface UseNotificationsDataReturn {
  notifications: Notification[];
  loading: boolean;
  error: string | null;
  salonId: string | null;
  typeFilter: string;
  setTypeFilter: (filter: string) => void;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  total: number;
  // Birthday state
  birthdayClients: BirthdayClient[];
  loadingBirthday: boolean;
  birthdayChecked: boolean;
  sendingBirthday: boolean;
  birthdayDiscount: string;
  setBirthdayDiscount: (discount: string) => void;
  birthdaySettingsLoaded: boolean;
  birthdayGiftType: string;
  birthdayProductName: string;
  birthdayEnabled: boolean;
  // We Miss You state
  inactiveClients: InactiveClient[];
  loadingInactive: boolean;
  inactiveChecked: boolean;
  sendingWeMissYou: boolean;
  inactiveDays: number;
  weMissYouEnabled: boolean;
  // Actions
  fetchNotifications: () => Promise<void>;
  checkBirthdayClients: () => Promise<void>;
  sendBirthdayNotifications: () => Promise<void>;
  checkInactiveClients: () => Promise<void>;
  sendWeMissYouNotifications: () => Promise<void>;
}

export function useNotificationsData(): UseNotificationsDataReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salonId, setSalonId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [total, setTotal] = useState(0);

  // Birthday notifications state
  const [birthdayClients, setBirthdayClients] = useState<BirthdayClient[]>([]);
  const [loadingBirthday, setLoadingBirthday] = useState(false);
  const [birthdayChecked, setBirthdayChecked] = useState(false);
  const [sendingBirthday, setSendingBirthday] = useState(false);
  const [birthdayDiscount, setBirthdayDiscount] = useState<string>("10");
  const [birthdaySettingsLoaded, setBirthdaySettingsLoaded] = useState(false);
  const [birthdayGiftType, setBirthdayGiftType] = useState<string>("discount");
  const [birthdayProductName, setBirthdayProductName] = useState<string>("");
  const [birthdayEnabled, setBirthdayEnabled] = useState(false);

  // We Miss You state
  const [inactiveClients, setInactiveClients] = useState<InactiveClient[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [inactiveChecked, setInactiveChecked] = useState(false);
  const [sendingWeMissYou, setSendingWeMissYou] = useState(false);
  const [inactiveDays, setInactiveDays] = useState(30);
  const [weMissYouEnabled, setWeMissYouEnabled] = useState(false);

  // Fetch salon ID first
  useEffect(() => {
    const controller = new AbortController();
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons", { signal: controller.signal });
        const data = await res.json();
        if (!controller.signal.aborted) {
          if (data.success && data.data.length > 0) {
            setSalonId(data.data[0].id);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError("Nie mozna zaladowac salonu");
          setLoading(false);
        }
      }
    }
    fetchSalonId();
    return () => controller.abort();
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ salonId, limit: "50", offset: "0" });
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/notifications?${params}`);
      const data = await res.json();
      if (data.success) {
        setNotifications(data.data.notifications);
        setTotal(data.data.total);
      } else {
        setError(data.error || "Blad ladowania powiadomien");
      }
    } catch {
      setError("Nie mozna zaladowac powiadomien");
    } finally {
      setLoading(false);
    }
  }, [salonId, typeFilter, statusFilter]);

  useEffect(() => {
    if (salonId) {
      fetchNotifications();
    }
  }, [salonId, fetchNotifications]);

  // Check for birthday clients and load saved settings
  const checkBirthdayClients = useCallback(async () => {
    if (!salonId) return;
    setLoadingBirthday(true);
    try {
      const res = await fetch(`/api/notifications/birthday?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setBirthdayClients(data.data.clients);
        setBirthdayChecked(true);
        // Load saved birthday settings
        if (data.data.birthdaySettings) {
          const saved = data.data.birthdaySettings;
          setBirthdayEnabled(saved.enabled || false);
          setBirthdayGiftType(saved.giftType || "discount");
          setBirthdayDiscount(String(saved.discountPercentage || 10));
          setBirthdayProductName(saved.productName || "");
          setBirthdaySettingsLoaded(true);
        }
        if (data.data.clients.length === 0) {
          toast.info("Brak klientow z urodzinami dzisiaj");
        }
      }
    } catch {
      toast.error("Blad sprawdzania urodzin");
    } finally {
      setLoadingBirthday(false);
    }
  }, [salonId]);

  // Auto-check birthdays when salonId is available
  useEffect(() => {
    if (salonId && !birthdayChecked) {
      checkBirthdayClients();
    }
  }, [salonId, birthdayChecked, checkBirthdayClients]);

  // Send birthday notifications
  const sendBirthdayNotifications = async () => {
    if (!salonId) return;
    setSendingBirthday(true);
    try {
      // Build request body using saved settings
      const requestBody: Record<string, unknown> = { salonId };
      if (birthdayGiftType === "discount") {
        requestBody.birthdayDiscount = birthdayDiscount ? parseInt(birthdayDiscount) : 0;
        requestBody.giftType = "discount";
      } else if (birthdayGiftType === "product") {
        requestBody.giftType = "product";
        requestBody.productName = birthdayProductName;
      }
      const res = await mutationFetch("/api/notifications/birthday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.data.message);
        // Refresh notifications list
        fetchNotifications();
        // Re-check birthdays
        checkBirthdayClients();
      } else {
        toast.error(data.error || "Blad wysylania powiadomien urodzinowych");
      }
    } catch {
      toast.error("Blad wysylania powiadomien");
    } finally {
      setSendingBirthday(false);
    }
  };

  // Check for inactive clients (We Miss You)
  const checkInactiveClients = useCallback(async () => {
    if (!salonId) return;
    setLoadingInactive(true);
    try {
      const res = await fetch(`/api/notifications/we-miss-you?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setInactiveClients(data.data.clients);
        setInactiveChecked(true);
        setInactiveDays(data.data.inactiveDays || 30);
        if (data.data.weMissYouSettings) {
          setWeMissYouEnabled(data.data.weMissYouSettings.enabled || false);
        }
        if (data.data.clients.length === 0) {
          toast.info("Brak nieaktywnych klientow");
        }
      }
    } catch {
      toast.error("Blad sprawdzania nieaktywnych klientow");
    } finally {
      setLoadingInactive(false);
    }
  }, [salonId]);

  // Auto-check inactive clients when salonId is available
  useEffect(() => {
    if (salonId && !inactiveChecked) {
      checkInactiveClients();
    }
  }, [salonId, inactiveChecked, checkInactiveClients]);

  // Send "We miss you" notifications
  const sendWeMissYouNotifications = async () => {
    if (!salonId) return;
    setSendingWeMissYou(true);
    try {
      const res = await mutationFetch("/api/notifications/we-miss-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.data.message);
        fetchNotifications();
        checkInactiveClients();
      } else {
        toast.error(data.error || "Blad wysylania powiadomien");
      }
    } catch {
      toast.error("Blad wysylania powiadomien");
    } finally {
      setSendingWeMissYou(false);
    }
  };

  return {
    notifications,
    loading,
    error,
    salonId,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    total,
    birthdayClients,
    loadingBirthday,
    birthdayChecked,
    sendingBirthday,
    birthdayDiscount,
    setBirthdayDiscount,
    birthdaySettingsLoaded,
    birthdayGiftType,
    birthdayProductName,
    birthdayEnabled,
    inactiveClients,
    loadingInactive,
    inactiveChecked,
    sendingWeMissYou,
    inactiveDays,
    weMissYouEnabled,
    fetchNotifications,
    checkBirthdayClients,
    sendBirthdayNotifications,
    checkInactiveClients,
    sendWeMissYouNotifications,
  };
}
