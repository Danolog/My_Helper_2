"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mic,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings2,
  PhoneIncoming,
  History,
} from "lucide-react";
import { toast } from "sonner";

import type { VoiceAiConfig, CallLogEntry, ServiceOption } from "@/components/ai-assistant/voice/types";
import { DEFAULT_CONFIG } from "@/components/ai-assistant/voice/types";
import { VoiceCallPanel } from "@/components/ai-assistant/voice/voice-call-panel";
import { VoiceCommandHistory } from "@/components/ai-assistant/voice/voice-command-history";
import { VoiceSettings } from "@/components/ai-assistant/voice/voice-settings";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSalonId } from "@/hooks/use-salon-id";
import { mutationFetch } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Inner content component — owns all state that the child components need
// ---------------------------------------------------------------------------

function VoiceAiContent() {
  const { salonId } = useSalonId();
  const [config, setConfig] = useState<VoiceAiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [availableServices, setAvailableServices] = useState<ServiceOption[]>([]);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadConfig = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch("/api/ai/voice/config", { cache: "no-store", signal });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      } else {
        setConfig(DEFAULT_CONFIG);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setConfig(DEFAULT_CONFIG);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCallLog = useCallback(async (signal: AbortSignal | null = null) => {
    setLoadingLog(true);
    try {
      const res = await fetch("/api/ai/voice/call-log", { cache: "no-store", signal });
      if (res.ok) {
        const data = await res.json();
        setCallLog(data.logs || []);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    } finally {
      setLoadingLog(false);
    }
  }, []);

  const loadServices = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/services?salonId=${salonId}`, { cache: "no-store", signal });
      if (res.ok) {
        const data = await res.json();
        const svcList = (data.data || data || []) as Array<{
          id: string;
          name: string;
          basePrice: string;
          baseDuration: number;
          isActive?: boolean;
        }>;
        setAvailableServices(
          svcList
            .filter((s) => s.isActive !== false)
            .map((s) => ({
              id: s.id,
              name: s.name,
              price: s.basePrice,
              duration: s.baseDuration,
            }))
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }, [salonId]);

  useEffect(() => {
    const controller = new AbortController();
    loadConfig(controller.signal);
    loadCallLog(controller.signal);
    loadServices(controller.signal);
    return () => controller.abort();
  }, [loadConfig, loadCallLog, loadServices]);

  // ---------------------------------------------------------------------------
  // Config save handler
  // ---------------------------------------------------------------------------

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await mutationFetch("/api/ai/voice/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
        }
        toast.success("Zapisano", {
          description: "Konfiguracja asystenta glosowego zostala zapisana.",
        });
      } else {
        const data = await res.json();
        toast.error("Blad", {
          description: data.error || "Nie udalo sie zapisac konfiguracji.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Callback for child components to trigger a call log refresh
  const handleCallLogRefresh = useCallback(() => {
    loadCallLog();
  }, [loadCallLog]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading || !config) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/ai-assistant">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mic className="h-6 w-6 text-primary" />
            Asystent glosowy AI
          </h1>
          <p className="text-muted-foreground">
            Automatyczne odbieranie polaczen telefonicznych
          </p>
        </div>
        <Badge
          variant={config.enabled ? "default" : "secondary"}
          className="gap-1"
        >
          {config.enabled ? (
            <>
              <CheckCircle2 className="h-3 w-3" /> Aktywny
            </>
          ) : (
            <>
              <XCircle className="h-3 w-3" /> Nieaktywny
            </>
          )}
        </Badge>
      </div>

      <Tabs defaultValue="config" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="config" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Konfiguracja
          </TabsTrigger>
          <TabsTrigger value="simulate" className="gap-2">
            <PhoneIncoming className="h-4 w-4" />
            Symulacja polaczenia
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-2">
            <History className="h-4 w-4" />
            Historia polaczen
          </TabsTrigger>
        </TabsList>

        {/* Configuration Tab */}
        <TabsContent value="config">
          <VoiceSettings
            config={config}
            saving={saving}
            onConfigChange={setConfig}
            onSave={saveConfig}
          />
        </TabsContent>

        {/* Call Simulation Tab */}
        <TabsContent value="simulate">
          <VoiceCallPanel
            config={config}
            availableServices={availableServices}
            onCallLogRefresh={handleCallLogRefresh}
          />
        </TabsContent>

        {/* Call Log Tab */}
        <TabsContent value="log">
          <VoiceCommandHistory
            callLog={callLog}
            loading={loadingLog}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export — wraps content in Pro plan gate
// ---------------------------------------------------------------------------

export default function VoiceAiPage() {
  return (
    <ProPlanGate
      featureName="Asystent glosowy AI"
      featureDescription="Asystent glosowy AI automatycznie odbiera polaczenia telefoniczne, umawia wizyty, sprawdza dostepnosc i odpowiada na pytania klientow."
      proBenefits={[
        "Automatyczne odbieranie polaczen telefonicznych 24/7",
        "Naturalna rozmowa w jezyku polskim",
        "Rezerwacja wizyt przez telefon",
        "Sprawdzanie dostepnosci terminow",
        "Odwolywanie i zmiana terminow wizyt",
        "Przekierowanie do recepcji gdy potrzeba",
      ]}
    >
      <VoiceAiContent />
    </ProPlanGate>
  );
}
