"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import {
  DEFAULT_BIRTHDAY_SETTINGS,
  DEFAULT_WE_MISS_YOU_SETTINGS,
  DEFAULT_CHANNEL_SETTINGS,
} from "../_types";
import type {
  BirthdaySettings,
  WeMissYouSettings,
  NotificationChannelSettings,
} from "../_types";

interface UseNotificationSettingsReturn {
  loading: boolean;

  // Birthday settings
  birthdaySettings: BirthdaySettings;
  savingBirthday: boolean;
  birthdaySavedSuccessfully: boolean;
  updateBirthdaySetting: <K extends keyof BirthdaySettings>(
    key: K,
    value: BirthdaySettings[K],
  ) => void;
  handleSaveBirthday: () => Promise<void>;

  // We-miss-you settings
  weMissYouSettings: WeMissYouSettings;
  savingWeMissYou: boolean;
  weMissYouSavedSuccessfully: boolean;
  updateWeMissYouSetting: <K extends keyof WeMissYouSettings>(
    key: K,
    value: WeMissYouSettings[K],
  ) => void;
  handleSaveWeMissYou: () => Promise<void>;

  // Channel settings
  channelSettings: NotificationChannelSettings;
  savingChannels: boolean;
  channelsSavedSuccessfully: boolean;
  setChannelSettings: React.Dispatch<
    React.SetStateAction<NotificationChannelSettings>
  >;
  handleSaveChannels: () => Promise<void>;
}

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Birthday settings state
  const [birthdaySettings, setBirthdaySettings] = useState<BirthdaySettings>(
    DEFAULT_BIRTHDAY_SETTINGS,
  );
  const [savingBirthday, setSavingBirthday] = useState(false);
  const [birthdaySavedSuccessfully, setBirthdaySavedSuccessfully] =
    useState(false);

  // We-miss-you settings state
  const [weMissYouSettings, setWeMissYouSettings] =
    useState<WeMissYouSettings>(DEFAULT_WE_MISS_YOU_SETTINGS);
  const [savingWeMissYou, setSavingWeMissYou] = useState(false);
  const [weMissYouSavedSuccessfully, setWeMissYouSavedSuccessfully] =
    useState(false);

  // Channel settings state
  const [channelSettings, setChannelSettings] =
    useState<NotificationChannelSettings>(DEFAULT_CHANNEL_SETTINGS);
  const [savingChannels, setSavingChannels] = useState(false);
  const [channelsSavedSuccessfully, setChannelsSavedSuccessfully] =
    useState(false);

  // Fetch salon ID - prefer salon owned by current user
  useEffect(() => {
    const controller = new AbortController();
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons", { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          const userId = session?.user?.id;
          const userSalon = userId
            ? data.data.find(
                (s: { ownerId: string | null }) => s.ownerId === userId,
              )
            : null;
          setSalonId(userSalon ? userSalon.id : data.data[0].id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalonId();
    }
    return () => controller.abort();
  }, [session]);

  // Fetch all notification settings when salonId is available
  const fetchSettings = useCallback(
    async (signal: AbortSignal | null = null) => {
      if (!salonId) return;
      setLoading(true);
      try {
        const [birthdayRes, weMissYouRes, channelsRes] = await Promise.all([
          fetch(`/api/salons/${salonId}/birthday-settings`, { signal }),
          fetch(`/api/salons/${salonId}/we-miss-you-settings`, { signal }),
          fetch(`/api/salons/${salonId}/notification-type-settings`, {
            signal,
          }),
        ]);
        const birthdayData = await birthdayRes.json();
        if (birthdayData.success) {
          setBirthdaySettings(birthdayData.data);
        }
        const weMissYouData = await weMissYouRes.json();
        if (weMissYouData.success) {
          setWeMissYouSettings(weMissYouData.data);
        }
        const channelsData = await channelsRes.json();
        if (channelsData.success) {
          setChannelSettings({
            smsReminders: channelsData.data.smsReminders,
            pushReminders: channelsData.data.pushReminders,
            paymentConfirmations: channelsData.data.paymentConfirmations,
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error("Nie mozna zaladowac ustawien powiadomien");
      } finally {
        setLoading(false);
      }
    },
    [salonId],
  );

  useEffect(() => {
    if (!salonId) return;
    const controller = new AbortController();
    fetchSettings(controller.signal);
    return () => controller.abort();
  }, [salonId, fetchSettings]);

  // Birthday settings handlers
  const updateBirthdaySetting = <K extends keyof BirthdaySettings>(
    key: K,
    value: BirthdaySettings[K],
  ) => {
    setBirthdaySettings((prev) => ({ ...prev, [key]: value }));
    setBirthdaySavedSuccessfully(false);
  };

  const handleSaveBirthday = async () => {
    if (!salonId) return;
    setSavingBirthday(true);
    setBirthdaySavedSuccessfully(false);
    try {
      const res = await mutationFetch(
        `/api/salons/${salonId}/birthday-settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(birthdaySettings),
        },
      );
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Ustawienia zapisane!");
        setBirthdaySavedSuccessfully(true);
        setTimeout(() => setBirthdaySavedSuccessfully(false), 3000);
      } else {
        toast.error(data.error || "Blad zapisywania ustawien");
      }
    } catch {
      toast.error("Blad zapisywania ustawien");
    } finally {
      setSavingBirthday(false);
    }
  };

  // We-miss-you settings handlers
  const updateWeMissYouSetting = <K extends keyof WeMissYouSettings>(
    key: K,
    value: WeMissYouSettings[K],
  ) => {
    setWeMissYouSettings((prev) => ({ ...prev, [key]: value }));
    setWeMissYouSavedSuccessfully(false);
  };

  const handleSaveWeMissYou = async () => {
    if (!salonId) return;
    setSavingWeMissYou(true);
    setWeMissYouSavedSuccessfully(false);
    try {
      const res = await mutationFetch(
        `/api/salons/${salonId}/we-miss-you-settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(weMissYouSettings),
        },
      );
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Ustawienia zapisane!");
        setWeMissYouSavedSuccessfully(true);
        setTimeout(() => setWeMissYouSavedSuccessfully(false), 3000);
      } else {
        toast.error(data.error || "Blad zapisywania ustawien");
      }
    } catch {
      toast.error("Blad zapisywania ustawien");
    } finally {
      setSavingWeMissYou(false);
    }
  };

  // Channel settings handlers
  const handleSaveChannels = async () => {
    if (!salonId) return;
    setSavingChannels(true);
    setChannelsSavedSuccessfully(false);
    try {
      const res = await mutationFetch(
        `/api/salons/${salonId}/notification-type-settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(channelSettings),
        },
      );
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Ustawienia kanalow zapisane!");
        setChannelsSavedSuccessfully(true);
        setTimeout(() => setChannelsSavedSuccessfully(false), 3000);
      } else {
        toast.error(data.error || "Blad zapisywania ustawien kanalow");
      }
    } catch {
      toast.error("Blad zapisywania ustawien kanalow");
    } finally {
      setSavingChannels(false);
    }
  };

  return {
    loading,
    birthdaySettings,
    savingBirthday,
    birthdaySavedSuccessfully,
    updateBirthdaySetting,
    handleSaveBirthday,
    weMissYouSettings,
    savingWeMissYou,
    weMissYouSavedSuccessfully,
    updateWeMissYouSetting,
    handleSaveWeMissYou,
    channelSettings,
    savingChannels,
    channelsSavedSuccessfully,
    setChannelSettings,
    handleSaveChannels,
  };
}
