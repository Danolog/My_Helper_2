/**
 * Listy funkcji planów Basic i Pro — jedno źródło prawdy w repo.
 *
 * Trafiają do tabeli `subscription_plans.features_json` (auto-seed w
 * `/api/subscription-plans` przy pustej tabeli oraz `scripts/seed-test.ts`)
 * i stamtąd są pokazywane w cenniku, rejestracji i na stronie subskrypcji.
 *
 * UWAGA: zmiana tutaj NIE aktualizuje istniejących wierszy w bazie — po
 * edycji trzeba wykonać UPDATE na `subscription_plans` (SQL w opisie PR).
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
