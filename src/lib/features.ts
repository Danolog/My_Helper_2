/**
 * Feature flags per salon (Faza 2 planu wydania — „chudy UI domyślnie").
 *
 * Rdzeń produktu (kalendarz, rezerwacje, klienci, usługi, pracownicy,
 * zadatki, przypomnienia SMS, opinie, galeria, 3 podstawowe raporty)
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
 * - trasy modułów zamrożonych same pytają `isModuleFrozen()` (druga linia
 *   obrony, gdyby proxy zostało ominięte) — `src/lib/server/frozen-guard.ts`;
 * - promocje — typy z `FROZEN_PROMOTION_TYPES` nie są tworzone, zwracane ani
 *   naliczane (`/api/promotions`, `promo-discount.ts`, `deposit-calculation.ts`);
 * - interfejs — `useModuleEnabled()` / `<ModuleGate>` / `moduleForRoute()`.
 * Pilnuje tego `__tests__/lib/frozen-modules.test.ts`.
 */

import { decodedCanonicalPath, literalCanonicalPath } from "@/lib/path-normalize";

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
  | "pushNotifications"
  | "complexPromotions"
  | "imageGen";

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
    label: "Rabaty i kody rabatowe",
    description: "Rabat procentowy lub kwotowy oraz kody rabatowe.",
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
  {
    // Promocje złożone w module „promotions”: happy hours, pakiety usług,
    // 2+1 i pierwsza wizyta. Moduł promocji zostaje przełączalny (proste
    // rabaty i kody), więc zamrożenie żyje tu: trasy sprawdzające i rezerwacja
    // pakietu (`API_MODULE_PATTERNS`) oraz typy (`FROZEN_PROMOTION_TYPES`).
    key: "complexPromotions",
    label: "Promocje złożone",
    description: "Happy hours, pakiety usług, 2+1 i rabat na pierwszą wizytę.",
    defaultEnabled: false,
    hardOff: true,
  },
  {
    // Generowanie obrazów modelem: baner promocji, grafika do posta,
    // ilustracja usługi. Poprawianie zdjęć galerii (`/api/ai/image/enhance`,
    // biblioteka sharp, bez modelu i kosztu) NIE należy do modułu.
    key: "imageGen",
    label: "Generowanie grafik (AI)",
    description: "Banery promocji, grafiki do postów i ilustracje usług generowane przez AI.",
    defaultEnabled: false,
    hardOff: true,
  },
] as const;

/** Moduły z przełącznikiem w Ustawienia → Moduły. */
export const TOGGLEABLE_MODULES: readonly ModuleDef[] = MODULES.filter((m) => !m.hardOff);

/**
 * Czy moduł jest zamrożony (`hardOff`) — wyłączony globalnie, bez przełącznika.
 * Czyta flagę z `MODULES` przy każdym wywołaniu (bez kopii policzonej przy
 * starcie): jedna zmiana w rejestrze zmienia odpowiedź wszystkich
 * egzekutorów naraz — proxy, bramek w trasach, typów promocji
 * (`isPromotionTypeFrozen`). Pilnuje `frozen-promotions-unfreeze.test.ts`.
 */
export function isModuleFrozen(key: ModuleKey): boolean {
  return MODULES.some((m) => m.key === key && m.hardOff === true);
}

/**
 * Informacja w Ustawienia → Moduły o funkcjach, których salon mógł używać
 * przed zamrożeniem, i o tym, co dzieje się z jego danymi. Żeby ją zdjąć,
 * wystarczy ustawić `null` — strona jej wtedy nie pokazuje.
 */
export const FROZEN_MODULES_NOTICE: string | null =
  "Faktury i program lojalnościowy są obecnie niedostępne. Wystawione faktury i punkty klientów pozostają zapisane na koncie salonu.";

/**
 * Typy promocji należące do modułu `complexPromotions` — zamrożone, dopóki
 * moduł ma `hardOff`. Promocja takiego typu nie istnieje dla panelu ani dla
 * modelu AI: nie może powstać (`POST`/`PUT /api/promotions` → 400), nie jest
 * zwracana (`GET`), kod rabatowy nie może się z nią powiązać
 * (`/api/promo-codes` → 404), nie trafia do rekomendacji AI i nie daje
 * rabatu — ani w zadatku liczonym przez serwer, ani przez kod rabatowy.
 * Wiersze w bazie zostają.
 *
 * PROCEDURA ODMROŻENIA (przegląd Leo N3, B2.1):
 * 1. Zanim zdejmiesz `hardOff` z `complexPromotions`: promocje tych typów,
 *    które były aktywne przed zamrożeniem, wrócą do życia ze swoimi starymi
 *    datami i warunkami (`is_active`, `start_date`, `end_date` się nie
 *    zmieniły) — naliczą rabat w portalu, zadatku i przez powiązane kody.
 *    Trzeba je najpierw wyłączyć (`is_active = false`) albo przejrzeć
 *    z każdym salonem.
 * 2. To zmiana danych na produkcji — wymaga słowa Darka, przed wdrożeniem.
 * 3. Dopiero potem zdjęcie `hardOff` w jednym miejscu (ten plik). Typy,
 *    trasy `check-*`, `book-package` i zadatek odmrażają się razem — pilnuje
 *    `__tests__/lib/frozen-promotions-unfreeze.test.ts`.
 * 4. Zdjęcie jednego typu z tej listy NIE odmraża go w całości: trasy
 *    `check-*` i `book-package` są bramkowane całym modułem
 *    (`API_MODULE_PATTERNS`, `frozenModuleResponse`). Odmrożenie pojedynczego
 *    typu to osobna zmiana tych bramek — z tym samym krokiem 1 i 2.
 */
export const FROZEN_PROMOTION_TYPES = ["happy_hours", "package", "buy2get1", "first_visit"] as const;

/**
 * Czy typ promocji jest zamrożony: należy do `FROZEN_PROMOTION_TYPES`
 * I moduł `complexPromotions` jest zamrożony. Jeden nośnik reguły — zdjęcie
 * `hardOff` z modułu odmraża typy bez drugiej zmiany.
 */
export function isPromotionTypeFrozen(type: unknown): boolean {
  return (
    isModuleFrozen("complexPromotions") &&
    typeof type === "string" &&
    (FROZEN_PROMOTION_TYPES as readonly string[]).includes(type)
  );
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
  // B4: strona szablonów usunięta razem z social — otwarta karta wraca na pulpit.
  { prefix: "/dashboard/content-generator/templates", module: "socialPosts" },
  { prefix: "/dashboard/ai-assistant/voice", module: "voiceAi" },
];

/** Moduł wymagany dla ścieżki (null = rdzeń, zawsze dostępny). */
export function moduleForRoute(pathname: string): ModuleKey | null {
  const entry = ROUTE_MODULE_MAP.find((e) => pathname.startsWith(e.prefix));
  return entry ? entry.module : null;
}

/**
 * Czy pozycja nawigacji prowadząca pod `href` ma być widoczna przy danym
 * stanie modułów salonu: trasa rdzenia zawsze, trasa modułu tylko gdy moduł
 * jest włączony i niezamrożony. Jedyny warunek filtra — wołają go menu
 * boczne, dolna nawigacja i paleta poleceń (pilnuje
 * `__tests__/components/DashboardNavFilter.test.tsx`).
 */
export function isRouteEnabledForModules(href: string, modules: ModulesState): boolean {
  const key = moduleForRoute(href);
  return key === null || (modules[key] === true && !isModuleFrozen(key));
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
  // Promocje złożone: sprawdzanie 2+1, happy hours, pakietów, pierwszej
  // wizyty i rezerwacja pakietu. Lista i edycja promocji (`/api/promotions`,
  // `/api/promotions/[id]`) zostają — filtrują typy zamrożone same.
  {
    pattern: /^\/api\/promotions\/check(-happy-hours|-package|-first-visit)?(\/|$)/,
    module: "complexPromotions",
  },
  { pattern: /^\/api\/appointments\/book-package(\/|$)/, module: "complexPromotions" },
  // Generowanie obrazów modelem. `/api/ai/image/enhance` (galeria) zostaje.
  {
    pattern: /^\/api\/ai\/image\/(generate|banner|service-illustration)(\/|$)/,
    module: "imageGen",
  },
  // Moduły zamrożone wcześniej (kod kasowany w B3–B5). Paragon wizyty jest
  // schowany w interfejsie przez useModuleEnabled("fiscal"). Głos (voiceAi,
  // B3), wideo (videoGen) i publikacja postów (socialPosts, B4) usunięte —
  // tras nie ma, wzorców też (strażnik: removed-features).
  { pattern: /^\/api\/salons\/[^/]+\/fiscal-settings(\/|$)/, module: "fiscal" },
  { pattern: /^\/api\/appointments\/[^/]+\/fiscal-receipt(\/|$)/, module: "fiscal" },
];

export interface FrozenTarget {
  /** `api` — trasa API (odpowiedź 404), `page` — strona panelu (przekierowanie). */
  kind: "api" | "page";
  module: ModuleKey;
}

/** Dopasowanie jednej postaci kanonicznej ścieżki do rejestru. */
function frozenTargetForCanonicalPath(path: string): FrozenTarget | null {
  const api = API_MODULE_PATTERNS.find(
    (e) => isModuleFrozen(e.module) && e.pattern.test(path)
  );
  if (api) return { kind: "api", module: api.module };

  const page = moduleForRoute(path);
  if (page && isModuleFrozen(page)) return { kind: "page", module: page };

  return null;
}

/**
 * Czy ścieżka należy do modułu zamrożonego — jedno pytanie dla tras API
 * i stron panelu. Jedyny egzekutor: `src/proxy.ts`. null = ścieżka działa.
 *
 * Wzorce i prefiksy rejestru zakładają postać kanoniczną ścieżki
 * (`src/lib/path-normalize.ts`). Sprawdzamy OBIE postaci — dosłowną (bez
 * dekodowania) i zdekodowaną — i blokujemy, jeśli pasuje którakolwiek: nie
 * zgadujemy, którą z nich wybierze router. Inny zapis tej samej trasy
 * (`//api//invoices`, `/api/x/../invoices`, `/%61pi/invoices`,
 * `/API/Invoices`) dostaje tę samą decyzję co postać kanoniczna.
 *
 * Moduły przełączalne zwracają null — ich stan zależy od salonu i jest
 * egzekwowany w interfejsie (`ModuleGate`), nie w proxy.
 */
export function frozenModuleForPath(pathname: string): FrozenTarget | null {
  return (
    frozenTargetForCanonicalPath(literalCanonicalPath(pathname)) ??
    frozenTargetForCanonicalPath(decodedCanonicalPath(pathname))
  );
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
