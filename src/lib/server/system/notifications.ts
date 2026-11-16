/**
 * Wyjście systemowe (#193 P5a-1): subskrypcje push użytkownika po stronie
 * wysyłki. Subskrypcja należy do użytkownika, nie do salonu, więc nie idzie
 * przez `forSalon`. Strona użytkownika (subscribe/unsubscribe) to osobna partia.
 *
 * Każda nowa funkcja tutaj zmienia migawkę `system/` (R-Z1) i migawkę
 * importerów L7, więc jest widoczna w diffie i w recenzji.
 */
import { and, eq, inArray } from "drizzle-orm";
import { pushSubscriptions } from "@/lib/schema";
import { dbSystem } from "./db-system";

/** Subskrypcja w kształcie potrzebnym do wysyłki (bez innych kolumn). */
export type PushSubscriptionForSend = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Subskrypcje push użytkownika — tylko kolumny potrzebne do wysyłki. */
export async function getPushSubscriptionsForUser(userId: string): Promise<PushSubscriptionForSend[]> {
  return dbSystem
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/**
 * Kasuje subskrypcje użytkownika o podanych id: `WHERE user_id = $1 AND id IN (...)`.
 *
 * Kontrakt: wyjście NIE ocenia, czy wiersz jest wadliwy — decyduje wywołujący
 * (`src/lib/push.ts`: wiersz spoza allowlisty usług push albo odrzucony przez
 * dostawcę jako 404/410). Id cudzego użytkownika na liście nie jest kasowane.
 * Pusta lista = no-op bez zapytania (nigdy „wszystkie subskrypcje użytkownika”).
 *
 * @returns liczba skasowanych wierszy
 */
export async function deleteUndeliverablePushSubscriptions(
  userId: string,
  subscriptionIds: string[]
): Promise<number> {
  if (subscriptionIds.length === 0) return 0;

  const deleted = await dbSystem
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), inArray(pushSubscriptions.id, subscriptionIds)))
    .returning({ id: pushSubscriptions.id });

  return deleted.length;
}
