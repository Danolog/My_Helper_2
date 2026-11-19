import { sql } from "drizzle-orm";
import { salonSubscriptions } from "@/lib/schema";
import type { BillingPeriod } from "@/lib/stripe-period";

/**
 * Paid period values for an update of salon_subscriptions, computed in SQL
 * at write time, i.e. under the row lock held by the writing transaction (a
 * row read before the lock may be stale, so the comparison cannot be done in
 * JS): the end never moves back (`greatest` skips NULL), the start follows only a
 * strictly later end — a retried event or an older invoice changes nothing.
 */
export function paidPeriodEndSql(period: BillingPeriod) {
  return sql`greatest(${salonSubscriptions.currentPeriodEnd}, ${period.end.toISOString()}::timestamp)`;
}

export function paidPeriodStartSql(period: BillingPeriod) {
  const end = sql`${period.end.toISOString()}::timestamp`;
  const storedEnd = salonSubscriptions.currentPeriodEnd;
  return sql`case when ${storedEnd} is null or ${end} > ${storedEnd} then ${period.start.toISOString()}::timestamp else ${salonSubscriptions.currentPeriodStart} end`;
}
