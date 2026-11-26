import { describe, it, expect, vi, beforeEach } from "vitest";
import { clientDepositPatch, depositsDisabledMessage } from "@/lib/deposit-ui";
import { DEPOSITS_DISABLED_MESSAGE } from "@/lib/features";

// Pomocniki panelu dla wyłączonego zadatku (isDepositEnabled): pola zadatku
// klienta w PUT i komunikat dla 409 DEPOSITS_DISABLED.

const flags = vi.hoisted(() => ({ deposit: false }));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isDepositEnabled: () => flags.deposit,
}));

describe("clientDepositPatch", () => {
  beforeEach(() => {
    flags.deposit = false;
  });

  it("zadatek wyłączony: brak pól zadatku, także przy fladze true z formularza", () => {
    expect(clientDepositPatch({ requireDeposit: true, depositType: "fixed", depositValue: "50" })).toEqual({});
    expect(clientDepositPatch({ requireDeposit: false, depositType: "percentage", depositValue: "" })).toEqual({});
  });

  it("zadatek włączony: pola zadatku jak w formularzu", () => {
    flags.deposit = true;
    expect(clientDepositPatch({ requireDeposit: true, depositType: "fixed", depositValue: "50" })).toEqual({
      requireDeposit: true,
      depositType: "fixed",
      depositValue: "50",
    });
  });

  it("zadatek włączony: bez wymogu albo bez wartości — depositValue null", () => {
    flags.deposit = true;
    expect(clientDepositPatch({ requireDeposit: false, depositType: "percentage", depositValue: "30" })).toEqual({
      requireDeposit: false,
      depositType: "percentage",
      depositValue: null,
    });
    expect(clientDepositPatch({ requireDeposit: true, depositType: "percentage", depositValue: "" })).toEqual({
      requireDeposit: true,
      depositType: "percentage",
      depositValue: null,
    });
  });
});

describe("depositsDisabledMessage", () => {
  it("DEPOSITS_DISABLED z tekstem z API → tekst z API", () => {
    expect(depositsDisabledMessage({ success: false, code: "DEPOSITS_DISABLED", error: "Tekst z API" })).toBe(
      "Tekst z API"
    );
  });

  it("DEPOSITS_DISABLED bez tekstu → stały komunikat", () => {
    expect(depositsDisabledMessage({ success: false, code: "DEPOSITS_DISABLED" })).toBe(DEPOSITS_DISABLED_MESSAGE);
    expect(depositsDisabledMessage({ success: false, code: "DEPOSITS_DISABLED", error: "  " })).toBe(
      DEPOSITS_DISABLED_MESSAGE
    );
  });

  it("inny kod, sukces albo zły kształt → null", () => {
    expect(depositsDisabledMessage({ success: false, code: "CONFLICT", error: "zajety" })).toBeNull();
    expect(depositsDisabledMessage({ success: true, data: {} })).toBeNull();
    expect(depositsDisabledMessage(null)).toBeNull();
    expect(depositsDisabledMessage("DEPOSITS_DISABLED")).toBeNull();
  });
});
