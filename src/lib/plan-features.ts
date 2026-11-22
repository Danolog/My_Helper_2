/**
 * Listy funkcji planów Basic i Pro — jedno źródło prawdy w repo.
 *
 * Wszystko, co interfejs pokazuje o zawartości planów, wynika z
 * `PLAN_FEATURES`: pełne listy (`featuresFor`), skróty na kartach planów
 * (`planHighlights`), tabela porównania w cenniku (`planComparison`), lista
 * „co stracisz” przy obniżeniu planu (`proOnlyFeatures`) i jednozdaniowe
 * opisy planów (`PLAN_SUMMARY`). Żaden komponent nie ma własnej listy —
 * pilnują tego `__tests__/components/PlanFeaturesSingleSource.test.tsx`
 * i `__tests__/lib/marketing-truth.test.ts`.
 *
 * Obie trasy, które oddają listy do interfejsu, biorą je stąd przez
 * `featuresFor()`, niezależnie od zawartości `features_json` w bazie:
 * - `GET /api/subscription-plans` (cennik, rejestracja, zmiana planu),
 * - `GET /api/subscriptions/current` (karta planu na stronie subskrypcji,
 *   także plan zaplanowany po obniżeniu).
 * Dlatego UPDATE starych wierszy na produkcji jest niepotrzebny.
 *
 * Kolumna `subscription_plans.features_json` nadal jest zapisywana (auto-seed
 * w `/api/subscription-plans` przy pustej tabeli oraz `scripts/seed-test.ts`),
 * ale dla planów Basic i Pro nikt jej nie czyta.
 *
 * Zasada (plan wejścia na rynek, B9): na liście jest tylko to, co produkt
 * faktycznie robi. Moduły zamrożone (`hardOff` w `src/lib/features.ts` —
 * m.in. lojalność, newslettery, faktury, asystent głosowy, wideo,
 * fiskalizacja, posty social) i płatność zadatków online (decyzja D1) nie
 * mogą tu wrócić — pilnuje tego `__tests__/lib/marketing-truth.test.ts`,
 * który listę modułów zamrożonych bierze z rejestru.
 */
export const PLAN_FEATURES = {
  basic: [
    "Pełne zarządzanie salonem",
    "Kalendarz i grafiki pracowników",
    "Kartoteka klientów",
    "System rezerwacji online",
    "Portal klienta z rezerwacją",
    "Powiadomienia SMS i e-mail",
    "Zarządzanie usługami i wariantami",
    "Magazyn produktów",
    "System opinii i ocen",
    "Raporty podstawowe",
    "Zadatki za wizyty (ustalane przez salon)",
    "Galeria zdjęć salonu",
    "Promocje i kody rabatowe",
  ],
  pro: [
    // Ten wiersz jest filtrowany w dialogach zmiany planu (PRO_INCLUDES_BASIC) — nie zmieniaj brzmienia.
    "Wszystko z planu Basic",
    "Asystent AI biznesowy (analiza danych)",
    "Rekomendacje AI na dashboardzie",
    "Analiza trendów i konkurencji",
    "Generowanie opisów usług",
    "Generowanie odpowiedzi na opinie",
    "Proaktywne sugestie biznesowe",
    "Priorytetowe wsparcie techniczne",
  ],
} as const satisfies Record<"basic" | "pro", readonly string[]>;

/**
 * Lista funkcji planu do pokazania w interfejsie. Dla planów z
 * `PLAN_FEATURES` zawsze lista z kodu — `stored` (kolumna `features_json`)
 * jest ignorowane, bo wiersze założone wcześniej obiecują wyłączone funkcje
 * (B9). Plan o nieznanym slugu zachowuje listę z bazy.
 *
 * `Object.hasOwn`, nie `in`: operator `in` uznaje też nazwy odziedziczone
 * (`"constructor"`, `"toString"`) za znane plany.
 */
export function featuresFor(slug: string, stored: unknown): string[] {
  if (Object.hasOwn(PLAN_FEATURES, slug)) {
    return [...PLAN_FEATURES[slug as keyof typeof PLAN_FEATURES]];
  }
  return Array.isArray(stored) ? (stored as string[]) : [];
}

type PlanSlug = keyof typeof PLAN_FEATURES;

/** Wiersz planu Pro „Wszystko z planu Basic” — pomijany tam, gdzie pokazujemy samą różnicę planów. */
export const PRO_INCLUDES_BASIC: string = PLAN_FEATURES.pro[0];

/** Jednozdaniowe opisy planów (karty planów na stronie sprzedażowej i w cenniku). */
export const PLAN_SUMMARY = {
  basic: "Pełne zarządzanie salonem w jednym planie.",
  pro: "Wszystko z planu Basic oraz asystent AI: analiza danych salonu, rekomendacje i opisy usług.",
} as const satisfies Record<PlanSlug, string>;

/**
 * Skrót listy funkcji planu — pierwsze `count` pozycji. Listy w
 * `PLAN_FEATURES` są ułożone od najważniejszych, więc skrót nie wymaga
 * osobnej, ręcznie utrzymywanej listy.
 */
export function planHighlights(slug: PlanSlug, count: number): string[] {
  return PLAN_FEATURES[slug].slice(0, Math.max(0, count));
}

/** Funkcje dostępne tylko w planie Pro (bez wiersza „Wszystko z planu Basic”). */
export function proOnlyFeatures(): string[] {
  return PLAN_FEATURES.pro.filter((feature) => feature !== PRO_INCLUDES_BASIC);
}

export interface PlanComparisonCategory {
  category: string;
  features: Array<{ name: string; basic: boolean; pro: boolean }>;
}

/**
 * Tabela porównania planów: pozycje Basic są w obu planach, pozycje Pro
 * (poza „Wszystko z planu Basic”) tylko w Pro.
 */
export function planComparison(): PlanComparisonCategory[] {
  return [
    {
      category: "W planie Basic i Pro",
      features: PLAN_FEATURES.basic.map((name) => ({ name, basic: true, pro: true })),
    },
    {
      category: "Tylko w planie Pro",
      features: proOnlyFeatures().map((name) => ({ name, basic: false, pro: true })),
    },
  ];
}
