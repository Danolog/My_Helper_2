/**
 * Feature flags per salon (Faza 2 planu wydania — „chudy UI domyślnie").
 *
 * Rdzeń produktu (kalendarz, rezerwacje, klienci, usługi, pracownicy,
 * zadatki, przypomnienia SMS/push, opinie, galeria, 3 podstawowe raporty)
 * jest ZAWSZE włączony i nie występuje w tym rejestrze.
 *
 * Moduły opcjonalne są domyślnie WYŁĄCZONE — właściciel salonu włącza je
 * w Ustawienia → Moduły. Stan zapisujemy w `salons.settingsJson.modules`
 * (bez migracji SQL; brak wpisu = wartość domyślna modułu).
 *
 * Moduły `hardOff` są ZAMROŻONE: wyłączone globalnie, bez przełącznika w UI,
 * niezależnie od zapisu w ustawieniach salonu. Odmrożenie to osobna decyzja
 * produktowa (plan wejścia na rynek 2026-11, krok B).
 *
 * Ten plik jest JEDYNYM nośnikiem reguły zamrożenia. Egzekutorzy tylko go
 * wołają i nie trzymają własnych list:
 * - `src/proxy.ts` — trasa API modułu zamrożonego (`API_MODULE_PATTERNS`)
 *   dostaje 404 `MODULE_DISABLED`, strona panelu (`ROUTE_MODULE_MAP`)
 *   przekierowanie na `/dashboard`;
 * - `POST /api/appointments/[id]/complete` — punkty lojalnościowe naliczane
 *   tylko, gdy `resolveModules(...).loyalty`;
 * - interfejs — `useModuleEnabled()` / `<ModuleGate>` / `moduleForRoute()`.
 * Pilnuje tego `__tests__/lib/frozen-modules.test.ts`.
 */

export type ModuleKey =
  | "products"
  | "promotions"
  | "loyalty"
  | "waitingList"
  | "newsletters"
  | "invoices"
  | "reportsAdvanced"
  | "voiceAi"
  | "videoGen"
  | "fiscal"
  | "socialPosts"
  | "clientMarketing"
  | "aiNotifications"
  | "pushNotifications";

export interface ModuleDef {
  key: ModuleKey;
  /** Nazwa pokazywana w Ustawienia → Moduły. */
  label: string;
  description: string;
  /** Stan gdy salon nie ma wpisu w settingsJson.modules. */
  defaultEnabled: boolean;
  /**
   * Zamrożony: wyłączony globalnie — bez przełącznika w UI, resolver zawsze
   * zwraca false, a proxy blokuje jego trasy API i strony panelu.
   */
  hardOff?: boolean;
}

export const MODULES: readonly ModuleDef[] = [
  {
    key: "products",
    label: "Magazyn",
    description: "Stany magazynowe produktów, zużycie materiałów i alerty niskiego stanu.",
    defaultEnabled: false,
  },
  {
    key: "promotions",
    label: "Promocje i pakiety",
    description: "Happy hours, promocje pierwszej wizyty, pakiety usług i kody promocyjne.",
    defaultEnabled: false,
  },
  {
    key: "loyalty",
    label: "Program lojalnościowy",
    description: "Punkty za wizyty i nagrody dla stałych klientów.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "waitingList",
    label: "Lista oczekujących",
    description: "Zapisy na zajęte terminy i powiadomienia o zwolnionych slotach.",
    defaultEnabled: false,
  },
  {
    key: "newsletters",
    label: "Newslettery",
    description: "Wysyłka wiadomości marketingowych do bazy klientów.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "invoices",
    label: "Faktury",
    description: "Wystawianie i wysyłka faktur za wizyty.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "reportsAdvanced",
    label: "Raporty zaawansowane",
    description:
      "Pełny zestaw raportów (obłożenie, wynagrodzenia, anulacje, materiały, porównania okresów). " +
      "Raporty podstawowe — przychód, popularność usług i pracowników — są zawsze dostępne.",
    defaultEnabled: false,
  },
  // --- wyłączone globalnie (na później) ---
  {
    key: "voiceAi",
    label: "Asystent głosowy (Twilio)",
    description: "Przyjmowanie rezerwacji telefonicznych przez AI.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "videoGen",
    label: "Generowanie wideo (AI)",
    description: "Generowanie materiałów wideo z AI.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "fiscal",
    label: "Fiskalizacja",
    description: "Integracja z drukarkami fiskalnymi.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "socialPosts",
    label: "Publikacja postów social",
    description: "Planowanie i publikacja postów w mediach społecznościowych.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "clientMarketing",
    label: "Życzenia urodzinowe i „Tęsknimy”",
    description:
      "Wiadomości urodzinowe i przypomnienia dla klientów, którzy dawno nie byli w salonie.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    key: "aiNotifications",
    label: "Powiadomienia pisane przez AI",
    description: "Personalizacja treści powiadomień przez AI.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    // Cały moduł push: przełącznik „Powiadomienia Push” i panel subskrypcji
    // w interfejsie, trasy /api/push/* oraz crony przypomnień push
    // (na starcie przypominamy tylko SMS-em).
    key: "pushNotifications",
    label: "Powiadomienia push",
    description: "Przypomnienia push o wizytach dla klientów z kontem.",
    defaultEnabled: false,
    hardOff: true,
  },
] as const;

/** Moduły z przełącznikiem w Ustawienia → Moduły. */
export const TOGGLEABLE_MODULES: readonly ModuleDef[] = MODULES.filter((m) => !m.hardOff);

const FROZEN_MODULE_KEYS: ReadonlySet<ModuleKey> = new Set(
  MODULES.filter((m) => m.hardOff).map((m) => m.key)
);

/** Czy moduł jest zamrożony (`hardOff`) — wyłączony globalnie, bez przełącznika. */
export function isModuleFrozen(key: ModuleKey): boolean {
  return FROZEN_MODULE_KEYS.has(key);
}

/** Kod błędu i komunikat dla zamrożonej funkcji (odpowiedź proxy i bramka strony). */
export const MODULE_DISABLED_CODE = "MODULE_DISABLED";
export const MODULE_DISABLED_MESSAGE = "Ta funkcja jest obecnie niedostępna.";

export type ModulesState = Record<ModuleKey, boolean>;

/**
 * Wylicz stan modułów salonu z `salons.settingsJson`.
 *
 * Nieznane klucze w zapisie są ignorowane; moduły hardOff są zawsze false
 * niezależnie od zapisu (globalna blokada produktowa).
 */
export function resolveModules(settingsJson: unknown): ModulesState {
  const saved =
    settingsJson &&
    typeof settingsJson === "object" &&
    "modules" in (settingsJson as Record<string, unknown>) &&
    typeof (settingsJson as Record<string, unknown>).modules === "object"
      ? ((settingsJson as Record<string, unknown>).modules as Record<string, unknown>)
      : {};

  const state = {} as ModulesState;
  for (const mod of MODULES) {
    if (mod.hardOff) {
      state[mod.key] = false;
      continue;
    }
    const savedValue = saved?.[mod.key];
    state[mod.key] = typeof savedValue === "boolean" ? savedValue : mod.defaultEnabled;
  }
  return state;
}

/** Domyślny stan (nowy salon / brak wpisu) — chudy interfejs. */
export const DEFAULT_MODULES: ModulesState = resolveModules(null);

/**
 * Mapa ścieżek dashboardu na moduły — jedno źródło prawdy dla nawigacji
 * (sidebar, bottom nav, command palette) i bramek stron.
 * Ścieżka nienotowana tutaj = rdzeń, zawsze widoczna.
 */
export const ROUTE_MODULE_MAP: ReadonlyArray<{ prefix: string; module: ModuleKey }> = [
  { prefix: "/dashboard/products", module: "products" },
  { prefix: "/dashboard/promotions", module: "promotions" },
  { prefix: "/dashboard/promo-codes", module: "promotions" },
  { prefix: "/dashboard/waiting-list", module: "waitingList" },
  { prefix: "/dashboard/invoices", module: "invoices" },
  { prefix: "/dashboard/settings/loyalty", module: "loyalty" },
  { prefix: "/dashboard/settings/fiscal", module: "fiscal" },
  { prefix: "/dashboard/content-generator/newsletters", module: "newsletters" },
  { prefix: "/dashboard/content-generator/social-posts", module: "socialPosts" },
  { prefix: "/dashboard/content-generator/scheduled", module: "socialPosts" },
  { prefix: "/dashboard/content-generator/testimonials", module: "videoGen" },
  { prefix: "/dashboard/ai-assistant/voice", module: "voiceAi" },
];

/** Moduł wymagany dla ścieżki (null = rdzeń, zawsze dostępny). */
export function moduleForRoute(pathname: string): ModuleKey | null {
  const entry = ROUTE_MODULE_MAP.find((e) => pathname.startsWith(e.prefix));
  return entry ? entry.module : null;
}

/**
 * Trasy API należące do modułów — wzorce, bo `[id]` bywa w środku ścieżki.
 * Każdy wzorzec kończy się `(\/|$)`, żeby nie łapać tras sąsiednich
 * (`/api/invoicesx`). Proxy blokuje trasę, gdy jej moduł jest zamrożony.
 *
 * Nowa trasa w katalogu modułu zamrożonego musi być objęta wzorcem — test
 * `frozen-modules.test.ts` chodzi po `src/app/api` i tego pilnuje.
 */
export const API_MODULE_PATTERNS: ReadonlyArray<{ pattern: RegExp; module: ModuleKey }> = [
  { pattern: /^\/api\/clients\/[^/]+\/loyalty(\/|$)/, module: "loyalty" },
  { pattern: /^\/api\/salons\/[^/]+\/loyalty-settings(\/|$)/, module: "loyalty" },
  { pattern: /^\/api\/newsletters(\/|$)/, module: "newsletters" },
  { pattern: /^\/api\/ai\/content\/newsletter(\/|$)/, module: "newsletters" },
  { pattern: /^\/api\/invoices(\/|$)/, module: "invoices" },
  { pattern: /^\/api\/appointments\/[^/]+\/invoice(\/|$)/, module: "invoices" },
  { pattern: /^\/api\/notifications\/birthday(\/|$)/, module: "clientMarketing" },
  { pattern: /^\/api\/notifications\/we-miss-you(\/|$)/, module: "clientMarketing" },
  { pattern: /^\/api\/salons\/[^/]+\/birthday-settings(\/|$)/, module: "clientMarketing" },
  { pattern: /^\/api\/salons\/[^/]+\/we-miss-you-settings(\/|$)/, module: "clientMarketing" },
  { pattern: /^\/api\/ai\/notifications(\/|$)/, module: "aiNotifications" },
  { pattern: /^\/api\/push(\/|$)/, module: "pushNotifications" },
  { pattern: /^\/api\/cron\/push-reminders(-24h)?(\/|$)/, module: "pushNotifications" },
];

/**
 * Ścieżka sprowadzona do jednej postaci przed dopasowaniem do rejestru —
 * JEDYNE miejsce normalizacji; wzorce i prefiksy rejestru zakładają tę postać:
 * 1. zdekodowana z kodowania procentowego (`/api/%69nvoices`, `/api%2Finvoices`);
 *    przy błędnym kodowaniu dekodujemy pojedyncze sekwencje ASCII, a błędne
 *    zostają — jedno `%zz` nie wyłącza dekodowania reszty ścieżki,
 * 2. odwrócone ukośniki jak zwykłe (tak czyta je parser URL),
 * 3. bez pustych segmentów (`//api//invoices`) i bez segmentów `.` / `..`
 *    (`/api/x/../invoices`) — także zakodowanych (`%2e%2e`),
 * 4. bez ukośnika końcowego, małymi literami.
 *
 * Blokada jest celowo szersza niż router: wariant, którego router nie zna,
 * i tak kończy się 404, a wariant, który router sprowadza do trasy
 * kanonicznej, musi dostać tę samą decyzję co ona. Funkcja nie polega na tym,
 * że parser URL wcześniej ścieżkę uporządkował.
 */
export function normalizePathname(pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname.replace(/%[0-7][0-9a-f]/gi, (seq) =>
      String.fromCharCode(parseInt(seq.slice(1), 16))
    );
  }

  const segments: string[] = [];
  for (const segment of decoded.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`.toLowerCase();
}

export interface FrozenTarget {
  /** `api` — trasa API (odpowiedź 404), `page` — strona panelu (przekierowanie). */
  kind: "api" | "page";
  module: ModuleKey;
}

/**
 * Czy ścieżka należy do modułu zamrożonego — jedno pytanie dla tras API
 * i stron panelu, na ścieżce znormalizowanej raz. Jedyny egzekutor:
 * `src/proxy.ts`. null = ścieżka działa.
 *
 * Moduły przełączalne zwracają null — ich stan zależy od salonu i jest
 * egzekwowany w interfejsie (`ModuleGate`), nie w proxy.
 */
export function frozenModuleForPath(pathname: string): FrozenTarget | null {
  const path = normalizePathname(pathname);

  const api = API_MODULE_PATTERNS.find(
    (e) => isModuleFrozen(e.module) && e.pattern.test(path)
  );
  if (api) return { kind: "api", module: api.module };

  const page = moduleForRoute(path);
  if (page && isModuleFrozen(page)) return { kind: "page", module: page };

  return null;
}

/** Moduł zamrożony, do którego należy trasa API (null = trasa działa). */
export function frozenModuleForApiPath(pathname: string): ModuleKey | null {
  const target = frozenModuleForPath(pathname);
  return target?.kind === "api" ? target.module : null;
}

/** Moduł zamrożony, do którego należy strona panelu (null = strona działa). */
export function frozenModuleForPage(pathname: string): ModuleKey | null {
  const target = frozenModuleForPath(pathname);
  return target?.kind === "page" ? target.module : null;
}

/**
 * Raporty podstawowe (zawsze widoczne). Pozostałe podstrony
 * /dashboard/reports/* wymagają modułu reportsAdvanced.
 */
export const BASIC_REPORT_SLUGS: readonly string[] = [
  "revenue",
  "services-popularity",
  "employee-popularity",
];
