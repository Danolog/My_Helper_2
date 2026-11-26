/**
 * Zadatek w interfejsie panelu, gdy `isDepositEnabled()` decyduje, czy
 * ustawienia zadatku w ogóle istnieją. Flagę czytamy przy każdym wywołaniu,
 * bez kopii — zmiana w `src/lib/features.ts` od razu zmienia też interfejs.
 */

import {
  DEPOSITS_DISABLED_CODE,
  DEPOSITS_DISABLED_MESSAGE,
  isDepositEnabled,
} from "@/lib/features";

export interface ClientDepositForm {
  requireDeposit: boolean;
  depositType: string;
  depositValue: string;
}

export interface ClientDepositPatch {
  requireDeposit?: boolean;
  depositType?: string;
  depositValue?: string | null;
}

/**
 * Pola zadatku klienta do wysłania w `PUT /api/clients/[id]`.
 *
 * Przy wyłączonym zadatku nie wysyłamy żadnego z nich: klient zapisany
 * wcześniej z flagą `true` nie dostaje 409 `DEPOSITS_DISABLED` przy każdej
 * edycji danych, a zapisane wartości zostają nietknięte.
 */
export function clientDepositPatch(form: ClientDepositForm): ClientDepositPatch {
  if (!isDepositEnabled()) return {};
  return {
    requireDeposit: form.requireDeposit,
    depositType: form.depositType,
    depositValue: form.requireDeposit && form.depositValue ? form.depositValue : null,
  };
}

/**
 * Komunikat dla odpowiedzi 409 `DEPOSITS_DISABLED` — tekst z API, a bez
 * niego stały komunikat o wyłączonych zadatkach. null dla innych odpowiedzi.
 */
export function depositsDisabledMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { code, error } = body as Record<string, unknown>;
  if (code !== DEPOSITS_DISABLED_CODE) return null;
  return typeof error === "string" && error.trim() !== "" ? error : DEPOSITS_DISABLED_MESSAGE;
}
