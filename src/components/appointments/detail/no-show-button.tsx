"use client";

import { useState } from "react";
import { Loader2, RotateCcw, UserX } from "lucide-react";
import { toast } from "sonner";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Button } from "@/components/ui/button";
import { mutationFetch } from "@/lib/api-client";
import { NO_SHOW_LABEL, canMarkNoShow, canUndoNoShow, noShowErrorToastMessage } from "@/lib/no-show";

const NO_SHOW_GENERIC_ERROR = "Nie udało się zmienić oznaczenia wizyty";

interface NoShowButtonProps {
  appointment: { id: string; status: string; startTime: string };
  /** Wywoływane po udanej zmianie: strona odświeża wizytę. */
  onChanged: () => void | Promise<void>;
  /** notifyChange z useTabSync strony — odświeża kalendarz w innych kartach. */
  notifyChange: () => void;
}

interface NoShowResponse {
  success?: boolean;
  error?: unknown;
}

/**
 * Przycisk „Nie przyszedł” / „Cofnij «Nie przyszedł»” w szczegółach wizyty
 * (POST/DELETE /api/appointments/[id]/no-show).
 *
 * Widoczność to tylko podpowiedź (rola, status, dzień wizyty z `@/lib/no-show`);
 * decyduje serwer. Jego komunikat trafia do toastu tylko przy 400, 404 i 409
 * (`noShowErrorToastMessage`), przy innych błędach toast ma stały tekst.
 */
export function NoShowButton({ appointment, onChanged, notifyChange }: NoShowButtonProps) {
  const role = useSalonRole();
  const [pending, setPending] = useState(false);

  const canUndo = canUndoNoShow({ role, status: appointment.status });
  const canMark = canMarkNoShow({ role, status: appointment.status, startTime: appointment.startTime });
  if (!canUndo && !canMark) return null;

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await mutationFetch(`/api/appointments/${appointment.id}/no-show`, {
        method: canUndo ? "DELETE" : "POST",
      });
      const data = await readJson(res);

      if (res.ok && data?.success === true) {
        toast.success(canUndo ? "Cofnięto oznaczenie „Nie przyszedł”" : "Wizyta oznaczona: „Nie przyszedł”");
        notifyChange();
        // Przycisk zostaje wyłączony do końca odświeżenia, żeby drugie
        // kliknięcie nie poszło ze starym statusem wizyty.
        await onChanged();
        return;
      }

      toast.error(noShowErrorToastMessage(res.status, data?.error, NO_SHOW_GENERIC_ERROR));
    } catch {
      toast.error(NO_SHOW_GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  };

  // Wiersz z odstępem renderuje sam przycisk: gdy go nie ma, strona nie
  // dostaje pustego miejsca pod nagłówkiem.
  return (
    <div className="flex justify-end mb-4">
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        data-testid={canUndo ? "no-show-undo-btn" : "no-show-mark-btn"}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
        ) : canUndo ? (
          <RotateCcw className="h-4 w-4 mr-1" aria-hidden="true" />
        ) : (
          <UserX className="h-4 w-4 mr-1" aria-hidden="true" />
        )}
        {canUndo ? `Cofnij „${NO_SHOW_LABEL}”` : NO_SHOW_LABEL}
      </Button>
    </div>
  );
}

/** Odpowiedź błędu (np. strona 500 z proxy) nie musi być JSON-em. */
async function readJson(res: Response): Promise<NoShowResponse | null> {
  try {
    return (await res.json()) as NoShowResponse;
  } catch {
    return null;
  }
}
