"use client";

import { useEffect, useState } from "react";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mutationFetch } from "@/lib/api-client";
import {
  NO_SHOW_AUTO_BLOCK_THRESHOLDS,
  isClientBlockRole,
  parseNoShowAutoBlockThreshold,
  type NoShowAutoBlockThreshold,
} from "@/lib/client-block";

/** Wartość Select dla „wyłączone” (Radix Select nie przyjmuje pustego napisu). */
const OFF_VALUE = "off";

const SAVE_ERROR = "Nie udało się zapisać ustawienia";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; threshold: NoShowAutoBlockThreshold | null }
  | { status: "error" };

interface NoShowAutoBlockCardProps {
  salonId: string;
}

/**
 * Ustawienie „Blokuj rezerwację online po N nieobecnościach”
 * (GET/PUT /api/salons/[id]/no-show-settings). Tylko właściciel: dla innych
 * ról karta się nie pokazuje (serwer i tak odpowiada 403). Zmiana zapisuje
 * się od razu po wyborze i działa od następnego oznaczenia „Nie przyszedł”.
 */
export function NoShowAutoBlockCard({ salonId }: NoShowAutoBlockCardProps) {
  const role = useSalonRole();
  const isOwner = isClientBlockRole(role);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/salons/${salonId}/no-show-settings`, { signal: controller.signal });
        const data = (await res.json()) as { success?: boolean; data?: { noShowAutoBlockThreshold?: unknown } };
        if (!res.ok || data?.success !== true) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", threshold: parseNoShowAutoBlockThreshold(data.data?.noShowAutoBlockThreshold) });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [salonId, isOwner]);

  if (!isOwner) return null;

  const handleChange = async (value: string) => {
    if (saving || state.status !== "ready") return;
    const threshold = value === OFF_VALUE ? null : parseNoShowAutoBlockThreshold(Number(value));
    const previous = state.threshold;
    setState({ status: "ready", threshold });
    setSaving(true);
    try {
      const res = await mutationFetch(`/api/salons/${salonId}/no-show-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noShowAutoBlockThreshold: threshold }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (res.ok && data?.success === true) {
        toast.success(threshold === null ? "Automatyczna blokada wyłączona" : "Ustawienie zapisane");
        return;
      }
      setState({ status: "ready", threshold: previous });
      toast.error(SAVE_ERROR);
    } catch {
      setState({ status: "ready", threshold: previous });
      toast.error(SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6" data-testid="no-show-auto-block-card">
      <CardHeader>
        <div className="flex items-center gap-3">
          <UserX className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <CardTitle className="text-lg">Nieobecności klientów</CardTitle>
            <CardDescription>
              Klient z blokadą nie zarezerwuje wizyty online — zobaczy prośbę o telefon do salonu. Wizytę dodasz mu w
              panelu. Blokadę zdejmiesz na karcie klienta.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="no-show-auto-block">Blokuj rezerwację online po N nieobecnościach</Label>
        {state.status === "error" ? (
          <p className="text-sm text-muted-foreground">Nie udało się wczytać ustawienia. Odśwież stronę.</p>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={state.status === "ready" ? (state.threshold === null ? OFF_VALUE : String(state.threshold)) : undefined}
              onValueChange={handleChange}
              disabled={state.status !== "ready" || saving}
            >
              <SelectTrigger id="no-show-auto-block" className="w-56" data-testid="no-show-auto-block-select">
                <SelectValue placeholder="Wczytywanie..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OFF_VALUE}>Nie blokuj automatycznie</SelectItem>
                {NO_SHOW_AUTO_BLOCK_THRESHOLDS.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    Po {t} {t === 1 ? "nieobecności" : "nieobecnościach"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
