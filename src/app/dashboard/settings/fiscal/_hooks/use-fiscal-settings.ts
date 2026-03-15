"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import type { FiscalPrinterSettings } from "../_types";

const DEFAULT_SETTINGS: FiscalPrinterSettings = {
  enabled: false,
  connectionType: "network",
  printerModel: "",
  ipAddress: "",
  port: 9100,
  serialPort: "",
  baudRate: 9600,
  autoprint: false,
  printCopy: false,
  nip: "",
  headerLine1: "",
  headerLine2: "",
  headerLine3: "",
  lastTestAt: null,
  lastTestResult: null,
  lastTestError: null,
};

export function useFiscalSettings() {
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [settings, setSettings] = useState<FiscalPrinterSettings>(DEFAULT_SETTINGS);

  // Fetch salon ID
  useEffect(() => {
    const controller = new AbortController();
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons", { signal: controller.signal });
        const data = await res.json();
        if (!controller.signal.aborted) {
          if (data.success && data.data.length > 0) {
            const userId = session?.user?.id;
            const userSalon = userId
              ? data.data.find((s: { ownerId: string | null }) => s.ownerId === userId)
              : null;
            setSalonId(userSalon ? userSalon.id : data.data[0].id);
          } else {
            setLoading(false);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalonId();
    }
    return () => controller.abort();
  }, [session]);

  // Fetch fiscal settings
  const fetchSettings = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/salons/${salonId}/fiscal-settings`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
      }
    } catch {
      toast.error("Nie mozna zaladowac ustawien drukarki fiskalnej");
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    if (salonId) {
      fetchSettings();
    }
  }, [salonId, fetchSettings]);

  // Save settings
  const handleSave = async () => {
    if (!salonId) return;
    setSaving(true);
    try {
      const res = await mutationFetch(`/api/salons/${salonId}/fiscal-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Ustawienia zapisane!");
        setSettings(data.data);
      } else {
        toast.error(data.error || "Blad zapisywania ustawien");
      }
    } catch {
      toast.error("Blad zapisywania ustawien");
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    if (!salonId) return;

    // First save settings, then test
    setSaving(true);
    try {
      const saveRes = await mutationFetch(`/api/salons/${salonId}/fiscal-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) {
        toast.error("Nie mozna zapisac ustawien przed testem");
        setSaving(false);
        return;
      }
    } catch {
      toast.error("Blad przy zapisywaniu ustawien");
      setSaving(false);
      return;
    }
    setSaving(false);

    setTesting(true);
    try {
      const res = await mutationFetch(`/api/salons/${salonId}/fiscal-settings/test-connection`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Polaczenie OK!");
        setSettings((prev) => ({
          ...prev,
          lastTestAt: data.data.testedAt,
          lastTestResult: "success",
          lastTestError: null,
        }));
      } else {
        toast.error(data.message || data.error || "Test nie powiodl sie");
        setSettings((prev) => ({
          ...prev,
          lastTestAt: new Date().toISOString(),
          lastTestResult: "failure",
          lastTestError: data.data?.testError || data.error || "Unknown error",
        }));
      }
    } catch {
      toast.error("Blad testu polaczenia");
    } finally {
      setTesting(false);
    }
  };

  // Test print
  const handleTestPrint = async () => {
    if (!salonId) return;
    setPrinting(true);
    try {
      const res = await mutationFetch(`/api/salons/${salonId}/fiscal-settings/test-print`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Testowy paragon wyslany!");
      } else {
        toast.error(data.error || "Nie udalo sie wydrukowac testu");
      }
    } catch {
      toast.error("Blad wydruku testowego");
    } finally {
      setPrinting(false);
    }
  };

  const updateSetting = <K extends keyof FiscalPrinterSettings>(
    key: K,
    value: FiscalPrinterSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return {
    loading,
    saving,
    testing,
    printing,
    settings,
    updateSetting,
    handleSave,
    handleTestConnection,
    handleTestPrint,
  };
}
