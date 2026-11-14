/**
 * Strażnik zamrożenia modułów — rejestr (plan wejścia na rynek, krok B1).
 *
 * Jedynym nośnikiem reguły „ten moduł jest zamrożony” jest
 * `src/lib/features.ts`: flaga `hardOff` w `MODULES`, lista
 * `API_MODULE_PATTERNS` (które trasy API należą do modułu) i
 * `ROUTE_MODULE_MAP` (które strony panelu). Egzekutorzy (`src/proxy.ts`,
 * zamknięcie wizyty, interfejs) tylko rejestr wołają.
 *
 * Ten plik pilnuje samego rejestru:
 * - zbiór modułów zamrożonych jest dokładnie taki, jak postanowiono,
 * - zapis `true` w ustawieniach salonu sprzed zamrożenia nic nie odmraża,
 * - każda trasa API modułu zamrożonego jest pokryta wzorcem (test chodzi po
 *   systemie plików — nowa trasa w katalogu modułu bez wzorca = czerwono),
 * - żaden wzorzec nie jest martwy ani nie łapie tras sąsiednich.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import {
  API_MODULE_PATTERNS,
  MODULES,
  TOGGLEABLE_MODULES,
  frozenModuleForApiPath,
  frozenModuleForPage,
  isModuleFrozen,
  resolveModules,
  type ModuleKey,
} from "@/lib/features";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src/app/api");

/** Wszystkie pliki `route.ts` pod `src/app/api` jako ścieżki URL (`[id]` → `x1`). */
function listApiRoutes(dir: string = API_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listApiRoutes(full));
    } else if (name === "route.ts") {
      const rel = relative(API_DIR, dir).split(sep).join("/");
      out.push(`/api/${rel}`.replace(/\[[^\]]+\]/g, "x1"));
    }
  }
  return out.sort();
}

const API_ROUTES = listApiRoutes();

/**
 * Po czym poznać, że katalog w `src/app/api` należy do modułu zamrożonego.
 * `null` = moduł nie ma w B1 blokady tras API (powód w komentarzu). Każdy
 * moduł `hardOff` musi mieć tu wpis — dodanie zamrożonego modułu bez decyzji,
 * co z jego trasami, czerwieni test kompletności.
 */
const API_DIR_NAMES: Record<string, RegExp | null> = {
  loyalty: /loyalty/,
  newsletters: /newsletter/,
  invoices: /invoice/,
  clientMarketing: /birthday|we-miss-you/,
  aiNotifications: /^\/api\/ai\/notifications(\/|$)/,
  // Tylko interfejs: przełącznik i panel subskrypcji push są schowane; trasy
  // /api/push/* i crony push zostają (harmonogram ich nie wywołuje — aneks C).
  pushNotifications: null,
  // Kod tych modułów jest kasowany w B3–B5 razem z trasami.
  voiceAi: null,
  videoGen: null,
  fiscal: null,
  socialPosts: null,
};

const FROZEN_KEYS = MODULES.filter((m) => m.hardOff).map((m) => m.key);

describe("rejestr modułów zamrożonych", () => {
  it("zamrożone są dokładnie te moduły", () => {
    expect([...FROZEN_KEYS].sort()).toEqual([
      "aiNotifications",
      "clientMarketing",
      "fiscal",
      "invoices",
      "loyalty",
      "newsletters",
      "pushNotifications",
      "socialPosts",
      "videoGen",
      "voiceAi",
    ]);
  });

  it("isModuleFrozen odpowiada fladze hardOff z rejestru", () => {
    for (const mod of MODULES) {
      expect(isModuleFrozen(mod.key), mod.key).toBe(mod.hardOff === true);
    }
    expect(isModuleFrozen("products")).toBe(false);
    expect(isModuleFrozen("promotions")).toBe(false);
    expect(isModuleFrozen("invoices")).toBe(true);
  });

  it("zapis true sprzed zamrożenia niczego nie odmraża", () => {
    const saved = Object.fromEntries(MODULES.map((m) => [m.key, true]));
    const state = resolveModules({ modules: saved });

    for (const key of FROZEN_KEYS) {
      expect(state[key], key).toBe(false);
    }
    // Kontrola dwustronna: moduły przełączalne zapis respektują.
    for (const mod of TOGGLEABLE_MODULES) {
      expect(state[mod.key], mod.key).toBe(true);
    }
  });

  it("moduły zamrożone nie mają przełącznika w ustawieniach", () => {
    const toggleable = TOGGLEABLE_MODULES.map((m) => m.key);
    for (const key of FROZEN_KEYS) {
      expect(toggleable).not.toContain(key);
    }
    expect(toggleable.sort()).toEqual([
      "products",
      "promotions",
      "reportsAdvanced",
      "waitingList",
    ]);
  });
});

describe("frozenModuleForApiPath", () => {
  it.each<[string, ModuleKey]>([
    ["/api/clients/abc/loyalty", "loyalty"],
    ["/api/clients/abc/loyalty/redeem", "loyalty"],
    ["/api/salons/abc/loyalty-settings", "loyalty"],
    ["/api/newsletters", "newsletters"],
    ["/api/newsletters/abc", "newsletters"],
    ["/api/newsletters/abc/send", "newsletters"],
    ["/api/newsletters/abc/recipients", "newsletters"],
    ["/api/ai/content/newsletter", "newsletters"],
    ["/api/invoices", "invoices"],
    ["/api/invoices/abc", "invoices"],
    ["/api/invoices/abc/send-email", "invoices"],
    ["/api/appointments/abc/invoice", "invoices"],
    ["/api/notifications/birthday", "clientMarketing"],
    ["/api/notifications/we-miss-you", "clientMarketing"],
    ["/api/salons/abc/birthday-settings", "clientMarketing"],
    ["/api/salons/abc/we-miss-you-settings", "clientMarketing"],
    ["/api/ai/notifications/personalize", "aiNotifications"],
  ])("%s → %s", (path, module) => {
    expect(frozenModuleForApiPath(path)).toBe(module);
  });

  it.each([
    "/api/invoices/", // ukośnik końcowy
    "/api//invoices", // podwójny ukośnik
    "/api/%69nvoices", // litera zakodowana procentowo
    "/api/invoices/abc/send-email/",
    "/api/clients/abc/loyalty/",
  ])("warianty zapisu ścieżki też są zamrożone: %s", (path) => {
    expect(frozenModuleForApiPath(path)).not.toBeNull();
  });

  it.each([
    "/api/clients",
    "/api/clients/abc",
    "/api/clients/abc/appointments",
    "/api/salons/abc",
    "/api/salons/abc/modules",
    "/api/salons/abc/notification-type-settings",
    "/api/notifications",
    "/api/notifications/low-stock",
    "/api/appointments/abc",
    "/api/appointments/abc/complete",
    "/api/ai/image/enhance",
    "/api/ai/content/service-description",
    "/api/ai/clients/insights",
    "/api/invoicesx",
    "/api/subscription-plans",
    "/dashboard/invoices",
    "/api/%zz", // niepoprawne kodowanie nie może wywrócić proxy
  ])("trasa sąsiednia przechodzi: %s", (path) => {
    expect(frozenModuleForApiPath(path)).toBeNull();
  });
});

describe("frozenModuleForPage", () => {
  it.each<[string, ModuleKey]>([
    ["/dashboard/invoices", "invoices"],
    ["/dashboard/invoices/abc", "invoices"],
    ["/dashboard/settings/loyalty", "loyalty"],
    ["/dashboard/content-generator/newsletters", "newsletters"],
    ["/dashboard/ai-assistant/voice", "voiceAi"],
    ["/dashboard/settings/fiscal", "fiscal"],
  ])("%s → %s", (path, module) => {
    expect(frozenModuleForPage(path)).toBe(module);
  });

  it.each([
    "/dashboard",
    "/dashboard/clients",
    "/dashboard/notifications",
    "/dashboard/settings/notifications",
    "/dashboard/settings/modules",
    // Moduły przełączalne nie są egzekwowane w proxy (wymaga odczytu bazy).
    "/dashboard/products",
    "/dashboard/promotions",
    "/dashboard/waiting-list",
  ])("strona rdzenia albo modułu przełączalnego przechodzi: %s", (path) => {
    expect(frozenModuleForPage(path)).toBeNull();
  });
});

describe("pokrycie tras API wzorcami (system plików)", () => {
  it("lista tras nie jest pusta i zawiera trasy rdzenia", () => {
    expect(API_ROUTES.length).toBeGreaterThan(100);
    expect(API_ROUTES).toContain("/api/clients/x1");
  });

  it("każdy moduł zamrożony ma decyzję, co z jego trasami API", () => {
    expect(Object.keys(API_DIR_NAMES).sort()).toEqual([...FROZEN_KEYS].sort());
  });

  it("każdy wzorzec wskazuje moduł zamrożony", () => {
    for (const { pattern, module } of API_MODULE_PATTERNS) {
      expect(isModuleFrozen(module), `${pattern} → ${module}`).toBe(true);
    }
  });

  const guarded = Object.entries(API_DIR_NAMES).filter(
    (entry): entry is [string, RegExp] => entry[1] !== null
  );

  it.each(guarded)(
    "każda trasa w katalogach modułu %s jest zamrożona",
    (module, dirName) => {
      const routes = API_ROUTES.filter((route) => dirName.test(route));
      expect(routes.length, `brak tras pasujących do ${dirName}`).toBeGreaterThan(0);
      for (const route of routes) {
        expect(frozenModuleForApiPath(route), route).toBe(module);
      }
    }
  );

  it("żaden wzorzec nie jest martwy — każdy łapie istniejącą trasę", () => {
    for (const { pattern } of API_MODULE_PATTERNS) {
      const hits = API_ROUTES.filter((route) => pattern.test(route));
      expect(hits.length, `wzorzec ${pattern} nie łapie żadnej trasy`).toBeGreaterThan(0);
    }
  });

  it("wzorce nie łapią tras spoza katalogów modułów zamrożonych", () => {
    const names = guarded.map(([, dirName]) => dirName);
    const collateral = API_ROUTES.filter(
      (route) =>
        frozenModuleForApiPath(route) !== null && !names.some((n) => n.test(route))
    );
    expect(collateral).toEqual([]);
  });
});
