/**
 * Wyjście systemowe (#193 P5a-1, decyzja CTO 4): rozwiązanie tokenu oferty z
 * listy oczekujących na wpis i salon. Klient akceptuje/odrzuca termin tokenem,
 * bez sesji salonu, więc salon trzeba ustalić przed wejściem w `forSalon`.
 *
 * Kontrakt: tylko odczyt, dopasowanie równościowe po tokenie, zwraca wyłącznie
 * id wpisu i salon. Wszystkie zapisy (`acceptEarlierSlot`/`declineEarlierSlot`
 * w `src/lib/waiting-list.ts`) idą przez `forSalon(salonId)` z wyniku. Ten moduł
 * nie dostaje funkcji zapisującej.
 *
 * Każda nowa funkcja tutaj zmienia migawkę `system/` (R-Z1) i migawkę
 * importerów L7.
 */
import { eq } from "drizzle-orm";
import { waitingList } from "@/lib/schema";
import { dbSystem } from "./db-system";

export type WaitingListTokenTarget = { waitingListId: string; salonId: string };

/** Wpis i salon dla tokenu oferty; null, gdy token pusty albo nieznany. */
export async function resolveWaitingListToken(token: string): Promise<WaitingListTokenTarget | null> {
  if (!token) return null;

  const [row] = await dbSystem
    .select({ waitingListId: waitingList.id, salonId: waitingList.salonId })
    .from(waitingList)
    .where(eq(waitingList.acceptToken, token))
    .limit(1);

  return row ?? null;
}
