// Sprawdzenie blokady rezerwacji online przed zapisem wizyty i przed płatnością.
//
// Wołają je trzy ścieżki rezerwacji przez klienta albo gościa:
// `POST /api/appointments`, `POST /api/deposits/blik-booking`,
// `POST /api/deposits/create-session`. Personel salonu (rezerwacja z panelu)
// nie przechodzi przez to sprawdzenie — trasa woła je tylko dla nie-personelu.
//
// Dopasowanie do kart klientów TEGO salonu (forSalon: rola bez BYPASSRLS
// i jawny warunek salon_id):
// - zalogowany klient: zweryfikowany e-mail konta = clients.email
//   (ten sam mechanizm co lista wizyt i zadatek, src/lib/client-match.ts);
// - telefon z formularza (gość albo zalogowany, jeśli go podał): numer
//   w E.164 porównany z clients.phone po tej samej normalizacji (bez spacji
//   i myślników; zapis 9 cyfr albo +48 i 9 cyfr). Numer, którego nie da się
//   znormalizować, nie dopasowuje niczego.
// Wystarczy jedna zablokowana karta. Telefon służy tylko do sprawdzenia:
// rezerwacja nie zostaje przez to przypięta do karty.
//
// Błąd bazy wychodzi do trasy (500): rezerwacja nie przechodzi bez sprawdzenia.
import { and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { onlineBookingUnavailableMessage, ONLINE_BOOKING_UNAVAILABLE_CODE } from "@/lib/client-block";
import { verifiedClientMatchEmail, type SessionUserLike } from "@/lib/client-match";
import { logger } from "@/lib/logger";
import { normalizePolishPhoneNumber } from "@/lib/phone";
import { clients, salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/** Prefiks numeru PL w E.164; karta mogła zapisać numer bez niego (9 cyfr). */
const PL_E164_PREFIX = "+48";

export type OnlineBookingBlockInput = {
  salonId: string;
  /** Użytkownik sesji albo null (gość). */
  sessionUser: SessionUserLike | null | undefined;
  /** Telefon z formularza rezerwacji (dowolny zapis) albo brak. */
  phone?: string | null;
};

export type OnlineBookingBlockResult =
  | { blocked: false }
  | { blocked: true; salonPhone: string | null; matchedBy: "email" | "phone" };

/**
 * Warunek „karta pasuje do numeru”: zapis z karty bez spacji i myślników
 * równy E.164 albo 9 cyfrom. Odpowiada normalizePolishPhoneNumber po stronie
 * bazy, więc „123 456 789”, „123-456-789” i „+48 123 456 789” to ten sam numer.
 */
function phoneMatches(e164: string): SQL {
  const nineDigits = e164.slice(PL_E164_PREFIX.length);
  const stored = sql`regexp_replace(coalesce(${clients.phone}, ''), '[[:space:]-]', '', 'g')`;
  return sql`${stored} in (${e164}, ${nineDigits})`;
}

/**
 * Czy rezerwacja online w salonie trafia w zablokowaną kartę klienta.
 * Bez e-maila do dopasowania i bez poprawnego numeru nie pyta bazy.
 */
export async function findOnlineBookingBlock(input: OnlineBookingBlockInput): Promise<OnlineBookingBlockResult> {
  const email = verifiedClientMatchEmail(input.sessionUser);
  const e164 = input.phone ? normalizePolishPhoneNumber(input.phone) : null;
  if (!email && !e164) return { blocked: false };

  const gate = forSalon(input.salonId);
  const salonId = gate.salonId;
  const byEmail = email ? eq(clients.email, email) : undefined;
  const byPhone = e164 ? phoneMatches(e164) : undefined;

  return gate.raw(async (tx) => {
    const [hit] = await tx
      .select({
        byEmail: byEmail ? sql<boolean>`coalesce(${byEmail}, false)` : sql<boolean>`false`,
      })
      .from(clients)
      .where(and(eq(clients.salonId, salonId), isNotNull(clients.blockedAt), or(byEmail, byPhone)))
      .limit(1);
    if (!hit) return { blocked: false } as const;

    const [salon] = await tx
      .select({ phone: salons.phone })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);
    return {
      blocked: true,
      salonPhone: salon?.phone ?? null,
      matchedBy: hit.byEmail ? "email" : "phone",
    } as const;
  });
}

/**
 * Odpowiedź 403 dla zablokowanej rezerwacji online albo null (można
 * rezerwować). Trasa woła ją przed jakimkolwiek zapisem i płatnością.
 */
export async function onlineBookingBlockResponse(input: OnlineBookingBlockInput): Promise<NextResponse | null> {
  const result = await findOnlineBookingBlock(input);
  if (!result.blocked) return null;

  // Bez telefonu i e-maila w logu: wystarczy salon i rodzaj dopasowania.
  logger.info("Rezerwacja online odrzucona: karta klienta z blokadą", {
    salonId: input.salonId,
    matchedBy: result.matchedBy,
  });
  return NextResponse.json(
    {
      success: false,
      code: ONLINE_BOOKING_UNAVAILABLE_CODE,
      error: onlineBookingUnavailableMessage(result.salonPhone),
    },
    { status: 403 }
  );
}
