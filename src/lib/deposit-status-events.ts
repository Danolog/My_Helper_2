/**
 * Zapis zdarzenia zmiany `appointments.deposit_paid` do dziennika
 * `deposit_status_events` (kto i kiedy).
 *
 * Walidacja przed zapisem powtarza CHECK-i tabeli z migracji 0014, żeby błędne
 * wywołanie dawało stały komunikat zamiast błędu bazy; baza i tak odrzuci wpis,
 * gdyby walidacja się rozjechała z CHECK-ami.
 */
import { depositStatusEvents, DEPOSIT_STATUS_EVENT_SOURCES } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

export type DepositStatusEventSource = (typeof DEPOSIT_STATUS_EVENT_SOURCES)[number];

/** Konto i jego rola w salonie, które zmieniły flagę ręcznie. */
export type DepositStatusEventActor = { userId: string; role: "owner" | "receptionist" };

export type DepositStatusEventInput = {
  salonId: string;
  appointmentId: string;
  /** Wartość kolumny przed zmianą; NULL ze starych wierszy liczy się jako `false`. */
  previousDepositPaid: boolean | null;
  depositPaid: boolean;
} & (
  | { source: "manual_mark" | "manual_unmark" | "owner_edit"; actor: DepositStatusEventActor }
  | { source: "stripe_confirmation" | "refund"; actor: null }
);

export type DepositStatusEventErrorCode = "unchanged" | "direction" | "actor";

/** Wywołanie niezgodne z regułami dziennika. Komunikat bez identyfikatorów i wartości. */
export class DepositStatusEventError extends Error {
  readonly code: DepositStatusEventErrorCode;

  constructor(code: DepositStatusEventErrorCode) {
    super(`Nieprawidlowy wpis zmiany zadatku (${code})`);
    this.name = "DepositStatusEventError";
    this.code = code;
  }
}

/** Źródła, które ustawiają flagę na true / na false (owner_edit: oba kierunki). */
const SETS_TRUE: ReadonlySet<DepositStatusEventSource> = new Set(["manual_mark", "stripe_confirmation"]);
const SETS_FALSE: ReadonlySet<DepositStatusEventSource> = new Set(["manual_unmark", "refund"]);
const MANUAL_ROLES: ReadonlySet<string> = new Set(["owner", "receptionist"]);

function validationError(input: DepositStatusEventInput, previous: boolean): DepositStatusEventErrorCode | null {
  if (input.depositPaid === previous) return "unchanged";
  if (SETS_TRUE.has(input.source) && !input.depositPaid) return "direction";
  if (SETS_FALSE.has(input.source) && input.depositPaid) return "direction";

  // Wejście sprawdzane także w czasie wykonania: typ nie chroni wywołań z rzutowaniem.
  const actor = input.actor as DepositStatusEventActor | null | undefined;
  if (input.source === "stripe_confirmation" || input.source === "refund") {
    return actor == null ? null : "actor";
  }
  if (actor == null || typeof actor.userId !== "string" || actor.userId.length === 0) return "actor";
  if (!MANUAL_ROLES.has(actor.role)) return "actor";
  if (input.source === "owner_edit" && actor.role !== "owner") return "actor";
  return null;
}

/**
 * Dopisuje zdarzenie zmiany flagi zadatku.
 *
 * - Wołać w TEJ SAMEJ transakcji co UPDATE `depositPaid` i tylko przy faktycznej
 *   zmianie wartości — błąd zapisu (także błąd bazy) leci do wołającego i cofa
 *   jego transakcję razem ze zmianą flagi.
 * - `salonId` brać z zablokowanego wiersza wizyty, nie z treści żądania.
 * - Funkcja nie otwiera transakcji i nie importuje `@/lib/db`; nic nie loguje.
 *
 * @throws DepositStatusEventError gdy wartość się nie zmienia, kierunek nie pasuje
 *   do źródła albo aktor nie pasuje do ścieżki (ręczna / systemowa).
 */
export async function recordDepositStatusEvent(tx: DbTx, input: DepositStatusEventInput): Promise<void> {
  const previousDepositPaid = input.previousDepositPaid === true;
  const code = validationError(input, previousDepositPaid);
  if (code) throw new DepositStatusEventError(code);

  await tx.insert(depositStatusEvents).values({
    salonId: input.salonId,
    appointmentId: input.appointmentId,
    depositPaid: input.depositPaid,
    previousDepositPaid,
    source: input.source,
    actorUserId: input.actor?.userId ?? null,
    actorRole: input.actor?.role ?? null,
  });
}
