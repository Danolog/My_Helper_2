"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Blocks, Save, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import {
  MODULES,
  TOGGLEABLE_MODULES,
  type ModuleKey,
  type ModulesState,
} from "@/lib/features";

const HARD_OFF_MODULES = MODULES.filter((m) => m.hardOff);

export default function ModulesSettingsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);
  const [modules, setModules] = useState<ModulesState | null>(null);

  // Fetch salon ID
  useEffect(() => {
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons");
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          const userId = session?.user?.id;
          const userSalon = userId
            ? data.data.find(
                (s: { ownerId: string | null }) => s.ownerId === userId
              )
            : null;
          setSalonId(userSalon ? userSalon.id : data.data[0].id);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalonId();
    }
  }, [session]);

  // Fetch resolved modules state
  const fetchModules = useCallback(async () => {
    if (!salonId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/salons/${salonId}/modules`);
      const data = await res.json();
      if (data.success) {
        setModules(data.data);
      }
    } catch {
      toast.error("Nie udalo sie zaladowac ustawien");
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    if (salonId) {
      fetchModules();
    }
  }, [salonId, fetchModules]);

  const handleToggle = (key: ModuleKey, value: boolean) => {
    setModules((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  // Save modules
  const handleSave = async () => {
    if (!salonId || !modules) return;
    try {
      setSaving(true);
      const toggleable: Partial<Record<ModuleKey, boolean>> = {};
      for (const mod of TOGGLEABLE_MODULES) {
        toggleable[mod.key] = modules[mod.key];
      }

      const res = await mutationFetch(`/api/salons/${salonId}/modules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: toggleable }),
      });
      const data = await res.json();
      if (data.success) {
        setModules(data.data);
        toast.success(data.message || "Ustawienia zapisane");
        setSavedSuccessfully(true);
        setTimeout(() => setSavedSuccessfully(false), 3000);
        // Odswiez layout dashboardu, zeby provider modulow i nawigacja
        // podniosly nowy stan (menu przefiltruje sie od razu).
        router.refresh();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac ustawien");
      }
    } catch {
      toast.error("Blad zapisu ustawien");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center h-64">
          <p className="text-muted-foreground">Ladowanie ustawien...</p>
        </div>
      </div>
    );
  }

  if (!salonId || !modules) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-2">Brak salonu</h1>
          <p className="text-muted-foreground">
            Nie znaleziono salonu. Utworz salon, aby skonfigurowac moduly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/settings">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Blocks className="w-8 h-8 text-primary" />
            Moduły
          </h1>
          <p className="text-muted-foreground mt-1">
            Włącz tylko to, czego używasz — mniej pozycji w menu, prostszy panel
          </p>
        </div>
      </div>

      {/* Toggleable modules */}
      <div className="border border-border rounded-lg p-6 mb-6">
        <div className="space-y-1 divide-y divide-border">
          {TOGGLEABLE_MODULES.map((mod) => (
            <div
              key={mod.key}
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div>
                <p className="font-medium">{mod.label}</p>
                <p className="text-sm text-muted-foreground">{mod.description}</p>
              </div>
              <Switch
                checked={modules[mod.key]}
                onCheckedChange={(checked) => handleToggle(mod.key, checked)}
                aria-label={mod.label}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Hard-off modules (globally disabled) */}
      <div className="border border-border rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          Wkrótce
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Te moduly sa jeszcze niedostepne — wlaczymy je w kolejnych wydaniach.
        </p>
        <div className="space-y-1 divide-y divide-border">
          {HARD_OFF_MODULES.map((mod) => (
            <div
              key={mod.key}
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0 opacity-60"
            >
              <div>
                <p className="font-medium">{mod.label}</p>
                <p className="text-sm text-muted-foreground">{mod.description}</p>
              </div>
              <Switch checked={false} disabled aria-label={mod.label} />
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link href="/dashboard/settings">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Powrot do ustawien
          </Link>
        </Button>
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            "Zapisywanie..."
          ) : savedSuccessfully ? (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Zapisano
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Zapisz ustawienia
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
