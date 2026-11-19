/**
 * Okres subskrypcji Stripe (`stripeSubscriptionPeriod`).
 *
 * Najpierw `items.data[0].current_period_start/end`, a gdy pozycja nie ma
 * pełnego okresu — `current_period_start/end` na poziomie subskrypcji.
 * Funkcja nie filtruje okresu o zerowej długości (`start` = `end`): zwraca go
 * bez zmian, także gdy poziom subskrypcji ma inny okres.
 */
import { describe, it, expect } from "vitest";
import { stripeSubscriptionPeriod } from "@/lib/stripe-period";

const JUL_START = 1783296000; // 2026-07-06T00:00:00Z
const JUL_END = 1785888000; // 2026-08-05T00:00:00Z
const AUG_END = 1788566400; // 2026-09-05T00:00:00Z

const period = (start: number, end: number) => ({
  start: new Date(start * 1000),
  end: new Date(end * 1000),
});

describe("stripeSubscriptionPeriod", () => {
  it("okres w items.data[0] i na poziomie subskrypcji → okres z items.data[0]", () => {
    expect(
      stripeSubscriptionPeriod({
        current_period_start: JUL_START,
        current_period_end: JUL_END,
        items: { data: [{ current_period_start: JUL_END, current_period_end: AUG_END }] },
      })
    ).toEqual(period(JUL_END, AUG_END));
  });

  it("pozycja bez okresu → okres z poziomu subskrypcji", () => {
    expect(
      stripeSubscriptionPeriod({
        current_period_start: JUL_START,
        current_period_end: JUL_END,
        items: { data: [{}] },
      })
    ).toEqual(period(JUL_START, JUL_END));
  });

  it("brak items → okres z poziomu subskrypcji", () => {
    expect(
      stripeSubscriptionPeriod({ current_period_start: JUL_START, current_period_end: JUL_END })
    ).toEqual(period(JUL_START, JUL_END));
  });

  it("brak okresu w items i na poziomie subskrypcji → null", () => {
    expect(stripeSubscriptionPeriod({ items: { data: [{}] } })).toBeNull();
    expect(stripeSubscriptionPeriod({})).toBeNull();
  });

  it("pozycja z okresem o zerowej długości → ten okres bez zmian, mimo pełnego okresu na poziomie subskrypcji", () => {
    expect(
      stripeSubscriptionPeriod({
        current_period_start: JUL_START,
        current_period_end: AUG_END,
        items: { data: [{ current_period_start: JUL_END, current_period_end: JUL_END }] },
      })
    ).toEqual(period(JUL_END, JUL_END));
  });

  it("okres o zerowej długości tylko na poziomie subskrypcji → ten okres bez zmian", () => {
    expect(
      stripeSubscriptionPeriod({ current_period_start: JUL_END, current_period_end: JUL_END })
    ).toEqual(period(JUL_END, JUL_END));
  });
});
