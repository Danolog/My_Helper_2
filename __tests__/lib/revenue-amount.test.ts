/**
 * Kwota wizyty w raporcie przychodu (`appointmentRevenueCents`).
 *
 * Wizyta z kwotą wpisaną przy zakończeniu liczy się tą kwotą w swojej metodzie;
 * bez zapisu płatności — dawnym wzorem max(0, cena − rabat) w grupie `none`.
 */
import { describe, expect, it } from "vitest";
import {
  REVENUE_METHOD_LABELS,
  REVENUE_METHOD_ORDER,
  REVENUE_NO_RECORD_NOTE,
  REVENUE_SOURCE_NOTE,
  appointmentRevenueCents,
  centsToAmount,
  discountCents,
  revenueShare,
  type RevenueAppointmentRow,
} from "@/lib/reports/revenue-amount";

function row(overrides: Partial<RevenueAppointmentRow>): RevenueAppointmentRow {
  return { paidAmount: null, paymentMethod: null, basePrice: "120.00", discountAmount: null, ...overrides };
}

describe("appointmentRevenueCents", () => {
  it("kwota wpisana: 100.00 gotówką przy cenie 120 i rabacie 20 → 10000 gr, cash", () => {
    expect(
      appointmentRevenueCents(row({ paidAmount: "100.00", paymentMethod: "cash", discountAmount: "20.00" }))
    ).toEqual({ cents: 10000, method: "cash" });
  });

  it("kwota wpisana inna od ceny: 80.00 kartą przy cenie 120 → 8000 gr, card (cena nie wpływa)", () => {
    expect(appointmentRevenueCents(row({ paidAmount: "80.00", paymentMethod: "card" }))).toEqual({
      cents: 8000,
      method: "card",
    });
  });

  it("0 zł BLIK-iem to prawdziwa kwota 0, nie wzór zastępczy i nie `none`", () => {
    expect(appointmentRevenueCents(row({ paidAmount: "0.00", paymentMethod: "blik" }))).toEqual({
      cents: 0,
      method: "blik",
    });
  });

  describe("bez zapisu płatności (dawny wzór, grupa none)", () => {
    it("cena 120, rabat 20 → 10000 gr", () => {
      expect(appointmentRevenueCents(row({ discountAmount: "20.00" }))).toEqual({ cents: 10000, method: "none" });
    });

    it("rabat 150 większy od ceny → 0, nie kwota ujemna", () => {
      expect(appointmentRevenueCents(row({ discountAmount: "150.00" }))).toEqual({ cents: 0, method: "none" });
    });

    it("brak ceny (usunięta usługa) → 0", () => {
      expect(appointmentRevenueCents(row({ basePrice: null, discountAmount: "20.00" }))).toEqual({
        cents: 0,
        method: "none",
      });
    });

    it("rabat null liczy się jak 0 → 12000 gr", () => {
      expect(appointmentRevenueCents(row({ discountAmount: null }))).toEqual({ cents: 12000, method: "none" });
    });
  });

  it("metoda spoza listy przy kwocie → grupa none, kwota wpisana, bez wyjątku", () => {
    expect(appointmentRevenueCents(row({ paidAmount: "45.50", paymentMethod: "transfer" }))).toEqual({
      cents: 4550,
      method: "none",
    });
  });

  it("grosze: 99.99 + 0.01 zsumowane w groszach dają dokładnie 100.00", () => {
    const a = appointmentRevenueCents(row({ paidAmount: "99.99", paymentMethod: "cash" }));
    const b = appointmentRevenueCents(row({ paidAmount: "0.01", paymentMethod: "cash" }));
    expect(a.cents + b.cents).toBe(10000);
    expect(centsToAmount(a.cents + b.cents)).toBe("100.00");
  });
});

describe("pomocniki formatu", () => {
  it("centsToAmount: dwa miejsca po przecinku", () => {
    expect(centsToAmount(0)).toBe("0.00");
    expect(centsToAmount(12345)).toBe("123.45");
    expect(centsToAmount(1005)).toBe("10.05");
  });

  it("revenueShare: jedno miejsce, przy sumie 0 → 0.0, dokładny wynik na granicy zaokrąglenia", () => {
    expect(revenueShare(0, 0)).toBe("0.0");
    expect(revenueShare(5, 0)).toBe("0.0");
    expect(revenueShare(4120, 10000)).toBe("41.2");
    expect(revenueShare(80, 32000)).toBe("0.3");
  });

  it("discountCents: brak rabatu = 0", () => {
    expect(discountCents(null)).toBe(0);
    expect(discountCents("20.50")).toBe(2050);
  });
});

describe("stałe tekstów", () => {
  it("kolejność i etykiety grup", () => {
    expect(REVENUE_METHOD_ORDER).toEqual(["cash", "card", "blik", "none"]);
    expect(REVENUE_METHOD_LABELS).toEqual({
      cash: "Gotówka",
      card: "Karta",
      blik: "BLIK",
      none: "Bez zapisu płatności",
    });
  });

  it("zdania o źródle kwot dosłownie", () => {
    expect(REVENUE_SOURCE_NOTE).toBe(
      "Przychód to kwoty wpisane przy zakończeniu wizyty. Nie pochodzi z kasy fiskalnej ani z terminala płatniczego."
    );
    expect(REVENUE_NO_RECORD_NOTE).toBe(
      "Bez zapisu płatności: wizyty zakończone, zanim aplikacja zaczęła pytać o kwotę i metodę. Ich kwota to cena usługi minus rabat."
    );
  });
});
