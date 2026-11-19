import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { salonSubscriptions } from "@/lib/schema";
import {
  lockSalonSubscriptions,
  retrieveStripeSubscriptionLocked,
  withStripeSubscriptionLock,
  type SubscriptionTx,
} from "@/lib/subscription-locks";
import type Stripe from "stripe";

/**
 * Webhooki zmieniające stan subskrypcji (`customer.subscription.updated`,
 * `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`)
 * nie zapisują statusu z payloadu zdarzenia. Stripe nie gwarantuje kolejności
 * dostarczenia: blokada usuwa przeplot, ale nie przywraca kolejności, więc
 * status z późnego `invoice.paid` albo z `updated: active` po `deleted`
 * wskrzesiłby anulowaną subskrypcję. Dlatego pod blokadą stripe_sub czytany
 * jest BIEŻĄCY stan subskrypcji ze Stripe i z niego pochodzą status,
 * `canceledAt` i `trialEndsAt`. Okresu (`currentPeriodStart/End`) ten moduł
 * nie zapisuje w żadnym z tych zdarzeń; spośród nich okres zapisuje tylko
 * obsługa `invoice.paid` — z linii opłaconej faktury w samym zdarzeniu,
 * nigdy wstecz.
 *
 * Reguła lokalna (T3b, przegląd #62 §2b): lokalne
 * `canceled` jest końcowe, gdy Stripe to potwierdza — `canceled` /
 * `incomplete_expired` ALBO `cancel_at_period_end === true` (anulowanie
 * z panelu: Stripe ma jeszcze `active` do końca okresu). Wtedy żaden handler
 * go nie nadpisuje. Lokalne `canceled` przy subskrypcji, która w Stripe dalej
 * się odnawia (`cancel_at_period_end` ≠ true), to dryf albo wznowienie
 * w panelu Stripe: `logger.error` „manual handling” i zapis stanu ze Stripe —
 * inaczej salon płaci i nie ma planu.
 */

export type SubscriptionRow = typeof salonSubscriptions.$inferSelect;

export interface StripeSubscriptionState {
  id: string;
  status?: string | null;
  canceled_at?: number | null;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
}

/**
 * Stan Stripe → stan lokalny (`salon_subscriptions.status`: active, trialing,
 * past_due, canceled). `unpaid` (wyczerpane ponowienia, bez anulowania) →
 * past_due; `incomplete_expired` (końcowe w Stripe) → canceled. `incomplete`
 * i `paused` nie mają odpowiednika: zostaje zapisany stan + warn.
 */
const STRIPE_TO_LOCAL_STATUS: Record<string, string> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete_expired: "canceled",
};

export const FINAL_LOCAL_STATUS = "canceled";

/** Stany Stripe, w których subskrypcja się skończyła (nie da się jej wznowić). */
const STRIPE_ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * Subskrypcja w stanie końcowym Stripe (`canceled`, `incomplete_expired`).
 * Zaplanowane anulowanie (`cancel_at_period_end`) nie jest stanem końcowym.
 */
export function isStripeSubscriptionEnded(status: string | null | undefined): boolean {
  return STRIPE_ENDED_STATUSES.has(status ?? "");
}

/**
 * Lokalne `canceled` potwierdzone przez Stripe: subskrypcja zakończona albo
 * ustawiona na koniec okresu. Tylko wtedy `canceled` jest końcowe.
 */
export function isLocalCancelConfirmedByStripe(stripeSub: StripeSubscriptionState): boolean {
  return STRIPE_ENDED_STATUSES.has(stripeSub.status ?? "") || stripeSub.cancel_at_period_end === true;
}

export type LockedRowResult<T> = { found: false } | { found: true; value: T };

/**
 * Transakcja: lock_timeout → blokada stripe_sub → odczyt wiersza → bieżący
 * stan ze Stripe → blokada salonu → `fn`.
 *
 * Brak wiersza pod blokadą → `{ found: false }`: wołający oddaje 2xx + warn.
 * Bezpieczne, bo jedyna ścieżka zapisująca `stripeSubscriptionId`
 * (`subscription-confirmation.ts`) czyta Stripe na świeżo pod tą samą blokadą
 * — utracone zdarzenie nie gubi stanu (test niezmiennika:
 * `__tests__/api/subscription-locks-invariant.test.ts`).
 *
 * Błąd Stripe, `lock_timeout` (55P03) i zakleszczenie (40P01) są rzucane
 * dalej → webhook 500 → Stripe ponawia. Nigdy 2xx.
 */
export function withLockedStripeSubscriptionRow<T>(
  stripe: Stripe,
  stripeSubscriptionId: string,
  fn: (tx: SubscriptionTx, row: SubscriptionRow, stripeSub: StripeSubscriptionState) => Promise<T>
): Promise<LockedRowResult<T>> {
  return withStripeSubscriptionLock(stripeSubscriptionId, async (tx) => {
    const [row] = await tx
      .select()
      .from(salonSubscriptions)
      .where(eq(salonSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
    if (!row) return { found: false } as const;

    const stripeSub = (await retrieveStripeSubscriptionLocked(
      stripe,
      stripeSubscriptionId
    )) as unknown as StripeSubscriptionState;

    await lockSalonSubscriptions(tx, row.salonId);
    return { found: true, value: await fn(tx, row, stripeSub) } as const;
  });
}

export type SubscriptionStateUpdate = Partial<
  Pick<SubscriptionRow, "status" | "canceledAt" | "trialEndsAt">
>;

/**
 * Wartości do zapisania z bieżącego stanu Stripe albo `null`, gdy wiersz jest
 * `canceled`, a Stripe to potwierdza (stan końcowy — nic go nie nadpisuje).
 */
export function subscriptionStateFromStripe(
  row: SubscriptionRow,
  stripeSub: StripeSubscriptionState
): SubscriptionStateUpdate | null {
  if (row.status === FINAL_LOCAL_STATUS) {
    if (isLocalCancelConfirmedByStripe(stripeSub)) return null;
    // Dryf (np. dawne anulowanie lokalne mimo błędu Stripe) albo wznowienie
    // w panelu Stripe: Stripe dalej pobiera opłaty — stan ze Stripe wygrywa.
    logger.error("Local subscription canceled but Stripe still renews it — syncing Stripe state, manual handling", {
      subscriptionId: row.id,
      stripeSubscriptionId: stripeSub.id,
      stripeStatus: stripeSub.status ?? null,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end ?? null,
    });
  }

  const stripeStatus = stripeSub.status ?? "";
  const mapped = STRIPE_TO_LOCAL_STATUS[stripeStatus];
  if (!mapped) {
    logger.warn("Stripe subscription status without local equivalent — keeping stored status", {
      stripeSubscriptionId: stripeSub.id,
      stripeStatus,
      localStatus: row.status,
    });
  }
  const status = mapped ?? row.status;

  const canceledAt =
    typeof stripeSub.canceled_at === "number"
      ? new Date(stripeSub.canceled_at * 1000)
      : status === FINAL_LOCAL_STATUS
        ? (row.canceledAt ?? new Date())
        : null; // Stripe nie zgłasza anulowania — także po dryfie z lokalnego canceled

  return {
    status,
    canceledAt,
    // Trial po stronie Stripe: koniec ze Stripe, nie z rejestracji.
    ...(status === "trialing" && typeof stripeSub.trial_end === "number"
      ? { trialEndsAt: new Date(stripeSub.trial_end * 1000) }
      : {}),
  };
}
