/**
 * Kwota i waluta wpisu płatności ze Stripe (`stripeAmountToColumns`):
 * najmniejsze jednostki waluty (liczba całkowita) → napis kolumny
 * `numeric(10,2)` i kod waluty wielkimi literami; dane, których nie da się
 * przeliczyć, → `null`.
 */
import { describe, it, expect } from "vitest";
import { stripeAmountToColumns } from "@/lib/stripe-amount";

describe("stripeAmountToColumns", () => {
  it('stripeAmountToColumns: 14900 + "pln" → { amount: "149.00", currency: "PLN" }', () => {
    expect(stripeAmountToColumns(14900, "pln")).toEqual({ amount: "149.00", currency: "PLN" });
  });

  it('stripeAmountToColumns: granice groszy 0→"0.00", 1→"0.01", 1005→"10.05", 9999999999→"99999999.99"', () => {
    expect(stripeAmountToColumns(0, "pln")).toEqual({ amount: "0.00", currency: "PLN" });
    expect(stripeAmountToColumns(1, "pln")).toEqual({ amount: "0.01", currency: "PLN" });
    expect(stripeAmountToColumns(1005, "pln")).toEqual({ amount: "10.05", currency: "PLN" });
    expect(stripeAmountToColumns(9999999999, "pln")).toEqual({ amount: "99999999.99", currency: "PLN" });
  });

  it('stripeAmountToColumns: null dla undefined, 12.5, -1, 10000000000, "jpy", "kwd", "pl"', () => {
    expect(stripeAmountToColumns(undefined, "pln")).toBeNull();
    expect(stripeAmountToColumns(12.5, "pln")).toBeNull();
    expect(stripeAmountToColumns(-1, "pln")).toBeNull();
    expect(stripeAmountToColumns(10000000000, "pln")).toBeNull();
    expect(stripeAmountToColumns(14900, "jpy")).toBeNull();
    expect(stripeAmountToColumns(14900, "kwd")).toBeNull();
    expect(stripeAmountToColumns(14900, "pl")).toBeNull();
  });

  it('stripeAmountToColumns: null dla kwoty podanej jako napis ("14900") i dla waluty niebędącej napisem', () => {
    expect(stripeAmountToColumns("14900", "pln")).toBeNull();
    expect(stripeAmountToColumns(14900, undefined)).toBeNull();
    expect(stripeAmountToColumns(14900, 985)).toBeNull();
  });

  it('stripeAmountToColumns: "PLN" i "Pln" → waluta "PLN"', () => {
    expect(stripeAmountToColumns(14900, "PLN")).toEqual({ amount: "149.00", currency: "PLN" });
    expect(stripeAmountToColumns(14900, "Pln")).toEqual({ amount: "149.00", currency: "PLN" });
  });
});
