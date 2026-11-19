/**
 * Wspólne predykaty subskrypcji salonu. Ten sam warunek konfliktu
 * w `subscriptions/checkout` (przed utworzeniem sesji Stripe) i w
 * `confirmSubscriptionCheckout` (po płatności): dzięki temu 409 w confirm
 * jest ostatnią linią obrony, a nie miejscem, gdzie klient dowiaduje się
 * o konflikcie już po pobraniu pieniędzy. Tu też wybór wiersza i stan
 * dostępu salonu (`pickSalonAccessRow`, `resolveSalonAccess`).
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

/** Dni pełnego dostępu dla wiersza `past_due` (liczone od `currentPeriodEnd`). */
export const PAST_DUE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SalonAccessState =
  | "trialing"
  | "expired"
  | "active"
  | "past_due"
  | "canceled"
  | "inactive"
  | "none"
  | "unavailable";

export type SalonAccessMode = "full" | "read_only";

/**
 * Stan dostępu salonu. `planSlug` jest ustawiony tylko przy pełnym dostępie;
 * `until` to koniec pełnego dostępu (null, gdy brak terminu albo tylko odczyt).
 */
export type SalonAccess = {
  state: SalonAccessState;
  mode: SalonAccessMode;
  planSlug: string | null;
  until: Date | null;
};

/** Wiersz subskrypcji salonu z planem, z którego liczony jest dostęp. */
export type SalonSubscriptionAccessRow = {
  status: string;
  planSlug: string;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
};

/** Dostęp, gdy subskrypcji salonu nie udało się odczytać. */
export const SALON_ACCESS_UNAVAILABLE: SalonAccess = {
  state: "unavailable",
  mode: "read_only",
  planSlug: null,
  until: null,
};

function readOnly(state: SalonAccessState): SalonAccess {
  return { state, mode: "read_only", planSlug: null, until: null };
}

function full(state: SalonAccessState, planSlug: string, until: Date | null): SalonAccess {
  return { state, mode: "full", planSlug, until };
}

/**
 * Wiersz, z którego liczony jest dostęp: bieżący (`trialing`/`active`, co
 * najwyżej jeden), a bez niego najnowszy po `createdAt`. Przy tym samym
 * `createdAt` wygrywa pierwszy wiersz wejścia, więc o wyniku decyduje
 * kolejność nadana przez wołającego.
 */
export function pickSalonAccessRow<R extends SalonSubscriptionAccessRow>(rows: readonly R[]): R | undefined {
  const current = rows.find((r) => isCurrentLocalStatus(r.status));
  if (current) return current;
  let newest: R | undefined;
  for (const r of rows) {
    if (!newest || r.createdAt.getTime() > newest.createdAt.getTime()) newest = r;
  }
  return newest;
}

/**
 * Stan dostępu salonu z wszystkich jego wierszy subskrypcji w chwili `now`.
 * Terminy są wyłączne, porównanie w JS (kolumny są bez strefy):
 * - brak wierszy → `none`, tylko odczyt;
 * - `trialing` → pełny dostęp do `trialEndsAt`; po nim albo bez daty → `expired`;
 * - `active` → pełny dostęp niezależnie od dat;
 * - `past_due` → pełny dostęp do `currentPeriodEnd` + `PAST_DUE_GRACE_DAYS`;
 *   po nim albo bez `currentPeriodEnd` → tylko odczyt;
 * - `canceled` → pełny dostęp do `currentPeriodEnd`; po nim albo bez
 *   `currentPeriodEnd` → tylko odczyt;
 * - inny status → `inactive`, tylko odczyt.
 * `currentPeriodStart` nie wpływa na wynik.
 */
export function resolveSalonAccess(rows: readonly SalonSubscriptionAccessRow[], now: Date): SalonAccess {
  const row = pickSalonAccessRow(rows);
  if (!row) return readOnly("none");

  const nowMs = now.getTime();
  switch (row.status) {
    case "trialing":
      return row.trialEndsAt && row.trialEndsAt.getTime() > nowMs
        ? full("trialing", row.planSlug, row.trialEndsAt)
        : readOnly("expired");
    case "active":
      return full("active", row.planSlug, row.currentPeriodEnd);
    case "past_due": {
      if (!row.currentPeriodEnd) return readOnly("past_due");
      const graceEnd = new Date(row.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
      return nowMs < graceEnd.getTime() ? full("past_due", row.planSlug, graceEnd) : readOnly("past_due");
    }
    case "canceled":
      return row.currentPeriodEnd && row.currentPeriodEnd.getTime() > nowMs
        ? full("canceled", row.planSlug, row.currentPeriodEnd)
        : readOnly("canceled");
    default:
      return readOnly("inactive");
  }
}

/**
 * Naruszenie indeksu unikalnego (23505), także opakowane przez Drizzle
 * w `cause` — np. `salons_owner_id_uq` albo `salon_subscriptions_salon_current_uq`
 * przy równoległej rejestracji.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 3; depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
