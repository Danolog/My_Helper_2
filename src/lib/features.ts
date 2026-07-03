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
 * Moduły `hardOff` (asystent głosowy, generowanie wideo, fiskalizacja,
 * publikacja postów social) są wyłączone globalnie i NIE mają przełącznika
 * w UI — włączymy je osobną decyzją produktową (RAPORT sekcja Faza 2).
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
  | "socialPosts";

export interface ModuleDef {
  key: ModuleKey;
  /** Nazwa pokazywana w Ustawienia → Moduły. */
  label: string;
  description: string;
  /** Stan gdy salon nie ma wpisu w settingsJson.modules. */
  defaultEnabled: boolean;
  /** Wyłączony globalnie — bez przełącznika w UI, resolver zawsze zwraca false. */
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
  },
  {
    key: "invoices",
    label: "Faktury",
    description: "Wystawianie i wysyłka faktur za wizyty.",
    defaultEnabled: false,
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
] as const;

/** Moduły z przełącznikiem w Ustawienia → Moduły. */
export const TOGGLEABLE_MODULES: readonly ModuleDef[] = MODULES.filter((m) => !m.hardOff);

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
 * Raporty podstawowe (zawsze widoczne). Pozostałe podstrony
 * /dashboard/reports/* wymagają modułu reportsAdvanced.
 */
export const BASIC_REPORT_SLUGS: readonly string[] = [
  "revenue",
  "services-popularity",
  "employee-popularity",
];
