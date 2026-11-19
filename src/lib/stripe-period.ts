/**
 * Okres rozliczeniowy ze Stripe — jedno miejsce odczytu (T3, warunek dla 1.1).
 *
 * Nowsze wersje API Stripe (SDK 20) trzymają `current_period_start/end` na
 * pozycjach subskrypcji (`items.data[0]`), nie na samej subskrypcji. Kod, który
 * czyta tylko poziom subskrypcji, w nowym API nie widzi okresu i zostawia
 * STARĄ datę — `canceled` traci dostęp przed końcem zapłaconego okresu,
 * `past_due` ma nieaktualny termin. Dlatego najpierw `items.data[0]`, potem
 * poziom subskrypcji (zdarzenia w starszej wersji API).
 *
 * Okres opłacony fakturą czytamy z linii faktury (`lines.data[].period`), nie
 * z `period_start/end` samej faktury — tam faktura odnowienia ma okres poprzedni.
 * Linie o zerowej długości okresu (pozycje jednorazowe) są pomijane.
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
  lines?: {
    data?: Array<{ period?: { start?: number | null; end?: number | null } | null }> | null;
  } | null;
}

/**
 * Okres opłacony fakturą: linia o największym `period.end` (start z tej samej
 * linii). Liczą się tylko linie o dodatniej długości okresu (`end > start`) —
 * pozycje jednorazowe (`start` = `end`) są pomijane.
 */
export function paidInvoicePeriod(invoice: StripeInvoicePeriodSource): BillingPeriod | null {
  let best: BillingPeriod | null = null;
  for (const line of invoice.lines?.data ?? []) {
    const period = toPeriod(line.period?.start, line.period?.end);
    if (!period || period.end.getTime() <= period.start.getTime()) continue;
    if (!best || period.end.getTime() > best.end.getTime()) best = period;
  }
  return best;
}
