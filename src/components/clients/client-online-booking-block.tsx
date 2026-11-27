"use client";

import { useState } from "react";
import { Ban, Loader2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mutationFetch } from "@/lib/api-client";
import {
  CLIENT_BLOCK_NOTE_MAX_LENGTH,
  CLIENT_BLOCKED_BY_AUTO,
  isClientBlockRole,
  type ClientBlockState,
} from "@/lib/client-block";
import type { ClientData } from "@/components/clients/types";

export type ClientBlockFields = Pick<ClientData, "blockedAt" | "blockedBy" | "blockNote">;

interface ClientOnlineBookingBlockProps {
  clientId: string;
  client: ClientBlockFields;
  /** Nowy stan blokady po udanej zmianie — strona podmienia pola karty. */
  onChange: (next: ClientBlockFields) => void;
}

interface BlockResponse {
  success?: boolean;
  error?: unknown;
  data?: ClientBlockState;
}

const BLOCK_ERROR = "Nie udało się zablokować rezerwacji online";
const UNBLOCK_ERROR = "Nie udało się odblokować rezerwacji online";

/**
 * Blokada rezerwacji online na karcie klienta (POST/DELETE /api/clients/[id]/block).
 *
 * - Karta zablokowana: baner z datą, notatką i przyciskiem „Odblokuj”
 *   (przycisk tylko dla właściciela; recepcja i pracownik widzą sam baner).
 * - Karta bez blokady: przycisk „Zablokuj rezerwację online” z opcjonalną
 *   notatką — tylko dla właściciela.
 *
 * Widoczność przycisków to tylko podpowiedź; decyduje serwer (403 dla innych ról).
 */
export function ClientOnlineBookingBlock({ clientId, client, onChange }: ClientOnlineBookingBlockProps) {
  const role = useSalonRole();
  const canManage = isClientBlockRole(role);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (method: "POST" | "DELETE") => {
    if (pending) return;
    setPending(true);
    const fallback = method === "POST" ? BLOCK_ERROR : UNBLOCK_ERROR;
    try {
      const res = await mutationFetch(`/api/clients/${clientId}/block`, {
        method,
        ...(method === "POST"
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }
          : {}),
      });
      const data = await readJson(res);
      if (res.ok && data?.success === true && data.data) {
        const state = data.data;
        onChange({ blockedAt: state.blockedAt, blockedBy: state.blockedBy, blockNote: state.note });
        toast.success(method === "POST" ? "Rezerwacja online zablokowana" : "Rezerwacja online odblokowana");
        setFormOpen(false);
        setNote("");
        return;
      }
      // Komunikat serwera tylko przy błędzie walidacji (np. za długa notatka).
      toast.error(res.status === 400 && typeof data?.error === "string" ? data.error : fallback);
    } catch {
      toast.error(fallback);
    } finally {
      setPending(false);
    }
  };

  if (client.blockedAt) {
    const automatic = client.blockedBy === CLIENT_BLOCKED_BY_AUTO;
    return (
      <div
        className="flex flex-col gap-3 p-4 mb-6 rounded-lg border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30 sm:flex-row sm:items-start sm:justify-between"
        data-testid="client-online-booking-blocked"
        role="status"
      >
        <div className="flex items-start gap-3 min-w-0">
          <Ban className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-red-800 dark:text-red-300">Rezerwacja online zablokowana</p>
            <p className="text-sm text-red-700 dark:text-red-400">
              Od {formatDate(client.blockedAt)}
              {automatic ? " — automatycznie po nieobecnościach" : ""}. Wizytę dodasz w panelu.
            </p>
            {client.blockNote && (
              <p className="text-sm text-red-700 dark:text-red-400 mt-1 break-words" data-testid="client-block-note">
                Notatka: {client.blockNote}
              </p>
            )}
          </div>
        </div>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => submit("DELETE")}
            disabled={pending}
            aria-busy={pending}
            data-testid="client-unblock-btn"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <Unlock className="h-4 w-4 mr-1" aria-hidden="true" />
            )}
            Odblokuj
          </Button>
        )}
      </div>
    );
  }

  if (!canManage) return null;

  if (!formOpen) {
    return (
      <div className="flex justify-end mb-6">
        <Button variant="outline" size="sm" onClick={() => setFormOpen(true)} data-testid="client-block-btn">
          <Ban className="h-4 w-4 mr-1" aria-hidden="true" />
          Zablokuj rezerwację online
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 mb-6 rounded-lg border space-y-3" data-testid="client-block-form">
      <p className="text-sm text-muted-foreground">
        Klient nie zarezerwuje wizyty w portalu ani jako gość. Zobaczy prośbę o telefon do salonu. Wizytę dodasz
        mu w panelu.
      </p>
      <div className="space-y-1">
        <Label htmlFor="client-block-note">Notatka (opcjonalnie, widzi tylko personel)</Label>
        <Textarea
          id="client-block-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={CLIENT_BLOCK_NOTE_MAX_LENGTH}
          rows={2}
          data-testid="client-block-note-input"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)} disabled={pending}>
          Anuluj
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => submit("POST")}
          disabled={pending}
          aria-busy={pending}
          data-testid="client-block-confirm-btn"
        >
          {pending && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />}
          Zablokuj
        </Button>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("pl-PL");
}

/** Odpowiedź błędu (np. strona 500 z proxy) nie musi być JSON-em. */
async function readJson(res: Response): Promise<BlockResponse | null> {
  try {
    return (await res.json()) as BlockResponse;
  } catch {
    return null;
  }
}
