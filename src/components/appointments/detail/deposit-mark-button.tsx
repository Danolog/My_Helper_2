"use client";

import { useState } from "react";
import { CheckCircle, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Button } from "@/components/ui/button";
import { mutationFetch } from "@/lib/api-client";
import type { SalonRole } from "@/lib/salon-context";
import type { AppointmentDetail, RefundStatus } from "./types";

/** Role, ktore trasa /deposit dopuszcza do recznego oznaczenia zadatku. */
const DEPOSIT_MARK_ROLES: readonly SalonRole[] = ["owner", "receptionist"];

/** Statusy wizyty, przy ktorych trasa /deposit przyjmuje oznaczenie. */
const MARKABLE_STATUSES: readonly string[] = ["scheduled", "confirmed"];

const DEPOSIT_ONLINE_PAYMENT_CODE = "DEPOSIT_ONLINE_PAYMENT";

const DEPOSIT_ONLINE_PAYMENT_MESSAGE =
  "Zadatek ma platnosc online — oznaczenie reczne niedostepne";
const DEPOSIT_MARK_GENERIC_ERROR = "Nie udalo sie zmienic oznaczenia zadatku";

interface DepositMarkButtonProps {
  appointment: AppointmentDetail;
  refundStatus: RefundStatus | null;
  /** Wywolywane po udanej zmianie: strona odswieza wizyte i refund-status. */
  onChanged: () => void | Promise<void>;
  /** notifyChange z useTabSync strony — powiadamia inne karty przegladarki. */
  notifyChange: () => void;
}

interface DepositMarkResponse {
  success?: boolean;
  code?: string;
  error?: unknown;
}

/**
 * Przycisk recznego oznaczenia zadatku rozliczanego poza MyHelper
 * (POST/DELETE /api/appointments/[id]/deposit).
 *
 * Warunek "brak platnosci online" i stan wplaty czytamy wylacznie z
 * odpowiedzi refund-status (settledOutsideApp, hasDeposit, depositPaid),
 * zeby nie dokladac kolejnego predykatu zadatku po stronie klienta.
 */
export function DepositMarkButton({
  appointment,
  refundStatus,
  onChanged,
  notifyChange,
}: DepositMarkButtonProps) {
  const role = useSalonRole();
  const [pending, setPending] = useState(false);

  const visible =
    DEPOSIT_MARK_ROLES.includes(role) &&
    refundStatus !== null &&
    refundStatus.hasDeposit &&
    refundStatus.settledOutsideApp === true &&
    MARKABLE_STATUSES.includes(appointment.status);

  if (!visible) return null;

  const isPaid = refundStatus.depositPaid === true;

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await mutationFetch(`/api/appointments/${appointment.id}/deposit`, {
        method: isPaid ? "DELETE" : "POST",
      });
      const data = await readJson(res);

      if (res.ok && data?.success === true) {
        toast.success(isPaid ? "Cofnieto oznaczenie wplaty" : "Zadatek oznaczony jako wplacony");
        notifyChange();
        // Przycisk zostaje wylaczony do konca odswiezenia, zeby drugie
        // klikniecie nie poszlo ze starym stanem wplaty.
        await onChanged();
        return;
      }

      toast.error(errorMessage(res.status, data));
    } catch {
      toast.error(DEPOSIT_MARK_GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant={isPaid ? "outline" : "default"}
      size="sm"
      className="sm:ml-auto"
      onClick={handleClick}
      disabled={pending}
      data-testid="deposit-mark-btn"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : isPaid ? (
        <RotateCcw className="h-4 w-4 mr-1" />
      ) : (
        <CheckCircle className="h-4 w-4 mr-1" />
      )}
      {isPaid ? "Cofnij oznaczenie wplaty" : "Oznacz zadatek jako wplacony"}
    </Button>
  );
}

/** Odpowiedz bledu (np. strona 500 z proxy) nie musi byc JSON-em. */
async function readJson(res: Response): Promise<DepositMarkResponse | null> {
  try {
    return (await res.json()) as DepositMarkResponse;
  } catch {
    return null;
  }
}

function errorMessage(status: number, data: DepositMarkResponse | null): string {
  if (status === 409 && data?.code === DEPOSIT_ONLINE_PAYMENT_CODE) {
    return DEPOSIT_ONLINE_PAYMENT_MESSAGE;
  }
  if (typeof data?.error === "string" && data.error.trim() !== "") {
    return data.error;
  }
  return DEPOSIT_MARK_GENERIC_ERROR;
}
