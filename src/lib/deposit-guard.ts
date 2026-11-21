/**
 * #63: wizyta usługi z zadatkiem nie może powstać poza trasą zadatku.
 *
 * Jedyną ścieżką rezerwacji z zadatkiem jest POST /api/deposits/blik-booking
 * (kwota liczona serwerowo, zadatek BLIK-iem na telefon salonu).
 * POST /api/deposits/create-session (płatność Stripe) jest zamrożony modułem
 * `onlineDeposits` (`src/lib/features.ts`). Każda inna trasa, która tworzy
 * wizytę dla kogoś spoza personelu salonu (/api/appointments,
 * book-package, akceptacja terminu z listy oczekujących), pyta ten moduł, czy
 * może zapisać wizytę bez zadatku.
 *
 * Reguła = `depositDecision` (jedna funkcja dla tej trasy i tras zadatku;
 * create-session jest zamrożony):
 * - "deposit": usługa ma deposit_required LUB klient ma require_deposit,
 *   a kwota jest skończoną liczbą > 0 → tu 400 DEPOSIT_REQUIRED;
 * - "none": brak wymogu ALBO wymóg z kwotą ≤ 0 — kwota ≤ 0 przy `required`
 *   świadomie = brak zadatku (zadatek 0 zł niczego nie zabezpiecza, a
 *   create-session płatności na 0 nie utworzy; odmowa byłaby ślepą uliczką) +
 *   warn o konfiguracji salonu;
 * - "error": wyliczenie rzuciło albo kwota nie jest skończoną liczbą (NaN)
 *   → 503, brak zapisu.
 * Wyjątek — personel TEGO salonu
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
 * Trasa zadatku (blik-booking; create-session, zamrożony modułem
 * `onlineDeposits`): serwer nie pobierze zadatku ("none") — portal rezerwuje
 * zwykłą ścieżką.
 */
export const DEPOSIT_NOT_APPLICABLE_CODE = "DEPOSIT_NOT_APPLICABLE";

/**
 * Jeden komunikat dla obu flag (usługa / klient) — nie zdradza, która
 * zadziałała. 400, nie 409: front i stare wersje PWA mapują 409 na
 * "termin zajęty".
 */
export const DEPOSIT_REQUIRED_MESSAGE =
  "Ta rezerwacja wymaga wpłaty zadatku. Zarezerwuj wizytę w portalu salonu z płatnością zadatku.";

export const DEPOSIT_CHECK_UNAVAILABLE_MESSAGE =
  "Nie udało się sprawdzić wymagań rezerwacji. Spróbuj ponownie za chwilę.";

export type DepositDecision =
  | { kind: "deposit"; amount: number }
  | { kind: "none" }
  | { kind: "error" };

/**
 * JEDNA reguła zadatku (#67, kształt Ethana): używa jej strażnik tras bez
 * płatności i trasy zadatku: /api/deposits/blik-booking oraz
 * /api/deposits/create-session (zamrożony modułem `onlineDeposits`).
 * Najpierw `Number.isFinite` —
 * NaN nie jest ani "> 0", ani "≤ 0", więc bez tego wpadałby po cichu do "none".
 */
export function depositDecision(
  expected: { required: boolean; amount: number },
  ctx: { salonId: string; serviceId: string; variantId?: string | null }
): DepositDecision {
  if (!Number.isFinite(expected.amount)) {
    logger.error("[Deposit] Deposit amount is not a finite number — booking refused (503)", {
      salonId: ctx.salonId,
      serviceId: ctx.serviceId,
      variantId: ctx.variantId ?? null,
    });
    return { kind: "error" };
  }
  if (!expected.required) return { kind: "none" };
  if (expected.amount > 0) return { kind: "deposit", amount: expected.amount };

  logger.warn("[Deposit] Deposit required but configured amount is <= 0 — booking without deposit (check salon deposit settings)", {
    salonId: ctx.salonId,
    serviceId: ctx.serviceId,
    variantId: ctx.variantId ?? null,
    amount: expected.amount,
  });
  return { kind: "none" };
}

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

/** Czy wizytę można zapisać BEZ zadatku. Nie rzuca (błąd / NaN = "unavailable"). */
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
    const decision = depositDecision(expected, input);
    if (decision.kind === "deposit") return { allowed: false, reason: "deposit_required" };
    if (decision.kind === "error") return { allowed: false, reason: "unavailable" };
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
