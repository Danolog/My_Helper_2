/**
 * Okres opłacony fakturą Stripe (`paidInvoicePeriod`).
 *
 * Okres opłacony to `lines.data[].period` linii o największym `end` (start
 * z tej samej linii). Liczą się tylko linie o dodatniej długości okresu
 * (`end > start`) — pozycje jednorazowe (`start` = `end`) są pomijane.
 * Pola `period_start/period_end` samej faktury opisują okres poprzedni
 * (faktura odnowienia), więc funkcja ich nie czyta.
 */
import { describe, it, expect } from "vitest";
import { paidInvoicePeriod, type StripeInvoicePeriodSource } from "@/lib/stripe-period";

const JUL_START = 1783296000; // 2026-07-06T00:00:00Z
const JUL_END = 1785888000; // 2026-08-05T00:00:00Z
const AUG_END = 1788566400; // 2026-09-05T00:00:00Z
const LATE_START = 1786924800; // 2026-08-17T00:00:00Z (największy start, ale nie największy end)
const LATE_END = 1787788800; // 2026-08-27T00:00:00Z
const JUN_START = 1780704000; // 2026-06-06T00:00:00Z

describe("paidInvoicePeriod", () => {
  it("jedna linia → jej okres", () => {
    const period = paidInvoicePeriod({
      lines: { data: [{ period: { start: JUL_START, end: JUL_END } }] },
    });
    expect(period).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(JUL_END * 1000),
    });
    expect(period?.end.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("wiele linii → linia o największym end, start z tej samej linii", () => {
    const period = paidInvoicePeriod({
      lines: {
        data: [
          { period: { start: LATE_START, end: LATE_END } },
          { period: { start: JUL_START, end: AUG_END } },
          { period: { start: JUN_START, end: JUL_START } },
        ],
      },
    });
    expect(period).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(AUG_END * 1000),
    });
  });

  it("równe end w dwóch liniach → pierwsza", () => {
    const period = paidInvoicePeriod({
      lines: {
        data: [
          { period: { start: JUL_START, end: AUG_END } },
          { period: { start: LATE_START, end: AUG_END } },
        ],
      },
    });
    expect(period).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(AUG_END * 1000),
    });
  });

  it("linie z niepełnym okresem pominięte, gdy obok jest pełna", () => {
    const period = paidInvoicePeriod({
      lines: {
        data: [
          { period: { end: AUG_END } },
          { period: { start: LATE_START, end: null } },
          { period: null },
          {},
          { period: { start: JUL_START, end: JUL_END } },
        ],
      },
    });
    expect(period).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(JUL_END * 1000),
    });
  });

  it("brak lines → null", () => {
    expect(paidInvoicePeriod({})).toBeNull();
  });

  it("lines: null → null", () => {
    expect(paidInvoicePeriod({ lines: null })).toBeNull();
  });

  it("lines.data: null → null", () => {
    expect(paidInvoicePeriod({ lines: { data: null } })).toBeNull();
  });

  it("pusta lista linii → null", () => {
    expect(paidInvoicePeriod({ lines: { data: [] } })).toBeNull();
  });

  it("same niepełne linie → null", () => {
    expect(
      paidInvoicePeriod({
        lines: {
          data: [{ period: { end: AUG_END } }, { period: { start: JUL_START, end: null } }, { period: null }],
        },
      })
    ).toBeNull();
  });

  it("sama pozycja jednorazowa (start = end) → null", () => {
    expect(
      paidInvoicePeriod({
        lines: { data: [{ period: { start: JUL_END, end: JUL_END } }] },
      })
    ).toBeNull();
  });

  it("pozycja jednorazowa z end późniejszym niż linia planu → okres linii planu", () => {
    const period = paidInvoicePeriod({
      lines: {
        data: [
          { period: { start: JUL_START, end: JUL_END } },
          { period: { start: AUG_END, end: AUG_END } },
        ],
      },
    });
    expect(period).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(JUL_END * 1000),
    });
  });

  it("linia z end wcześniejszym niż start pominięta, gdy obok jest poprawna", () => {
    const period = paidInvoicePeriod({
      lines: {
        data: [
          { period: { start: AUG_END, end: LATE_END } },
          { period: { start: JUL_START, end: JUL_END } },
        ],
      },
    });
    expect(period).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(JUL_END * 1000),
    });
  });

  it("same linie o zerowej albo ujemnej długości okresu → null", () => {
    expect(
      paidInvoicePeriod({
        lines: {
          data: [
            { period: { start: JUL_END, end: JUL_END } },
            { period: { start: AUG_END, end: LATE_START } },
          ],
        },
      })
    ).toBeNull();
  });

  it("okres na poziomie faktury bez linii → null (to okres poprzedni)", () => {
    const invoice: StripeInvoicePeriodSource & { period_start: number; period_end: number } = {
      period_start: JUN_START,
      period_end: JUL_START,
    };
    expect(paidInvoicePeriod(invoice)).toBeNull();
  });

  it("okres na poziomie faktury i linie → okres z linii, nie z poziomu faktury", () => {
    const invoice: StripeInvoicePeriodSource & { period_start: number; period_end: number } = {
      period_start: JUN_START,
      period_end: JUL_START,
      lines: { data: [{ period: { start: JUL_START, end: JUL_END } }] },
    };
    expect(paidInvoicePeriod(invoice)).toEqual({
      start: new Date(JUL_START * 1000),
      end: new Date(JUL_END * 1000),
    });
  });
});
