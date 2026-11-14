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
  moduleForRoute,
  DEFAULT_MODULES,
  MODULES,
  TOGGLEABLE_MODULES,
  ROUTE_MODULE_MAP,
  BASIC_REPORT_SLUGS,
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

  it("hardOff (loyalty) jest zawsze false, nawet przy zapisie true", () => {
    const state = resolveModules({ modules: { loyalty: true } });

    expect(state.loyalty).toBe(false);

    // Zaden modul hardOff nie wystepuje wsrod przelaczalnych.
    for (const mod of TOGGLEABLE_MODULES) {
      expect(mod.hardOff).toBeFalsy();
    }
  });

  it("wartosc nie-boolean jest ignorowana (wraca default)", () => {
    const state = resolveModules({
      modules: { products: "yes", promotions: 1, waitingList: null },
    });

    expect(state.products).toBe(false);
    expect(state.promotions).toBe(false);
    expect(state.waitingList).toBe(false);
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

describe("moduleForRoute", () => {
  it("trasa z mapy => klucz modulu (dopasowanie po prefiksie, takze podstrony)", () => {
    expect(moduleForRoute("/dashboard/products")).toBe("products");
    expect(moduleForRoute("/dashboard/products/123/edit")).toBe("products");
    expect(moduleForRoute("/dashboard/promo-codes")).toBe("promotions");
    expect(moduleForRoute("/dashboard/settings/loyalty")).toBe("loyalty");
    expect(moduleForRoute("/dashboard/content-generator/newsletters")).toBe("newsletters");
  });

  it("trasa rdzenia (bez wpisu w mapie) => null (zawsze dostepna)", () => {
    expect(moduleForRoute("/dashboard")).toBeNull();
    expect(moduleForRoute("/dashboard/calendar")).toBeNull();
    expect(moduleForRoute("/dashboard/clients")).toBeNull();
  });

  it("kazdy wpis ROUTE_MODULE_MAP wskazuje na modul z rejestru", () => {
    const registryKeys = new Set(MODULES.map((m) => m.key));
    for (const entry of ROUTE_MODULE_MAP) {
      expect(registryKeys.has(entry.module)).toBe(true);
    }
  });
});

describe("BASIC_REPORT_SLUGS", () => {
  it("raporty podstawowe: przychod, popularnosc uslug i pracownikow", () => {
    expect(BASIC_REPORT_SLUGS).toEqual([
      "revenue",
      "services-popularity",
      "employee-popularity",
    ]);
  });

  it("sluzy do bramkowania: slug spoza listy wymaga reportsAdvanced", () => {
    expect(BASIC_REPORT_SLUGS.includes("revenue")).toBe(true);
    expect(BASIC_REPORT_SLUGS.includes("occupancy")).toBe(false);
  });
});
