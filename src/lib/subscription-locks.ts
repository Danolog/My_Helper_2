import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { forSalon } from "@/lib/server/repository";
import type { DbTx } from "@/lib/server/repository";
import { SUBSCRIPTION_LOCK_NAMESPACE } from "@/lib/subscription-lock-namespace";
import type Stripe from "stripe";

/**
 * Blokady subskrypcji salonu (T3, ostrzeżenia [MEDIUM] #2 TOCTOU i #3
 * „zdarzenie przed wierszem”).
 *
 * Dwie przestrzenie `pg_advisory_xact_lock(<przestrzeń>, hashtext(id))`, obie
 * tylko w wersji `xact` (zwalniane przy COMMIT/ROLLBACK, działają przez pooler
 * transakcyjny Neon/PgBouncer; wersji sesyjnej użyć nie wolno):
 *
 * - `stripe_sub` — klucz z id subskrypcji Stripe. Zna go KAŻDY uczestnik,
 *   zanim cokolwiek przeczyta z bazy: webhook ze zdarzenia, confirm z sesji
 *   Checkout. Pod nią webhook szuka wiersza, a confirm i webhook czytają
 *   bieżący stan ze Stripe.
 * - `salon` — wiersze subskrypcji salonu (także jeszcze nieistniejące:
 *   FOR UPDATE nie blokuje braku wiersza).
 *
 * REGUŁY (pilnowane w kodzie, `assertLockOrder`):
 * 1. kolejność: stripe_sub → (odczyt Stripe) → salon. Odczyt sieciowy jest
 *    przed blokadą salonu, więc blokada salonu nie trwa przez wywołanie Stripe;
 * 2. co najwyżej jedna blokada z każdej przestrzeni na transakcję (np. gałąź
 *    SUBSCRIPTION_CONFLICT w confirm nie bierze drugiej stripe_sub);
 * 3. `SET LOCAL lock_timeout = '5s'` — czekanie dłuższe niż limit Stripe nie
 *    kończy się ciszą, tylko błędem 55P03 → webhook 500 (Stripe ponowi),
 *    confirm 503.
 * Przy tych regułach confirm ‖ webhook nie mają cyklu oczekiwania; gdyby mimo
 * to doszło do zakleszczenia, Postgres zwróci 40P01 — obsłużone jak timeout.
 */

export { SUBSCRIPTION_LOCK_NAMESPACE };

export const SUBSCRIPTION_LOCK_TIMEOUT = "5s";

/**
 * Odczyt Stripe pod blokadą stripe_sub, w otwartej transakcji: jawny limit
 * czasu zamiast domyślnych 80 s SDK (pula `max: 5` na instancję — każde
 * połączenie trzymane przez wolny Stripe ją zjada).
 */
export const STRIPE_LOCKED_READ_OPTIONS = { timeout: 8_000 } as const;

/** Transakcja Drizzle — typ z repozytorium (ten sam klient dla `db` i `forSalon`). */
export type SubscriptionTx = DbTx;

type Namespace = keyof typeof SUBSCRIPTION_LOCK_NAMESPACE;

const takenLocks = new WeakMap<object, Set<Namespace>>();

function assertLockOrder(tx: SubscriptionTx, namespace: Namespace): void {
  const taken = takenLocks.get(tx) ?? new Set<Namespace>();
  if (taken.has(namespace)) {
    throw new Error(`Subscription lock order violated: second ${namespace} lock in one transaction`);
  }
  if (namespace === "stripeSub" && taken.has("salon")) {
    throw new Error("Subscription lock order violated: stripe_sub lock after salon lock");
  }
  taken.add(namespace);
  takenLocks.set(tx, taken);
}

async function advisoryLock(tx: SubscriptionTx, namespace: Namespace, key: string): Promise<void> {
  assertLockOrder(tx, namespace);
  const ns = SUBSCRIPTION_LOCK_NAMESPACE[namespace];
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(ns))}, hashtext(${key}))`);
}

/** `SET LOCAL lock_timeout` — na początku każdej transakcji z blokadą subskrypcji. */
export async function setSubscriptionLockTimeout(tx: SubscriptionTx): Promise<void> {
  await tx.execute(sql.raw(`set local lock_timeout = '${SUBSCRIPTION_LOCK_TIMEOUT}'`));
}

/** Blokada subskrypcji Stripe — zawsze PIERWSZA w transakcji. */
export function lockStripeSubscription(tx: SubscriptionTx, stripeSubscriptionId: string): Promise<void> {
  return advisoryLock(tx, "stripeSub", stripeSubscriptionId);
}

/** Blokada wierszy subskrypcji salonu — po stripe_sub i po odczycie Stripe. */
export function lockSalonSubscriptions(tx: SubscriptionTx, salonId: string): Promise<void> {
  return advisoryLock(tx, "salon", salonId);
}

/** Transakcja z limitem czekania na blokadę i blokadą stripe_sub. */
export function withStripeSubscriptionLock<T>(
  stripeSubscriptionId: string,
  fn: (tx: SubscriptionTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await setSubscriptionLockTimeout(tx);
    await lockStripeSubscription(tx, stripeSubscriptionId);
    return fn(tx);
  });
}

/**
 * Transakcja z limitem czekania i TYLKO blokadą salonu — dla trasy, która
 * zmienia wiersz salonu bez wywołania Stripe (downgrade).
 * Webhook i confirm biorą tę samą blokadę salonu przed zapisem, więc odczyt
 * „active” i zapis nie przeplatają się z nimi. Reguła kolejności zachowana (brak stripe_sub).
 * Transakcja `forSalon(salonId).raw`: rola aplikacji i RLS salonu (druga tama),
 * `lock_timeout` i blokada salonu dopiero po ustawieniu kontekstu.
 */
export function withSalonSubscriptionLock<T>(
  salonId: string,
  fn: (tx: SubscriptionTx) => Promise<T>
): Promise<T> {
  return forSalon(salonId).raw(async (tx) => {
    await setSubscriptionLockTimeout(tx);
    await lockSalonSubscriptions(tx, salonId);
    return fn(tx);
  });
}

/** Bieżący stan subskrypcji ze Stripe, z limitem czasu na odczyt pod blokadą. */
export function retrieveStripeSubscriptionLocked(
  stripe: Stripe,
  stripeSubscriptionId: string
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(stripeSubscriptionId, {}, STRIPE_LOCKED_READ_OPTIONS);
}

/**
 * Zakleszczenie (40P01) albo przekroczony `lock_timeout` (55P03), także
 * opakowane przez Drizzle w `cause`. Nigdy 2xx: webhook 500, confirm 503.
 */
export function isSubscriptionLockFailure(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    const code = (e as { code?: unknown }).code;
    if (code === "40P01" || code === "55P03") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
