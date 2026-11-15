/**
 * #63: wizyta usługi z zadatkiem nie może powstać bez płatności zadatku.
 *
 * Jedyną ścieżką rezerwacji z zadatkiem jest POST /api/deposits/create-session
 * (kwota liczona serwerowo, płatność Stripe). Każda inna trasa, która tworzy
 * wizytę dla kogoś spoza personelu salonu (/api/appointments, ai/voice/book,
 * book-package, akceptacja terminu z listy oczekujących), pyta ten moduł, czy
 * może zapisać wizytę bez zadatku.
 *
 * Reguła = ta sama co front portalu i create-session: zadatek obowiązuje, gdy
 * usługa ma deposit_required LUB klient ma require_deposit, a wyliczona kwota
 * > 0 (calculateExpectedDeposit). Wyjątek — personel TEGO salonu
 * (getSalonContext()?.salonId === salonId) — rozstrzyga trasa, nie ten moduł.
 *
 * Fail-closed: błąd wyliczenia = 503 i brak zapisu (nie zgadujemy "pewnie
 * bez zadatku").
 */
import { NextResponse } from "next/server";
import type { SessionUserLike } from "@/lib/client-match";
import { calculateExpectedDeposit } from "@/lib/deposit-calculation";
import { logger } from "@/lib/logger";

export const DEPOSIT_REQUIRED_CODE = "DEPOSIT_REQUIRED";

/**
 * Jeden komunikat dla obu flag (usługa / klient) — nie zdradza, która
 * zadziałała. 400, nie 409: front i stare wersje PWA mapują 409 na
 * "termin zajęty".
 */
export const DEPOSIT_REQUIRED_MESSAGE =
  "Ta rezerwacja wymaga wpłaty zadatku. Zarezerwuj wizytę w portalu salonu z płatnością zadatku.";

export const DEPOSIT_CHECK_UNAVAILABLE_MESSAGE =
  "Nie udało się sprawdzić wymagań rezerwacji. Spróbuj ponownie za chwilę.";

export type DepositGuardInput = {
  salonId: string;
  serviceId: string;
  variantId?: string | null;
  startTime: Date;
  sessionUser?: SessionUserLike | null;
  clientId?: string | null;
};

export type DepositGuardVerdict =
  | { allowed: true }
  | { allowed: false; reason: "deposit_required" | "not_found" | "unavailable" };

/** Czy wizytę można zapisać BEZ zadatku. Nie rzuca (błąd = "unavailable"). */
export async function checkBookingWithoutDeposit(
  input: DepositGuardInput
): Promise<DepositGuardVerdict> {
  try {
    const expected = await calculateExpectedDeposit({
      salonId: input.salonId,
      serviceId: input.serviceId,
      variantId: input.variantId ?? null,
      startTime: input.startTime,
      sessionUser: input.sessionUser ?? null,
      clientId: input.clientId ?? null,
    });
    if (!expected.ok) return { allowed: false, reason: "not_found" };
    if (expected.required && expected.amount > 0) {
      return { allowed: false, reason: "deposit_required" };
    }
    return { allowed: true };
  } catch (error) {
    logger.error("[Deposit guard] Deposit requirement check failed", {
      salonId: input.salonId,
      serviceId: input.serviceId,
      error,
    });
    return { allowed: false, reason: "unavailable" };
  }
}

/**
 * Wersja dla tras HTTP: null = można zapisywać; inaczej gotowa odpowiedź
 * (400 DEPOSIT_REQUIRED / 404 usługa-wariant / 503 wyliczenie niedostępne).
 */
export async function depositGuardResponse(input: DepositGuardInput): Promise<NextResponse | null> {
  const verdict = await checkBookingWithoutDeposit(input);
  if (verdict.allowed) return null;

  switch (verdict.reason) {
    case "deposit_required":
      return NextResponse.json(
        { success: false, error: DEPOSIT_REQUIRED_MESSAGE, code: DEPOSIT_REQUIRED_CODE },
        { status: 400 }
      );
    case "not_found":
      return NextResponse.json(
        { success: false, error: "Nie znaleziono usługi lub wariantu" },
        { status: 404 }
      );
    case "unavailable":
      return NextResponse.json(
        { success: false, error: DEPOSIT_CHECK_UNAVAILABLE_MESSAGE },
        { status: 503, headers: { "Retry-After": "5" } }
      );
  }
}
