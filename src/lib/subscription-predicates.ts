/**
 * Wspólne predykaty subskrypcji salonu (T3b). Ten sam warunek konfliktu
 * w `subscriptions/checkout` (przed utworzeniem sesji Stripe) i w
 * `confirmSubscriptionCheckout` (po płatności): dzięki temu 409 w confirm
 * jest ostatnią linią obrony, a nie miejscem, gdzie klient dowiaduje się
 * o konflikcie już po pobraniu pieniędzy (Ethan, przegląd #62 §6).
 *
 * Bez importu `db` — używają go też atrapy w testach.
 */

/** Stany „bieżącej” subskrypcji: co najwyżej jeden taki wiersz na salon (indeks `salon_subscriptions_salon_current_uq`). */
export const CURRENT_LOCAL_STATUSES = ["trialing", "active"] as const;

export function isCurrentLocalStatus(status: string): boolean {
  return (CURRENT_LOCAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Prawdziwa subskrypcja w Stripe (nie null i nie identyfikator z dawnej
 * symulacji `sim_*`). Nasz trial z rejestracji ma `null`.
 */
export function hasRealStripeSubscription(stripeSubscriptionId: string | null | undefined): boolean {
  return !!stripeSubscriptionId && !stripeSubscriptionId.startsWith("sim_");
}

/**
 * Wiersz bieżący (trialing/active) z prawdziwą subskrypcją Stripe — za taki
 * Stripe pobiera albo pobierze opłaty. Nowy Checkout obok niego założyłby
 * drugą subskrypcję (podwójne obciążenie), a nadpisanie osierociłoby go.
 */
export function isCurrentPaidStripeRow(row: { status: string; stripeSubscriptionId: string | null }): boolean {
  return isCurrentLocalStatus(row.status) && hasRealStripeSubscription(row.stripeSubscriptionId);
}
