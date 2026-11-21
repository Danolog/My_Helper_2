/**
 * Przełącznik ścieżki zadatku: portal rezerwuje z zadatkiem BLIK-iem na
 * telefon salonu, dopóki moduł `onlineDeposits` (płatność zadatku online) jest
 * zamrożony w rejestrze. Prawdziwy `@/lib/features`, bez atrap — test pilnuje,
 * że przełącznik czyta rejestr, a nie własną stałą.
 */
import { describe, it, expect } from "vitest";
import {
  MODULES,
  TOGGLEABLE_MODULES,
  isBlikDepositFlow,
  isModuleFrozen,
  resolveModules,
} from "@/lib/features";

describe("przełącznik zadatku BLIK (moduł onlineDeposits)", () => {
  it("moduł onlineDeposits jest w rejestrze i ma hardOff", () => {
    const mod = MODULES.find((m) => m.key === "onlineDeposits");
    expect(mod).toBeDefined();
    expect(mod!.hardOff).toBe(true);
  });

  it("isModuleFrozen(\"onlineDeposits\") zwraca true", () => {
    expect(isModuleFrozen("onlineDeposits")).toBe(true);
  });

  it("isBlikDepositFlow() zwraca true i równa się isModuleFrozen(\"onlineDeposits\")", () => {
    expect(isBlikDepositFlow()).toBe(true);
    expect(isBlikDepositFlow()).toBe(isModuleFrozen("onlineDeposits"));
  });

  it("onlineDeposits nie ma przełącznika w Ustawienia → Moduły", () => {
    expect(TOGGLEABLE_MODULES.map((m) => m.key)).not.toContain("onlineDeposits");
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["pusty obiekt", {}],
    ["śmieci", "garbage"],
    ["modules: {}", { modules: {} }],
    ["zapis onlineDeposits: true", { modules: { onlineDeposits: true } }],
    ["zapis onlineDeposits: \"true\"", { modules: { onlineDeposits: "true" } }],
  ])("resolveModules (%s) daje onlineDeposits: false", (_label, settings) => {
    expect(resolveModules(settings).onlineDeposits).toBe(false);
  });
});
