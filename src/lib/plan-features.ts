/**
 * Listy funkcji planów Basic i Pro — jedno źródło prawdy w repo.
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
 * faktycznie robi. Moduły `hardOff` z `src/lib/features.ts` (asystent
 * głosowy, wideo, fiskalizacja, publikacja postów social) i płatność
 * zadatków online (decyzja D1) nie mogą tu wrócić — pilnuje tego
 * `__tests__/lib/marketing-truth.test.ts`.
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
    "Promocje i program lojalnościowy",
  ],
  pro: [
    // Ten wiersz jest filtrowany w dialogu upgrade'u (plan-actions.tsx) — nie zmieniaj brzmienia.
    "Wszystko z planu Basic",
    "Asystent AI biznesowy (analiza danych)",
    "Asystent AI content (generowanie treści)",
    "Rekomendacje AI na dashboardzie",
    "Analiza trendów i konkurencji",
    "Generowanie opisów usług",
    "Tworzenie i wysyłka newsletterów",
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
