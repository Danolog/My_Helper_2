// Sprawdzenie blokady rezerwacji online przed zapisem wizyty i przed płatnością.
//
// Wołają je ścieżki rezerwacji przez klienta albo gościa:
// `POST /api/appointments`, `POST /api/deposits/blik-booking`,
// `POST /api/deposits/create-session`, dołączenie do listy oczekujących
// i przyjęcie terminu z listy. Personel salonu (rezerwacja z panelu)
// nie przechodzi przez to sprawdzenie — trasa woła je tylko dla nie-personelu.
//
// Dopasowanie do kart klientów TEGO salonu (forSalon: rola bez BYPASSRLS
// i jawny warunek salon_id):
// - zalogowany klient: zweryfikowany e-mail konta = clients.email, bez
//   rozróżniania wielkości liter i bez spacji na brzegach;
// - telefon z formularza (gość albo zalogowany, jeśli go podał): numer
//   sprowadzony przez normalizePolishPhoneNumber do +48 i 9 cyfr. Numer,
//   którego nie da się znormalizować, nie dopasowuje niczego;
// - karta klienta wskazana przez wołającego (`clientId`, np. karta wpisu listy
//   oczekujących): ta karta albo inna karta tego salonu z tym samym e-mailem
//   lub numerem. Telefon i e-mail karty czyta baza w tym samym zapytaniu,
//   w kontekście salonu — trasa nie musi ich odczytywać sama.
//
// Numer na karcie: karta zapisuje telefon tak, jak go wpisano (spacje,
// myślniki, nawiasy, kropki, `+48`, `0048`, `48`). Baza zostawia z niego same
// cyfry i porównuje je z trzema postaciami tego samego numeru: 9 cyfr,
// `48` + 9 cyfr i `0048` + 9 cyfr. Rozpoznane są więc m.in.
// „(+48) 600 700 800”, „600.700.800”, „0048600700800”, „48 600 700 800”
// i „+48-600-700-800”. Numer z innym prefiksem kraju („+49 600 700 800”) albo
// innej długości nie pasuje.
//
// Wystarczy jedna zablokowana karta. Telefon służy tylko do sprawdzenia:
// rezerwacja nie zostaje przez to przypięta do karty.
//
// Błąd bazy wychodzi do trasy (500): rezerwacja nie przechodzi bez sprawdzenia.
import { NextResponse } from "next/server";
import { and, eq, isNotNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { onlineBookingUnavailableMessage, ONLINE_BOOKING_UNAVAILABLE_CODE } from "@/lib/client-block";
import { verifiedClientMatchEmail, type SessionUserLike } from "@/lib/client-match";
import { logger } from "@/lib/logger";
import { normalizePolishPhoneNumber } from "@/lib/phone";
import { clients, salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/** Prefiks numeru PL w E.164 (wynik normalizePolishPhoneNumber). */
const PL_E164_PREFIX = "+48";
/** Prefiksy kraju, z którymi karta mogła zapisać numer PL (po usunięciu „+”). */
const PL_COUNTRY_CODE = "48";
const PL_INTERNATIONAL_PREFIX = "0048";

export type OnlineBookingBlockInput = {
  salonId: string;
  /** Użytkownik sesji albo null (gość). */
  sessionUser: SessionUserLike | null | undefined;
  /** Telefon z formularza rezerwacji (dowolny zapis) albo brak. */
  phone?: string | null;
  /**
   * Karta klienta tego salonu, której telefon i e-mail też dopasowujemy
   * (np. karta wpisu listy oczekujących). Karta innego salonu nie jest
   * widoczna (warunek salon_id i RLS), więc nic nie dopasuje.
   */
  clientId?: string | null;
};

export type OnlineBookingBlockResult =
  | { blocked: false }
  | { blocked: true; salonPhone: string | null; matchedBy: "email" | "phone" | "card" };

/** Aliasy tabeli kart w podzapytaniach (zewnętrzne zapytanie też czyta `clients`). */
const LINKED_CARD_ALIAS = "linked_card";
const BLOCKED_CARD_ALIAS = "blocked_card";

/**
 * `"clients" "<alias>"` do klauzuli FROM podzapytania. Sam alias wstawiony do
 * szablonu `sql` renderuje się jako nazwa aliasu bez tabeli, więc tabela
 * i alias idą osobno; kolumny aliasu (`alias(clients, ...)`) wskazują ten alias.
 */
function clientsAs(aliasName: string): SQL {
  return sql`${clients} ${sql.identifier(aliasName)}`;
}

/** Kolumny karty potrzebne do porównania „ten sam klient”. */
type CardColumns = { id: AnyColumn; email: AnyColumn; phone: AnyColumn };

/** Same cyfry numeru z karty (bez spacji, myślników, nawiasów, kropek i plusa). */
function cardPhoneDigits(phone: AnyColumn): SQL {
  return sql`regexp_replace(coalesce(${phone}, ''), '[^0-9]', '', 'g')`;
}

/**
 * Numer PL z karty jako 9 cyfr albo NULL (inny prefiks kraju, inna długość,
 * brak numeru). Te same trzy postaci co w `phoneMatches`; NULL nie jest równy
 * niczemu, więc karta z nierozpoznanym numerem nie pasuje do żadnej innej.
 */
function cardPhoneKey(phone: AnyColumn): SQL {
  const digits = cardPhoneDigits(phone);
  return sql`(case when ${digits} ~ '^[0-9]{9}$' then ${digits} when ${digits} ~ '^48[0-9]{9}$' then substr(${digits}, 3) when ${digits} ~ '^0048[0-9]{9}$' then substr(${digits}, 5) end)`;
}

/** E-mail karty do porównania: bez spacji na brzegach, małe litery; pusty = NULL. */
function cardEmailKey(email: AnyColumn): SQL {
  return sql`lower(nullif(btrim(${email}), ''))`;
}

/**
 * Warunek „karta pasuje do numeru z formularza”: cyfry z karty równe jednej
 * z trzech postaci tego numeru (9 cyfr, 48 + 9 cyfr, 0048 + 9 cyfr).
 */
function phoneMatches(e164: string): SQL {
  const nineDigits = e164.slice(PL_E164_PREFIX.length);
  const withCountryCode = PL_COUNTRY_CODE + nineDigits;
  const withInternationalPrefix = PL_INTERNATIONAL_PREFIX + nineDigits;
  return sql`${cardPhoneDigits(clients.phone)} in (${nineDigits}, ${withCountryCode}, ${withInternationalPrefix})`;
}

/** Warunek „zweryfikowany e-mail konta = e-mail karty” bez rozróżniania wielkości liter. */
function emailMatches(email: string): SQL {
  return sql`${cardEmailKey(clients.email)} = lower(btrim(${email}))`;
}

/** Dwie karty to ten sam klient: ta sama karta, ten sam e-mail albo ten sam numer PL. */
function sameCustomer(a: CardColumns, b: CardColumns): SQL {
  return or(
    eq(a.id, b.id),
    sql`${cardEmailKey(a.email)} = ${cardEmailKey(b.email)}`,
    sql`${cardPhoneKey(a.phone)} = ${cardPhoneKey(b.phone)}`
  )!;
}

/**
 * Warunek na kartę `clients` w zapytaniu: jest nią karta `clientId` tego salonu
 * albo karta z tym samym e-mailem lub numerem. Telefon i e-mail karty
 * `clientId` czyta podzapytanie z jawnym `id` i `salon_id`.
 */
function linkedCardMatches(salonId: string, clientId: string): SQL {
  const linked = alias(clients, LINKED_CARD_ALIAS);
  return sql`exists (select 1 from ${clientsAs(LINKED_CARD_ALIAS)} where ${and(
    eq(linked.id, clientId),
    eq(linked.salonId, salonId),
    sameCustomer(linked, clients)
  )})`;
}

/**
 * Kolumna do zapytania o karty `clients` salonu `salonId`: true, gdy ta karta
 * albo inna karta tego salonu z tym samym e-mailem lub numerem PL ma blokadę
 * rezerwacji online. Tę samą regułę stosuje `findOnlineBookingBlock` z
 * `clientId`. Zapytanie musi iść przez `forSalon(salonId)`.
 */
export function sameCustomerOnlineBookingBlocked(salonId: string): SQL<boolean> {
  const blocked = alias(clients, BLOCKED_CARD_ALIAS);
  return sql<boolean>`exists (select 1 from ${clientsAs(BLOCKED_CARD_ALIAS)} where ${and(
    eq(blocked.salonId, salonId),
    isNotNull(blocked.blockedAt),
    sameCustomer(blocked, clients)
  )})`;
}

/**
 * Czy rezerwacja online w salonie trafia w zablokowaną kartę klienta.
 * Bez e-maila do dopasowania, bez poprawnego numeru i bez karty nie pyta bazy.
 */
export async function findOnlineBookingBlock(input: OnlineBookingBlockInput): Promise<OnlineBookingBlockResult> {
  const email = verifiedClientMatchEmail(input.sessionUser);
  const e164 = input.phone ? normalizePolishPhoneNumber(input.phone) : null;
  const clientId = input.clientId || null;
  if (!email && !e164 && !clientId) return { blocked: false };

  const gate = forSalon(input.salonId);
  const salonId = gate.salonId;
  const byEmail = email ? emailMatches(email) : undefined;
  const byPhone = e164 ? phoneMatches(e164) : undefined;
  const byCard = clientId ? linkedCardMatches(salonId, clientId) : undefined;

  return gate.raw(async (tx) => {
    const [hit] = await tx
      .select({
        byEmail: byEmail ? sql<boolean>`coalesce(${byEmail}, false)` : sql<boolean>`false`,
        byCard: byCard ? sql<boolean>`coalesce(${byCard}, false)` : sql<boolean>`false`,
      })
      .from(clients)
      .where(and(eq(clients.salonId, salonId), isNotNull(clients.blockedAt), or(byEmail, byPhone, byCard)))
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
      matchedBy: hit.byEmail ? "email" : hit.byCard ? "card" : "phone",
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
