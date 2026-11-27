/**
 * Automatyczna blokada rezerwacji online po N nieobecnościach.
 *
 * Woła ją `POST /api/appointments/[id]/no-show` w TEJ SAMEJ transakcji, w której
 * oznacza wizytę „Nie przyszedł” — po zmianie statusu, przed commitem. Próg
 * czyta z `salons.settingsJson.noShowAutoBlockThreshold` (null = wyłączone).
 *
 * Karty, których dotyczy nieobecność:
 * - wizyta z kartą (`client_id`) — ta karta;
 * - wizyta online bez karty (portal, gość) — każda karta tego salonu ze
 *   zweryfikowanym e-mailem konta rezerwującego (reguła `"autoBlock"`
 *   w src/lib/online-booking-block.ts). Sam telefon wizyty karty nie
 *   wskazuje: numeru nikt nie sprawdził, więc gość z cudzym numerem nie
 *   zablokuje cudzej karty. Takie nieobecności widać na liczniku karty
 *   (reguła `"counter"`), a blokadę zakłada właściciel ręcznie.
 *   Bez pasującej karty nie ma blokady. Wizyta nie dostaje `client_id`
 *   i żadna karta nie powstaje.
 *
 * Kolejność w transakcji:
 * 1. próg salonu (brak albo wartość spoza 1–3 → nic nie robi, bez blokady wiersza);
 * 2. wiersze kart `FOR NO KEY UPDATE` w kolejności `id` — dwa równoległe
 *    oznaczenia wizyt tego samego klienta liczą po kolei, więc drugie widzi
 *    wizytę pierwszego i próg nie „przeskakuje” przez wyścig; stała kolejność
 *    przy kilku kartach nie daje zakleszczeń między dwoma oznaczeniami;
 * 3. dla każdej karty `countCardNoShows(..., "autoBlock")`: wizyty z kartą
 *    i wizyty online po zweryfikowanym e-mailu (bez dopasowań po telefonie);
 * 4. UPDATE tylko karty bez blokady (`blocked_at IS NULL`): istniejąca blokada,
 *    ręczna albo automatyczna, zostaje z pierwotną datą, autorem i notatką.
 *
 * Cofnięcie oznaczenia tu nie trafia: blokadę zdejmuje tylko właściciel.
 *
 * `tx` pochodzi z `forSalon(salonId).raw(...)`; każde zapytanie ma jawny
 * warunek `salon_id` (salons: `id = salonId`).
 */
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import {
  CLIENT_BLOCKED_BY_AUTO,
  parseNoShowAutoBlockThreshold,
  reachesNoShowAutoBlock,
  type NoShowAutoBlockThreshold,
} from "@/lib/client-block";
import { NO_SHOW_STATUS } from "@/lib/no-show";
import { cardOfOnlineAppointment, onlineAppointmentOfCard, type OnlineNoShowMatch } from "@/lib/online-booking-block";
import { appointments, clients, salons } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";

/**
 * Kolumna z surowym progiem z `settingsJson` (jsonb albo SQL NULL). Klucz jako
 * literał w SQL, nie parametr: operator `->` ma warianty dla tekstu i liczby,
 * a literał nie zostawia bazie wyboru. Zgodny z NO_SHOW_AUTO_BLOCK_SETTING_KEY.
 */
export function noShowAutoBlockThresholdColumn() {
  return sql<unknown>`${salons.settingsJson} -> 'noShowAutoBlockThreshold'`;
}

/**
 * Liczba nieobecności karty `clientId` w salonie: wizyty z tą kartą plus
 * wizyty online tego samego klienta (bez karty) według reguły `match` —
 * `"counter"` dla licznika „Nie przyszedł” na karcie klienta (telefon albo
 * zweryfikowany e-mail), `"autoBlock"` dla progu blokady (sam zweryfikowany
 * e-mail). Jedno zapytanie dla obu, różni je tylko reguła.
 */
export async function countCardNoShows(
  tx: DbTx,
  salonId: string,
  clientId: string,
  match: OnlineNoShowMatch
): Promise<number> {
  const [row] = await tx
    .select({ noShowCount: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.salonId, salonId),
        eq(appointments.status, NO_SHOW_STATUS),
        or(eq(appointments.clientId, clientId), onlineAppointmentOfCard(salonId, clientId, match))
      )
    );
  return Number(row?.noShowCount ?? 0);
}

/** Wizyta oznaczana „Nie przyszedł”: id i karta (null = wizyta online). */
export type NoShowAppointmentRef = { id: string; clientId: string | null };

export type NoShowCardOutcome = {
  clientId: string;
  noShowCount: number;
  result: "below" | "already_blocked" | "blocked";
};

export type NoShowAutoBlockOutcome =
  | { kind: "off" }
  | { kind: "no_card"; threshold: NoShowAutoBlockThreshold }
  | { kind: "checked"; threshold: NoShowAutoBlockThreshold; cards: NoShowCardOutcome[] };

/**
 * Karty, których dotyczy nieobecność, zablokowane `FOR NO KEY UPDATE`
 * w kolejności `id` (Postgres blokuje wiersze po sortowaniu). Wizyta online:
 * tylko karty po zweryfikowanym e-mailu konta (reguła `"autoBlock"`).
 */
async function lockNoShowCards(tx: DbTx, salonId: string, appointment: NoShowAppointmentRef): Promise<string[]> {
  const target = appointment.clientId
    ? eq(clients.id, appointment.clientId)
    : cardOfOnlineAppointment(salonId, appointment.id, "autoBlock");
  const rows = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(target, eq(clients.salonId, salonId)))
    .orderBy(asc(clients.id))
    .for("no key update");
  return rows.map((r) => r.id);
}

async function blockCardIfUnblocked(tx: DbTx, salonId: string, clientId: string, now: Date): Promise<boolean> {
  const updated = await tx
    .update(clients)
    .set({ blockedAt: now, blockedBy: CLIENT_BLOCKED_BY_AUTO, blockNote: null, updatedAt: now })
    .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId), isNull(clients.blockedAt)))
    .returning({ id: clients.id });
  return updated.length > 0;
}

export async function applyNoShowAutoBlock(
  tx: DbTx,
  salonId: string,
  appointment: NoShowAppointmentRef,
  now: Date = new Date()
): Promise<NoShowAutoBlockOutcome> {
  const [salon] = await tx
    .select({ threshold: noShowAutoBlockThresholdColumn() })
    .from(salons)
    .where(eq(salons.id, salonId))
    .limit(1);
  const threshold = parseNoShowAutoBlockThreshold(salon?.threshold);
  if (threshold === null) return { kind: "off" };

  const cardIds = await lockNoShowCards(tx, salonId, appointment);
  if (cardIds.length === 0) return { kind: "no_card", threshold };

  // Po kolei, nie równolegle: jedna transakcja to jedno połączenie.
  const cards: NoShowCardOutcome[] = [];
  for (const clientId of cardIds) {
    const noShowCount = await countCardNoShows(tx, salonId, clientId, "autoBlock");
    if (!reachesNoShowAutoBlock(noShowCount, threshold)) {
      cards.push({ clientId, noShowCount, result: "below" });
      continue;
    }
    const blocked = await blockCardIfUnblocked(tx, salonId, clientId, now);
    cards.push({ clientId, noShowCount, result: blocked ? "blocked" : "already_blocked" });
  }
  return { kind: "checked", threshold, cards };
}
