/**
 * Okres rozliczeniowy ze Stripe — jedno miejsce odczytu (T3, warunek Ethana
 * dla 1.1, `scratchpad/ethan/1-1-trial.md` §2).
 *
 * Nowsze wersje API Stripe (SDK 20) trzymają `current_period_start/end` na
 * pozycjach subskrypcji (`items.data[0]`), nie na samej subskrypcji. Kod, który
 * czyta tylko poziom subskrypcji, w nowym API nie widzi okresu i zostawia
 * STARĄ datę — `canceled` traci dostęp przed końcem zapłaconego okresu,
 * `past_due` ma nieaktualny termin. Dlatego najpierw `items.data[0]`, potem
 * poziom subskrypcji (zdarzenia w starszej wersji API).
 */

export interface StripeSubscriptionPeriodSource {
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: {
    data?: Array<{ current_period_start?: number | null; current_period_end?: number | null }>;
  } | null;
}

export interface BillingPeriod {
  start: Date;
  end: Date;
}

function toPeriod(start: unknown, end: unknown): BillingPeriod | null {
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start: new Date(start * 1000), end: new Date(end * 1000) };
}

/** Okres subskrypcji: `items.data[0]`, a gdy go nie ma — poziom subskrypcji. */
export function stripeSubscriptionPeriod(sub: StripeSubscriptionPeriodSource): BillingPeriod | null {
  const item = sub.items?.data?.[0];
  return (
    toPeriod(item?.current_period_start, item?.current_period_end) ??
    toPeriod(sub.current_period_start, sub.current_period_end)
  );
}

export interface StripeInvoicePeriodSource {
  period_start?: number | null;
  period_end?: number | null;
  lines?: {
    data?: Array<{
      /** Starsze API: "subscription" | "invoiceitem". */
      type?: string | null;
      /** Nowsze API: `parent.type === "subscription_item_details"`. */
      parent?: { type?: string | null } | null;
      period?: { start?: number | null; end?: number | null } | null;
    }>;
  } | null;
}

/**
 * Okres opłacony fakturą subskrypcji: z pozycji subskrypcji na fakturze.
 * `invoice.period_start/end` dla faktury odnowienia opisuje okres, w którym
 * dodawano pozycje (poprzedni), a nie okres, za który klient właśnie zapłacił
 * — to tylko zapas, gdy faktura nie ma pozycji subskrypcji.
 */
export function stripeInvoicePeriod(invoice: StripeInvoicePeriodSource): BillingPeriod | null {
  const line = invoice.lines?.data?.find(
    (l) => l.type === "subscription" || l.parent?.type === "subscription_item_details"
  );
  return (
    toPeriod(line?.period?.start, line?.period?.end) ??
    toPeriod(invoice.period_start, invoice.period_end)
  );
}
