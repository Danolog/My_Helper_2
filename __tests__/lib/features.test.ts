/**
 * Faza 2 — feature flags per salon: testy resolvera stanu modułów.
 *
 * `resolveModules(settingsJson)` jest jedynym źródłem prawdy dla stanu
 * modułów (API, provider, nawigacja). Kontrakt:
 *   - brak zapisu => wartości domyślne (wszystko wyłączone — „chudy UI"),
 *   - zapis boolean dla znanego, przełączalnego klucza => respektowany,
 *   - nieznane klucze i wartości nie-boolean => ignorowane,
 *   - moduły hardOff => zawsze false, nawet przy zapisie `true`.
 */
import { describe, it, expect } from "vitest";
import {
  resolveModules,
  DEFAULT_MODULES,
  MODULES,
  TOGGLEABLE_MODULES,
  type ModuleKey,
} from "@/lib/features";

describe("resolveModules", () => {
  it("null => defaults: wszystkie moduly wylaczone (chudy UI)", () => {
    const state = resolveModules(null);

    // Kazdy klucz z rejestru jest obecny i wylaczony.
    for (const mod of MODULES) {
      expect(state[mod.key]).toBe(false);
    }
    expect(state).toEqual(DEFAULT_MODULES);
  });

  it("zapis wlaczajacy products => products true, reszta bez zmian", () => {
    const state = resolveModules({ modules: { products: true } });

    expect(state.products).toBe(true);
    for (const mod of MODULES) {
      if (mod.key === "products") continue;
      expect(state[mod.key]).toBe(false);
    }
  });

  it("nieznany klucz w zapisie jest ignorowany", () => {
    const state = resolveModules({ modules: { notAModule: true } });

    expect(state).toEqual(DEFAULT_MODULES);
    expect((state as Record<string, boolean>).notAModule).toBeUndefined();
  });

  it("hardOff (voiceAi) jest zawsze false, nawet przy zapisie true", () => {
    const state = resolveModules({ modules: { voiceAi: true } });

    expect(state.voiceAi).toBe(false);

    // Zaden modul hardOff nie wystepuje wsrod przelaczalnych.
    for (const mod of TOGGLEABLE_MODULES) {
      expect(mod.hardOff).toBeFalsy();
    }
  });

  it("wartosc nie-boolean jest ignorowana (wraca default)", () => {
    const state = resolveModules({
      modules: { products: "yes", loyalty: 1, invoices: null },
    });

    expect(state.products).toBe(false);
    expect(state.loyalty).toBe(false);
    expect(state.invoices).toBe(false);
  });

  it("settingsJson bez pola modules lub nie-obiekt => defaults", () => {
    expect(resolveModules({})).toEqual(DEFAULT_MODULES);
    expect(resolveModules("garbage")).toEqual(DEFAULT_MODULES);
    expect(resolveModules({ modules: "garbage" })).toEqual(DEFAULT_MODULES);
  });

  it("DEFAULT_MODULES pokrywa caly rejestr MODULES", () => {
    const keys = Object.keys(DEFAULT_MODULES).sort() as ModuleKey[];
    const registryKeys = MODULES.map((m) => m.key).sort();
    expect(keys).toEqual(registryKeys);
  });
});
