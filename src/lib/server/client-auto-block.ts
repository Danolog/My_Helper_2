/**
 * Automatyczna blokada rezerwacji online po N nieobecnościach.
 *
 * Woła ją `POST /api/appointments/[id]/no-show` w TEJ SAMEJ transakcji, w której
 * oznacza wizytę „Nie przyszedł” — po zmianie statusu, przed commitem. Próg
 * czyta z `salons.settingsJson.noShowAutoBlockThreshold` (null = wyłączone).
 *
 * Kolejność w transakcji:
 * 1. próg salonu (brak albo wartość spoza 1–3 → nic nie robi, bez blokady wiersza);
 * 2. wiersz klienta `FOR NO KEY UPDATE` — dwa równoległe oznaczenia wizyt
 *    tego samego klienta liczą po kolei, więc drugie widzi wizytę pierwszego
 *    i próg nie „przeskakuje” przez wyścig;
 * 3. liczba wizyt klienta ze statusem `no_show` w salonie;
 * 4. UPDATE tylko karty bez blokady (`blocked_at IS NULL`): istniejąca blokada,
 *    ręczna albo automatyczna, zostaje z pierwotną datą, autorem i notatką.
 *
 * Cofnięcie oznaczenia tu nie trafia: blokadę zdejmuje tylko właściciel.
 *
 * `tx` pochodzi z `forSalon(salonId).raw(...)`; każde zapytanie ma jawny
 * warunek `salon_id` (salons: `id = salonId`).
 */
import { and, count, eq, isNull, sql } from "drizzle-orm";
import {
  CLIENT_BLOCKED_BY_AUTO,
  parseNoShowAutoBlockThreshold,
  reachesNoShowAutoBlock,
  type NoShowAutoBlockThreshold,
} from "@/lib/client-block";
import { NO_SHOW_STATUS } from "@/lib/no-show";
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

export type NoShowAutoBlockOutcome =
  | { kind: "off" }
  | { kind: "client_missing"; threshold: NoShowAutoBlockThreshold }
  | { kind: "below"; threshold: NoShowAutoBlockThreshold; noShowCount: number }
  | { kind: "already_blocked"; threshold: NoShowAutoBlockThreshold; noShowCount: number }
  | { kind: "blocked"; threshold: NoShowAutoBlockThreshold; noShowCount: number };

export async function applyNoShowAutoBlock(
  tx: DbTx,
  salonId: string,
  clientId: string,
  now: Date = new Date()
): Promise<NoShowAutoBlockOutcome> {
  const [salon] = await tx
    .select({ threshold: noShowAutoBlockThresholdColumn() })
    .from(salons)
    .where(eq(salons.id, salonId))
    .limit(1);
  const threshold = parseNoShowAutoBlockThreshold(salon?.threshold);
  if (threshold === null) return { kind: "off" };

  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
    .limit(1)
    .for("no key update");
  if (!client) return { kind: "client_missing", threshold };

  const [row] = await tx
    .select({ noShowCount: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.salonId, salonId),
        eq(appointments.clientId, clientId),
        eq(appointments.status, NO_SHOW_STATUS)
      )
    );
  const noShowCount = Number(row?.noShowCount ?? 0);
  if (!reachesNoShowAutoBlock(noShowCount, threshold)) return { kind: "below", threshold, noShowCount };

  const updated = await tx
    .update(clients)
    .set({ blockedAt: now, blockedBy: CLIENT_BLOCKED_BY_AUTO, blockNote: null, updatedAt: now })
    .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId), isNull(clients.blockedAt)))
    .returning({ id: clients.id });
  return updated.length > 0
    ? { kind: "blocked", threshold, noShowCount }
    : { kind: "already_blocked", threshold, noShowCount };
}
