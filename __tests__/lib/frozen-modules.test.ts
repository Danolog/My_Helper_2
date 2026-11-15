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
  frozenModuleForPath,
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
  // Cały moduł push: subskrypcje (/api/push/*) i crony przypomnień push.
  pushNotifications: /\/push(\/|-|$)/,
  // Moduły zamrożone wcześniej (kod kasowany w B3–B5) — trasy też są
  // blokowane: płatne generowanie mowy i wideo nie może być osiągalne.
  voiceAi: /\/ai\/voice(\/|$)/,
  videoGen: /\/ai\/video(\/|$)/,
  fiscal: /fiscal/,
  socialPosts: /scheduled-posts|social-post/,
  // Promocje złożone: trasy sprawdzające (2+1, happy hours, pakiet, pierwsza
  // wizyta) i rezerwacja pakietu. Lista i edycja promocji zostają.
  complexPromotions: /^\/api\/promotions\/check|\/book-package(\/|$)/,
  // Generowanie obrazów — każda trasa pod /api/ai/image poza enhance (galeria).
  imageGen: /^\/api\/ai\/image\/(?!enhance(\/|$))/,
};

const FROZEN_KEYS = MODULES.filter((m) => m.hardOff).map((m) => m.key);

describe("rejestr modułów zamrożonych", () => {
  it("zamrożone są dokładnie te moduły", () => {
    expect([...FROZEN_KEYS].sort()).toEqual([
      "aiNotifications",
      "clientMarketing",
      "complexPromotions",
      "fiscal",
      "imageGen",
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
    ["/api/push/subscribe", "pushNotifications"],
    ["/api/push/unsubscribe", "pushNotifications"],
    ["/api/push/test", "pushNotifications"],
    ["/api/cron/push-reminders", "pushNotifications"],
    ["/api/cron/push-reminders-24h", "pushNotifications"],
    ["/api/ai/voice/incoming", "voiceAi"],
    ["/api/ai/voice/twilio/webhook", "voiceAi"],
    ["/api/ai/voice/config", "voiceAi"],
    ["/api/ai/voice/stt", "voiceAi"],
    ["/api/ai/voice/tts", "voiceAi"],
    ["/api/ai/voice/interpret-command", "voiceAi"],
    ["/api/appointments/abc/fiscal-receipt", "fiscal"],
    ["/api/ai/video/generate", "videoGen"],
    ["/api/ai/video/status/abc", "videoGen"],
    ["/api/scheduled-posts", "socialPosts"],
    ["/api/scheduled-posts/abc", "socialPosts"],
    ["/api/ai/content/social-post", "socialPosts"],
    ["/api/cron/publish-scheduled-posts", "socialPosts"],
    ["/api/salons/abc/fiscal-settings", "fiscal"],
    ["/api/salons/abc/fiscal-settings/test-print", "fiscal"],
    ["/api/promotions/check", "complexPromotions"],
    ["/api/promotions/check-happy-hours", "complexPromotions"],
    ["/api/promotions/check-package", "complexPromotions"],
    ["/api/promotions/check-first-visit", "complexPromotions"],
    ["/api/appointments/book-package", "complexPromotions"],
    ["/api/ai/image/generate", "imageGen"],
    ["/api/ai/image/banner", "imageGen"],
    ["/api/ai/image/service-illustration", "imageGen"],
  ])("%s → %s", (path, module) => {
    expect(frozenModuleForApiPath(path)).toBe(module);
  });

  it.each([
    "/api/invoices/", // ukośnik końcowy
    "/api//invoices", // podwójny ukośnik
    "/api/%69nvoices", // litera zakodowana procentowo
    "/API/Invoices", // inna wielkość liter
    "/api/Clients/abc/Loyalty",
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
    "/api/cron/sms-reminders",
    "/api/cron/cleanup-pending-deposits",
    "/api/cron/cleanup-temporary-access",
    "/api/cron/push-reminders-48h",
    "/api/pushx",
    "/api/ai/content/generate-description",
    "/api/ai/content/generate-review-response",
    "/api/ai/videos",
    "/api/cron/sms-reminders",
    "/api/salons/abc/notification-type-settings",
    "/api/appointments/abc",
    "/api/appointments/abc/complete",
    "/api/ai/image/enhance",
    "/api/ai/image/enhance/",
    "/api/promotions",
    "/api/promotions/abc",
    "/api/promotions/checkout",
    "/api/promo-codes",
    "/api/promo-codes/validate",
    "/api/appointments/book-packagex",
    "/api/ai/image/generatex",
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

describe("frozenModuleForPath — jedno pytanie o trasę API i stronę", () => {
  it.each<[string, "api" | "page", ModuleKey]>([
    ["/api/invoices", "api", "invoices"],
    ["/api/x/../invoices", "api", "invoices"],
    ["/api/./clients/abc/./loyalty/redeem", "api", "loyalty"],
    ["/api/x/%2e%2e/notifications/birthday", "api", "clientMarketing"],
    ["//api/newsletters", "api", "newsletters"],
    ["/api/%69nvoices/%zz", "api", "invoices"],
    ["/api\\invoices", "api", "invoices"],
    ["/dashboard/invoices", "page", "invoices"],
    ["/dashboard/x/../invoices/abc", "page", "invoices"],
    ["/dashboard/./settings/loyalty", "page", "loyalty"],
    ["//dashboard/content-generator/newsletters", "page", "newsletters"],
    ["/x/../dashboard/%69nvoices", "page", "invoices"],
  ])("%s → %s:%s", (path, kind, module) => {
    expect(frozenModuleForPath(path)).toEqual({ kind, module });
  });

  it.each([
    // `..` wychodzi z katalogu modułu zamrożonego — trasa sąsiednia działa
    "/api/invoices/../clients",
    "/api/clients/abc/loyalty/../appointments",
    "/dashboard/invoices/../clients",
    "/api/clients",
    "/dashboard",
    "/",
    "/api/%zz",
  ])("normalizacja nie blokuje tras sąsiednich: %s", (path) => {
    expect(frozenModuleForPath(path)).toBeNull();
  });

  // Wzorce sprawdzamy na OBU postaciach ścieżki — dosłownej (bez dekodowania)
  // i zdekodowanej. Blokada, jeśli pasuje którakolwiek: nie zgadujemy, którą
  // z nich wybierze router.
  it.each<[string, "api" | "page", ModuleKey]>([
    // pasuje tylko postać zdekodowana
    ["/%61pi/invoices", "api", "invoices"],
    ["/api%2Finvoices", "api", "invoices"],
    ["/api/x/..%2finvoices", "api", "invoices"],
    ["/api/x/%2e%2e/push/subscribe", "api", "pushNotifications"],
    ["/dashboard%2Finvoices", "page", "invoices"],
    // pasuje tylko postać dosłowna (zakodowane `..` nie wyprowadza z modułu)
    ["/api/invoices/%2e%2e/clients", "api", "invoices"],
    ["/api/invoices/abc%2f..%2f..%2f..%2fclients", "api", "invoices"],
    ["/dashboard/invoices/%2e%2e/clients", "page", "invoices"],
  ])("jedna z dwóch postaci wystarcza: %s → %s:%s", (path, kind, module) => {
    expect(frozenModuleForPath(path)).toEqual({ kind, module });
  });

  it("frozenModuleForApiPath i frozenModuleForPage to to samo pytanie zawężone do rodzaju", () => {
    expect(frozenModuleForApiPath("/api/x/../invoices")).toBe("invoices");
    expect(frozenModuleForPage("/api/x/../invoices")).toBeNull();
    expect(frozenModuleForPage("/dashboard/x/../invoices")).toBe("invoices");
    expect(frozenModuleForApiPath("/dashboard/x/../invoices")).toBeNull();
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
    ["/Dashboard/Invoices", "invoices"],
    ["/dashboard//invoices", "invoices"],
    ["/dashboard/%69nvoices", "invoices"],
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
    "/dashboard/promo-codes",
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
