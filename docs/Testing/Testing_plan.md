# Plan Testowania Aplikacji MyHelper

> **Wersja:** 1.0 — Marzec 2026
> **Projekt:** MyHelper — System zarządzania salonem usługowym
> **Stack:** Next.js 16 + React 19 + PostgreSQL 18 + Drizzle ORM
> **Dokument obejmuje 7 faz testowania: od audytu po CI/CD**

---

## SPIS TREŚCI

1. [Podsumowanie projektu i cele testowania](#1-podsumowanie-projektu-i-cele-testowania)
2. [Faza 0 — Przygotowanie środowiska testowego](#2-faza-0--przygotowanie-środowiska-testowego)
3. [Faza 1 — Audyt kodu (Agent Analityczny)](#3-faza-1--audyt-kodu-agent-analityczny)
4. [Faza 2 — Testy jednostkowe (Multi-Agent)](#4-faza-2--testy-jednostkowe-multi-agent)
5. [Faza 3 — Testy E2E przepływów użytkownika](#5-faza-3--testy-e2e-przepływów-użytkownika)
6. [Faza 4 — Testy wydajności](#6-faza-4--testy-wydajności)
7. [Faza 5 — Testy regresyjne i Fix Loop](#7-faza-5--testy-regresyjne-i-fix-loop)
8. [Faza 6 — Bramy produkcyjne i Coverage](#8-faza-6--bramy-produkcyjne-i-coverage)
9. [Faza 7 — CI/CD z GitHub Actions](#9-faza-7--cicd-z-github-actions)
10. [Instrukcja wdrożenia — co, gdzie dodać w projekcie](#10-instrukcja-wdrożenia--co-gdzie-dodać-w-projekcie)
11. [Harmonogram realizacji](#11-harmonogram-realizacji)

---

## 1. Podsumowanie projektu i cele testowania

### 1.1 O projekcie MyHelper

MyHelper to aplikacja SaaS do zarządzania salonami usługowymi (fryzjerzy, kosmetyczki, gabinety lekarskie). Aplikacja obejmuje panel właściciela, portal klienta, system rezerwacji, płatności, magazyn, raporty finansowe oraz narzędzia AI (plan Pro). Alternatywa dla Booksy z dwoma planami: Basic (49 PLN/mies.) i Pro (149 PLN/mies.).

### 1.2 Skala projektu

| Metryka | Wartość |
|---------|---------|
| Tabele w bazie danych | 44 tabele (PostgreSQL 18 + pgvector) |
| Endpointy API | ~160 endpointów REST |
| Role użytkowników | 4 role: owner, employee, receptionist, client |
| Strony dashboard | ~50 podstron panelu właściciela |
| Integracje zewnętrzne | Stripe, SMS, OpenRouter AI, Vercel Blob |
| Framework | Next.js 16 + React 19 + TypeScript 5.9 |
| ORM / Baza | Drizzle ORM 0.44 + PostgreSQL 18 |
| Autentykacja | Better Auth 1.4 (email/password + Google OAuth) |

### 1.3 Cele testowania

1. Zapewnić bezbledne działanie KAŻDEJ funkcjonalności od początku do końca (E2E)
2. Wyeliminować opóźnienia — API response < 200ms (p95)
3. Zagwarantować, że naprawa jednego buga nie psuje innych modułów (testy regresyjne)
4. Osiągnąć pokrycie testami jednostkowymi > 80%
5. Zero krytycznych luk bezpieczeństwa (pnpm audit)
6. Pełna funkcjonalność: logowanie → pracownicy → materiały → narzędzia AI

### 1.4 Priorytety testowania (od najważniejszego)

| Priorytet | Obszar | Uzasadnienie |
|-----------|--------|-------------|
| **P0 — KRYTYCZNY** | Autentykacja i autoryzacja | Bez logowania nie da się użyć aplikacji |
| **P0 — KRYTYCZNY** | CRUD pracowników i usług | Podstawa całej logiki biznesowej |
| **P0 — KRYTYCZNY** | System rezerwacji wizyt | Core feature — serce aplikacji |
| **P1 — WYSOKI** | Płatności (Stripe + depozyty) | Bezpośredni wpływ na przychody |
| **P1 — WYSOKI** | Magazyn (produkty, zużycie) | Zarządzanie materiałami musi być bezbłędne |
| **P1 — WYSOKI** | Raporty finansowe | Właściciel podejmuje decyzje na podstawie danych |
| **P2 — ŚREDNI** | Narzędzia AI (plan Pro) | Generowanie treści, analityka, asystent głosowy |
| **P2 — ŚREDNI** | Portal klienta | Rezerwacja online, opinie, ulubione |
| **P3 — NISKI** | PWA, powiadomienia push | Dodatkowa wartość, nie blokuje core |
| **P3 — NISKI** | Galeria zdjęć, newslettery | Marketing — ważny ale nie krytyczny |

---

## 2. Faza 0 — Przygotowanie środowiska testowego

### 2.1 Co dopisać do CLAUDE.md (na końcu istniejącego pliku)

> ⚠️ **WAŻNE: NIE zastępuj istniejącego pliku CLAUDE.md. Dopisz poniższe sekcje NA KOŃCU pliku.**

Dodaj następujące sekcje na końcu pliku `CLAUDE.md`:

```markdown
## Komendy testowania
- `pnpm test` — testy jednostkowe (Vitest)
- `pnpm test:e2e` — testy E2E (Playwright)
- `pnpm test:coverage` — testy z raportem pokrycia
- `pnpm lint` — ESLint
- `pnpm typecheck` — TypeScript strict check
- `pnpm build` — build produkcyjny

## Zasady dla agentów testujących
- Po każdej zmianie uruchom PEŁNY zestaw testów (regresja)
- Naprawiaj błędy od fundamentalnych (typy, importy) do złożonych (logika)
- Nie pushuj bez zgody właściciela
- Każdy test musi pokrywać: happy path + error path + edge cases
- API testy muszą sprawdzać: 200, 400, 401, 403, 404, 500

## Znane problemy do naprawienia
- [ ] Weryfikacja autorów sesji (timeout 15 min)
- [ ] Walidacje formularzy we wszystkich CRUD
- [ ] Obsługa błędów w endpointach AI
- [ ] Testy responsywności mobile-first
```

### 2.2 Struktura katalogów testowych (utworzyć w projekcie)

Utwórz następującą strukturę katalogów w katalogu głównym projektu:

```
twój-projekt/
├── __tests__/                    ← testy jednostkowe
│   ├── setup.ts                  ← setup plik (import matchers)
│   ├── lib/                      ← testy logiki biznesowej
│   ├── api/                      ← testy endpointów API
│   ├── components/               ← testy komponentów React
│   └── hooks/                    ← testy custom hooków
├── tests/                        ← testy E2E Playwright
│   ├── auth/                     ← logowanie, rejestracja
│   ├── dashboard/                ← panel właściciela
│   ├── client-portal/            ← portal klienta
│   ├── ai-tools/                 ← narzędzia AI
│   └── regression/               ← testy regresyjne
├── .claude/
│   ├── settings.json             ← uprawnienia agentów
│   └── commands/
│       ├── audit.md              ← komenda /audit
│       ├── test.md               ← komenda /test
│       ├── fix.md                ← komenda /fix
│       └── regression.md         ← komenda /regression
```

### 2.3 Instalacja zależności testowych

Uruchom w terminalu w katalogu projektu:

```bash
pnpm add -D vitest @vitejs/plugin-react @testing-library/react \
  @testing-library/jest-dom @testing-library/user-event \
  @playwright/test msw happy-dom @vitest/coverage-v8
```

### 2.4 Plik `vitest.config.ts` (utworzyć w katalogu głównym)

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: ['node_modules/', 'tests/', '.next/'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
```

### 2.5 Plik `playwright.config.ts` (utworzyć w katalogu głównym)

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 2,
  reporter: [['html'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 14'] } },
    { name: 'Tablet', use: { ...devices['iPad Pro 11'] } },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 2.6 Skrypty w `package.json` (dodać do sekcji `scripts`)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:all": "vitest run && playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

### 2.7 Plik `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm test*)",
      "Bash(pnpm lint)",
      "Bash(pnpm build)",
      "Bash(pnpm typecheck)",
      "Bash(npx playwright test*)",
      "Bash(git diff*)",
      "Bash(git status)",
      "Read(**)",
      "Write(src/**)",
      "Write(__tests__/**)",
      "Write(tests/**)"
    ],
    "deny": [
      "Bash(git push*)",
      "Bash(pnpm publish*)",
      "Bash(rm -rf*)"
    ]
  }
}
```

### 2.8 Plik `__tests__/setup.ts`

```ts
import '@testing-library/jest-dom';
```

---

## 3. Faza 1 — Audyt kodu (Agent Analityczny)

**Cel:** Zidentyfikować wszystkie problemy w kodzie ZANIM zaczniemy pisać testy.

### 3.1 Prompt do uruchomienia audytu

Wklej w terminalu Claude Code:

```bash
claude "Przeprowadź pełny audyt projektu MyHelper:
1. Uruchom pnpm typecheck i zapisz WSZYSTKIE błędy TypeScript
2. Uruchom pnpm lint i zapisz WSZYSTKIE problemy ESLint
3. Przejrzyj każdy plik w src/app/api/ szukając:
   - Brakujących try/catch w endpointach
   - Brakującej walidacji Zod na inputach
   - Brakującej weryfikacji sesji (Better Auth)
   - Brakującej weryfikacji roli użytkownika
4. Przejrzyj src/components/ szukając:
   - Brakujących stanów ładowania i błędów
   - Niezarządzanych efektów (useEffect bez cleanup)
   - Brakujących walidacji formularzy
5. Sprawdź src/lib/schema.ts pod kątem:
   - Brakujących indeksów na często używanych kolumnach
   - Brakujących relacji/constraints
6. Wygeneruj AUDIT_REPORT.md z priorytetyzowaną listą bugów"
```

### 3.2 Komenda `.claude/commands/audit.md`

Utwórz plik `.claude/commands/audit.md` z następującą treścią:

```markdown
Przeprowadź pełny audyt projektu MyHelper:
1. Uruchom `pnpm typecheck` — zapisz wszystkie błędy TypeScript
2. Uruchom `pnpm lint` — zapisz wszystkie problemy ESLint
3. Przejrzyj KAŻDY plik w src/app/api/ szukając:
   - endpointów bez try/catch
   - endpointów bez walidacji Zod
   - endpointów bez weryfikacji sesji Better Auth
   - endpointów bez sprawdzenia roli (owner/employee/receptionist/client)
4. Przejrzyj src/components/ szukając:
   - komponentów bez stanów error/loading
   - useEffect bez cleanup
   - formularzy bez walidacji
5. Wygeneruj AUDIT_REPORT.md z sekcjami: KRYTYCZNE, WYSOKIE, ŚREDNIE, NISKIE
```

Użycie: wpisz `/audit` w Claude Code.

### 3.3 Oczekiwany raport audytu

| Kategoria | Co sprawdzamy | Próbka plików |
|-----------|--------------|---------------|
| TypeScript | Błędy kompilacji, niezgodności typów | Cały projekt (tsc --noEmit) |
| ESLint | Niestandardowy kod, unused imports | src/**/*.{ts,tsx} |
| API Security | Brak auth, brak walidacji, brak try/catch | src/app/api/**/*.ts (~160 plików) |
| Komponenty | Brak error states, memory leaks | src/components/**/*.tsx |
| Schemat DB | Brakujące indeksy, constraints | src/lib/schema.ts |
| Zależności | Znane podatności CVE | pnpm audit |

---

## 4. Faza 2 — Testy jednostkowe (Multi-Agent)

**Cel:** Napisać testy dla każdego modułu aplikacji. 4 agenty pracują równolegle.

### 4.1 Agent 1 — Testy logiki biznesowej (`src/lib/`)

**Pliki:** `__tests__/lib/*.test.ts`

| Moduł | Co testować | Edge cases |
|-------|-----------|-----------|
| auth.ts | Tworzenie sesji, weryfikacja tokenów, timeout 15min | Wygasła sesja, nieprawidłowy token, brak headera |
| schema.ts | Walidacja Zod dla każdej tabeli, typy pól | Puste pola, za długie stringi, nieprawidłowe UUID |
| utils (helpers) | Formatowanie dat, kwot PLN, numerów telefonu | null, undefined, puste stringi, daty graniczne |
| stripe helpers | Tworzenie sesji płatności, obliczanie depozytów | Kwota 0, ujemna kwota, przekroczenie limitu |
| ai helpers | Formatowanie promptów, parsowanie odpowiedzi AI | Timeout API, pusta odpowiedź, nieprawidłowy JSON |
| permission checks | Weryfikacja ról (owner/employee/receptionist) | Brak roli, nieprawidłowa rola, wygasły dostęp |

**Prompt dla agenta:**

```bash
claude "Napisz testy jednostkowe Vitest dla KAŻDEJ funkcji w src/lib/.
Dla każdej funkcji pokryj: happy path, error path, edge cases.
Użyj describe/it z czytelnymi nazwami po angielsku.
Mockuj zewnętrzne zależności (DB, Stripe, OpenRouter).
Pliki zapisuj w __tests__/lib/[nazwa].test.ts"
```

### 4.2 Agent 2 — Testy komponentów React (`src/components/`)

**Pliki:** `__tests__/components/*.test.tsx`

| Komponent/Moduł | Co testować | Interakcje |
|-----------------|-----------|-----------|
| LoginForm / RegisterForm | Renderowanie, walidacja pól, submit | Klik submit, wpisywanie danych, błędy walidacji |
| AppointmentDialog | Tworzenie wizyt, wybór pracownika i usługi | Wybór daty, slotu, pracownika → submit |
| EmployeeForm | Dodawanie/edycja pracownika | Wpisywanie danych, wybór roli, upload zdjęcia |
| ProductForm | CRUD produktów magazynowych | Ilość, jednostka, cena, minimum stock |
| Calendar components | Widok tygodniowy, dzienny, eventy | Kliknięcie slotu, przeciąganie eventu |
| ReportFilters | Filtry dat, pracowników, usług | Wybór zakresu dat, filtrowanie |
| SubscriptionGate | Bramka planu Pro | Kliknięcie upgrade, obsługa płatności |
| AI Chat / AI Tools | Interfejs czatu AI, generowanie treści | Wysyłanie wiadomości, odbieranie odpowiedzi |

**Prompt dla agenta:**

```bash
claude "Napisz testy React Testing Library dla komponentów.
Sprawdź: renderowanie, props, user interactions, stany.
Użyj @testing-library/user-event do symulacji kliknięć.
Mockuj API calls z MSW (Mock Service Worker).
Pliki w __tests__/components/[nazwa].test.tsx"
```

### 4.3 Agent 3 — Testy API / Integracyjne (~160 endpointów)

**Pliki:** `__tests__/api/*.test.ts`

**KAŻDY endpoint musi być przetestowany na 5 scenariuszy:**

| Scenariusz | HTTP Status | Co sprawdzamy |
|-----------|------------|--------------|
| Sukces (happy path) | 200 / 201 | Poprawna odpowiedź, prawidłowe dane |
| Brak autoryzacji | 401 | Brak sesji / wygasła sesja |
| Brak uprawnień | 403 | Zła rola (np. client próbuje usunąć pracownika) |
| Nieprawidłowe dane | 400 | Brak wymaganych pól, zły format, walidacja Zod |
| Błąd serwera | 500 | Obsługa wyjątków, timeout bazy danych |

#### Endpointy Core CRUD

| Endpoint | Metody | Rola | Testy specyficzne |
|----------|--------|------|-------------------|
| /api/appointments | GET, POST, PUT, DELETE | owner, receptionist | Kolizja terminów, depozyt, cancel policy |
| /api/appointments/complete | POST | owner, employee | Rozliczenie, zużycie materiałów, prowizja |
| /api/appointments/materials | GET, POST | owner, employee | Auto-odejmowanie z magazynu, brak stocku |
| /api/clients | GET, POST, PUT, DELETE | owner, receptionist | Walidacja telefonu, RODO, hasło przy usuwaniu |
| /api/employees | GET, POST, PUT, DELETE | owner | Rola, prowizja, grafik, powiązanie z userId |
| /api/services | GET, POST, PUT, DELETE | owner | Warianty, ceny, czas trwania, kategorie |
| /api/products | GET, POST, PUT, DELETE | owner | Ilość, minimum stock, jednostki, zużycie |
| /api/work-schedules | GET, POST, PUT | owner | Grafik tygodniowy, konflikty godzin |
| /api/promotions | GET, POST, PUT, DELETE | owner | Typ rabatu, daty ważności, limit użyć |
| /api/promo-codes | GET, POST, PUT | owner | Kod, limit, data ważności, powiązanie z promo |

#### Endpointy Finansowe

| Endpoint | Metody | Testy specyficzne |
|----------|--------|-------------------|
| /api/subscriptions/checkout | POST | Tworzenie sesji Stripe, plan Basic/Pro |
| /api/subscriptions/current | GET | Status subskrypcji, trial, wygaśnięcie |
| /api/subscriptions/cancel | POST | Anulowanie, downgrade, zaplanowane zmiany |
| /api/deposits/create-session | POST | Sesja płatności depozytu, kwota % usługi |
| /api/stripe/webhook | POST | Weryfikacja podpisu, obsługa eventów Stripe |
| /api/reports/revenue | GET | Filtrowanie po datach, pracownikach |
| /api/reports/employee-payroll | GET | Prowizje, rozliczenia, dane finansowe |
| /api/invoices | GET, POST | Generowanie PDF, paragon vs faktura, VAT |

#### Endpointy AI (tylko plan Pro)

| Endpoint | Metody | Testy specyficzne |
|----------|--------|-------------------|
| /api/ai/business/chat | POST | Streaming odpowiedzi, timeout, limit tokenów |
| /api/ai/business/analytics | GET | Analiza danych salonu, generowanie insights |
| /api/ai/business/suggestions | GET | Rekomendacje biznesowe, personalizacja |
| /api/ai/content/social-post | POST | Generowanie postów, tone of voice, platformy |
| /api/ai/content/newsletter | POST | Generowanie newslettera, personalizacja |
| /api/ai/voice/* | POST | Asystent głosowy, rezerwacja, anulowanie |
| **Bramka Pro** | Wszystkie AI | Odmowa dostępu dla planu Basic (403) |

#### Endpointy Portalu Klienta

| Endpoint | Metody | Testy specyficzne |
|----------|--------|-------------------|
| /api/client/appointments | GET, POST | Rezerwacja online, dostępne sloty |
| /api/client/appointments/cancel | POST | Polityka anulowania, zwrot depozytu |
| /api/client/reviews | GET, POST | Wystawianie opinii, ocena 1-5 |
| /api/favorites/salons | GET, POST, DELETE | Dodawanie/usuwanie ulubionych |
| /api/available-slots | GET | Dostępne terminy, grafik, blokady |
| /api/waiting-list | GET, POST | Lista oczekujących, token akceptacji |

### 4.4 Agent 4 — Testy State Management i Hooków

**Pliki:** `__tests__/hooks/*.test.ts`

| Hook / Store | Co testować |
|-------------|-----------|
| useAuth / useSession | Logowanie, wylogowanie, odświeżanie sesji, timeout 15min |
| useAppointments | Pobieranie wizyt, tworzenie, edycja, filtrowanie po dacie |
| useEmployees | Lista pracowników, dodawanie, edycja, usuwanie |
| useProducts / useInventory | Stan magazynu, zużycie, alerty niskiego stanu |
| useSubscription | Status planu, bramka Pro, trial |
| useNotifications | Push notifications, subscribe/unsubscribe |
| useAI (jeżeli istnieje) | Wywołania AI, streaming, obsługa błędów |

### 4.5 Konfiguracja Multi-Agent (git worktrees)

```bash
# Utwórz worktrees dla każdego agenta
git worktree add ../myhelper-unit main
git worktree add ../myhelper-components main
git worktree add ../myhelper-api main
git worktree add ../myhelper-hooks main

# Uruchom agentów w osobnych terminalach
cd ../myhelper-unit && claude "Napisz testy unit dla src/lib/"
cd ../myhelper-components && claude "Napisz testy dla komponentów"
cd ../myhelper-api && claude "Napisz testy API dla endpointów"
cd ../myhelper-hooks && claude "Napisz testy dla hooków"
```

Każdy agent pracuje niezależnie na tym samym kodzie — bez konfliktów.

---

## 5. Faza 3 — Testy E2E przepływów użytkownika

**Cel:** Przetestować KAŻDY przepływ użytkownika od początku do końca. Każdy flow ma happy path, error path i edge cases.

> ⚠️ **KLUCZOWE: To jest najważniejsza faza — tu sprawdzamy czy CAŁA aplikacja działa.**

### 5.1 Flow 1: Autentykacja (PRIORYTET P0)

**Plik:** `tests/auth/authentication.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Rejestracja nowego właściciela | 1. Otwórz /register → 2. Wypełnij dane → 3. Potwierdź email → 4. Pierwsze logowanie | Użytkownik widzi dashboard z wizardem setup |
| Logowanie email + hasło | 1. Otwórz /login → 2. Wpisz dane → 3. Klik Zaloguj | Przekierowanie do /dashboard |
| Logowanie Google OAuth | 1. Klik "Zaloguj przez Google" → 2. Autoryzacja Google | Przekierowanie do /dashboard |
| Błędne hasło | 1. Wpisz zły login/hasło → 2. Klik Zaloguj | Komunikat błędu, brak przekierowania |
| Reset hasła | 1. Klik "Zapomniałem hasła" → 2. Wpisz email → 3. Użyj linku reset | Nowe hasło działa |
| Timeout sesji (15 min) | 1. Zaloguj się → 2. Czekaj 15 min → 3. Wykonaj akcję | Przekierowanie do /login |
| Dostęp bez logowania | 1. Wejdź na /dashboard bez sesji | Przekierowanie do /login |

### 5.2 Flow 2: Zarządzanie pracownikami (PRIORYTET P0)

**Plik:** `tests/dashboard/employees.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Dodanie nowego pracownika | 1. Dashboard → Pracownicy → Dodaj → 2. Wypełnij dane (imię, rola, prowizja) → 3. Zapisz | Pracownik widoczny na liście i w kalendarzu |
| Edycja pracownika | 1. Klik na pracownika → 2. Zmień dane → 3. Zapisz | Dane zaktualizowane, historia zachowana |
| Przypisanie usług | 1. Pracownik → Usługi → 2. Zaznacz usługi → 3. Ustaw indywidualne ceny | Pracownik dostępny przy rezerwacji tych usług |
| Ustawienie grafiku | 1. Pracownik → Grafik → 2. Ustaw godziny na każdy dzień | Grafik widoczny w kalendarzu, sloty dostępne |
| Usuwanie pracownika | 1. Klik Usuń → 2. Potwierdź | Pracownik usunięty, wizyty przyszłe anulowane |
| Nadanie dostępu czasowego | 1. Pracownik → Dostęp → 2. Wybierz funkcje → 3. Ustaw czas | Pracownik widzi dodatkowe opcje do wygaśnięcia |

### 5.3 Flow 3: Zarządzanie usługami i kategoriami (PRIORYTET P0)

**Plik:** `tests/dashboard/services.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Utworzenie kategorii usług | 1. Usługi → Kategorie → Dodaj → 2. Nazwa kategorii → 3. Zapisz | Kategoria widoczna, można przypisać usługi |
| Dodanie usługi z wariantami | 1. Usługi → Dodaj → 2. Nazwa, cena, czas, depozyt % → 3. Dodaj warianty → 4. Zapisz | Usługa widoczna w rezerwacji z wariantami |
| Przypisanie produktów do usługi | 1. Usługa → Materiały → 2. Dodaj produkty auto-odejmowane → 3. Zapisz | Po zakończeniu wizyty produkty odejmowane z magazynu |
| Edycja cen per pracownik | 1. Usługa → Ceny pracowników → 2. Ustaw indywidualne ceny | Przy rezerwacji widoczna cena tego pracownika |

### 5.4 Flow 4: System rezerwacji wizyt (PRIORYTET P0)

**Plik:** `tests/dashboard/appointments.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Nowa wizyta (owner) | 1. Kalendarz → Klik na slot → 2. Wybierz klienta, usługę, pracownika → 3. Potwierdź | Wizyta w kalendarzu, powiadomienie klienta |
| Wizyta z depozytem | 1. Utwórz wizytę z usługą wymagającą depozytu → 2. Klient płaci przez Stripe | Depozyt wpłacony, wizyta potwierdzona |
| Wizyta z promo kodem | 1. Nowa wizyta → 2. Wpisz kod promo → 3. Sprawdź rabat | Cena obniżona, kod zużyty (limit -1) |
| Zakończenie wizyty | 1. Klik Zakończ → 2. Dodaj zużycie materiałów → 3. Wystaw paragon/fakturę | Materiały odjęte, prowizja naliczona, dokument wystawiony |
| Anulowanie wizyty | 1. Klik Anuluj → 2. Podaj powód → 3. Potwierdź | Wizyta anulowana, ewentualny zwrot depozytu |
| Kolizja terminów | 1. Utwórz wizytę → 2. Próbuj utworzyć w tym samym terminie | Błąd: termin zajęty |
| Wizyta pakietowa | 1. Wybierz pakiet usług → 2. Zarezerwuj | Wszystkie usługi zarezerwowane, cena pakietowa |

### 5.5 Flow 5: Magazyn i materiały (PRIORYTET P1)

**Plik:** `tests/dashboard/inventory.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Dodanie produktu | 1. Magazyn → Dodaj → 2. Nazwa, ilość, jednostka, cena, minimum | Produkt widoczny w magazynie |
| Zużycie przy wizycie | 1. Zakończ wizytę z przypisanymi materiałami | Ilość produktu pomniejszona o zużycie |
| Alert niskiego stanu | 1. Produkt spadnie poniżej minimum | Powiadomienie dla właściciela |
| Ręczne zużycie | 1. Produkt → Dodaj zużycie → 2. Ilość + powód | Historia zużycia, ilość zaktualizowana |
| Raport materiałów | 1. Raporty → Materiały → 2. Zakres dat | Zużycie, koszty, trendy |

### 5.6 Flow 6: Narzędzia AI — plan Pro (PRIORYTET P2)

**Plik:** `tests/ai-tools/ai-features.spec.ts`

> **WAŻNE:** Testy AI wymagają mockowania OpenRouter API (nie wysyłamy prawdziwych requestów w testach).

| Narzędzie AI | Scenariusz | Oczekiwany rezultat |
|-------------|-----------|-------------------|
| AI Business Chat | 1. Otwórz czat AI → 2. Zadaj pytanie o salon → 3. Sprawdź odpowiedź | Streaming odpowiedzi, kontekst salonu |
| AI Analytics | 1. Dashboard AI → 2. Generuj analizę | Insights, trendy, rekomendacje |
| AI Content: Social Post | 1. Generuj post → 2. Wybierz platformę → 3. Ton, styl | Post gotowy do publikacji |
| AI Content: Newsletter | 1. Generuj newsletter → 2. Personalizacja | Newsletter z treścią dopasowaną do salonu |
| AI Voice Assistant | 1. Klient dzwoni → 2. AI odpowiada → 3. Rezerwacja/anulowanie | Wizyta umówiona lub anulowana głosowo |
| Bramka planu Basic | 1. Użytkownik Basic próbuje użyć AI | Komunikat: "Wymaga planu Pro" + przycisk upgrade |
| AI Suggestions | 1. Dashboard → Sugestie AI | Spersonalizowane rekomendacje biznesowe |
| AI Daily Recommendations | 1. Dashboard → Rekomendacje dnia | Akcje do podjęcia dzisiaj |

### 5.7 Flow 7: Portal klienta (PRIORYTET P2)

**Plik:** `tests/client-portal/client-flows.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Przeglądanie salonów | 1. Otwórz portal → 2. Szukaj salonu | Lista salonów z ocenami |
| Rezerwacja online | 1. Wybierz salon → 2. Usługa, pracownik, termin → 3. Potwierdź | Wizyta zarezerwowana, potwierdzenie |
| Płatność depozytu | 1. Rezerwacja z depozytem → 2. Płać Stripe/BLIK | Depozyt wpłacony |
| Anulowanie przez klienta | 1. Wizyty → Anuluj → 2. Potwierdź | Wizyta anulowana, zwrot wg polityki |
| Wystawianie opinii | 1. Po wizycie → Wystaw opinię → 2. Ocena + komentarz | Opinia widoczna publicznie |
| Ulubione salony | 1. Dodaj salon do ulubionych | Salon na liście ulubionych |
| Lista oczekujących | 1. Brak terminów → Dołącz do listy | Powiadomienie gdy termin się zwolni |

### 5.8 Flow 8: Raporty i finanse (PRIORYTET P1)

**Plik:** `tests/dashboard/reports.spec.ts`

| Raport | Co sprawdzamy |
|--------|--------------|
| Przychody | Filtrowanie po datach, pracownikach; suma = suma wizyt - rabaty + depozyty |
| Obłożoność pracowników | Procent zajętych slotów vs dostępnych |
| Wynagrodzenia | Prowizje naliczone poprawnie per pracownik |
| Popularność usług | Ranking usług, ilość rezerwacji, przychód |
| Rentowność usług | Przychód - koszt materiałów per usługa |
| Materiały | Zużycie, koszty, trend miesięczny |
| Anulowania | Liczba, powody, utracony przychód |
| Porównanie miesięcy/lat | Trend wzrostowy/spadkowy, wizualizacja |

### 5.9 Flow 9: Subskrypcje i płatności (PRIORYTET P1)

**Plik:** `tests/dashboard/subscriptions.spec.ts`

| Scenariusz | Kroki | Oczekiwany rezultat |
|-----------|-------|-------------------|
| Aktywacja planu Basic | 1. Checkout Stripe → 2. Płatność → 3. Webhook | Plan Basic aktywny, dostęp do funkcji Basic |
| Upgrade Basic → Pro | 1. Klik Upgrade → 2. Płatność różnicowa → 3. Webhook | Plan Pro aktywny, dostęp do AI |
| Downgrade Pro → Basic | 1. Klik Downgrade → 2. Potwierdź | Zmiana na koniec okresu rozliczeniowego |
| Anulowanie subskrypcji | 1. Klik Anuluj → 2. Potwierdź | Dostęp do końca opłaconego okresu |
| 14-dniowy trial | 1. Nowy użytkownik → 2. Sprawdź trial | Pełny dostęp przez 14 dni, potem ograniczenie |
| Webhook Stripe | 1. Symuluj event payment_intent.succeeded | Status płatności zaktualizowany w DB |

---

## 6. Faza 4 — Testy wydajności

**Cel:** Aplikacja musi działać BEZ OPÓŹNIEŃ. API response < 200ms (p95).

### 6.1 Statyczna analiza wydajności kodu

```bash
claude "Przeanalizuj wydajność kodu MyHelper:
1. Sprawdź src/app/api/ pod kątem N+1 queries (Drizzle ORM)
2. Sprawdź brakujące indeksy w schema.ts na kolumnach:
   salonId, clientId, employeeId, startTime, status, createdAt
3. Sprawdź src/components/ pod kątem unnecessary re-renders:
   - Brakujące React.memo na ciężkich komponentach
   - Brakujące useMemo/useCallback w kalendarzach
4. Sprawdź bundle size: next build --analyze
5. Sprawdź memory leaks: useEffect bez cleanup
6. Wygeneruj PERFORMANCE_REPORT.md"
```

### 6.2 Testy obciążeniowe (k6)

**Plik:** `tests/performance/load-test.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // ramp-up
    { duration: '3m', target: 50 },   // plateau
    { duration: '1m', target: 100 },  // peak
    { duration: '1m', target: 0 },    // ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};
```

**Endpointy do testowania obciążeniowego:**

| Endpoint | Dlaczego | Cel p95 |
|----------|---------|--------|
| /api/appointments (GET) | Najczęściej używany, lista wizyt | < 150ms |
| /api/available-slots (GET) | Ciężkie zapytanie, dużo danych | < 200ms |
| /api/dashboard/stats (GET) | Agregacja danych, złożone query | < 300ms |
| /api/reports/revenue (GET) | Raporty finansowe, duże zbiory | < 500ms |
| /api/clients (GET) | Lista klientów, wyszukiwanie | < 150ms |

### 6.3 Lighthouse CI

| Strona | Performance | Accessibility | Best Practices |
|--------|------------|--------------|---------------|
| /login | > 95 | > 95 | > 90 |
| /dashboard | > 85 | > 95 | > 90 |
| /dashboard/calendar | > 80 | > 90 | > 90 |
| /dashboard/reports | > 85 | > 95 | > 90 |
| / (portal klienta) | > 90 | > 95 | > 90 |

---

## 7. Faza 5 — Testy regresyjne i Fix Loop

> ⚠️ **To jest NAJWAŻNIEJSZA faza całego planu. Testy regresyjne gwarantują, że naprawa jednego buga nie psuje drugiego modułu.**

### 7.1 Czym są testy regresyjne w kontekście MyHelper

Testy regresyjne to automatyczne uruchomienie PEŁNEGO zestawu testów po KAŻDEJ zmianie w kodzie. W projekcie z 44 tabelami i 160 endpointami jedna zmiana może kaskadowo zepsuć wiele modułów.

**Przykład:** Naprawiasz endpoint `/api/appointments` → psuje się `/api/reports/revenue` (bo raport korzysta z danych wizyt) → psuje się `/api/appointments/complete` (bo zmieniłeś format danych).

### 7.2 Macierz zależności modułów (co może zepsuć co)

| Zmiana w module | Może zepsuć | Testy regresyjne do uruchomienia |
|----------------|------------|------|
| appointments | reports, invoices, materials, commissions, calendar | test:api + test:e2e:dashboard |
| employees | work-schedules, appointments, calendar, payroll | test:api + test:e2e:calendar |
| services | appointments, promotions, pricing, variants | test:api + test:e2e:booking |
| products | appointments/materials, inventory, reports/materials | test:api + test:e2e:inventory |
| auth / session | **WSZYSTKO** (każdy endpoint wymaga sesji) | **test:all** (pełny zestaw) |
| schema.ts | **WSZYSTKO** (każdy moduł korzysta ze schematu) | **test:all** (pełny zestaw) |
| stripe helpers | subscriptions, deposits, invoices | test:api:finance |
| AI helpers | all ai/* endpoints, subscription gate | test:api:ai + test:e2e:ai |

### 7.3 Komenda `/regression` (`.claude/commands/regression.md`)

Utwórz plik `.claude/commands/regression.md`:

```markdown
Uruchom pełny cykl testów regresyjnych:

1. Uruchom `pnpm typecheck` — STOP jeśli błędy typów
2. Uruchom `pnpm lint` — zapisz ostrzeżenia
3. Uruchom `pnpm test` — pełny zestaw testów jednostkowych
4. Uruchom `pnpm test:e2e` — pełny zestaw testów E2E
5. Jeżeli jakiekolwiek testy failują:
   a. Wylistuj WSZYSTKIE failing testy
   b. Określ którą zmiana je zepsuła (git diff)
   c. Napraw od najbardziej fundamentalnych
   d. Po każdej naprawie uruchom PEŁNY zestaw testów
   e. Powtarzaj aż do 0 failing tests
6. Na końcu uruchom `pnpm build` i napraw błędy budowania
7. Wygeneruj REGRESSION_REPORT.md
```

### 7.4 Fix Loop — pętla naprawcza

Schemat działania agenta w pętli naprawczej:

1. Uruchom WSZYSTKIE testy → zbierz failing tests
2. Posortuj błędy: typy > importy > walidacja > logika > E2E
3. Napraw JEDEN błąd (najważniejszy)
4. Uruchom PEŁNY zestaw testów (regresja!)
5. Jeżeli nowe błędy — najpierw napraw je (nie idź dalej)
6. Powtarzaj aż do 0 failing tests
7. Uruchom `pnpm build` — napraw błędy budowania
8. Uruchom `pnpm test:e2e` — potwierdź że E2E też zielone

> ⚠️ **KLUCZOWA ZASADA:** Po KAŻDEJ naprawie uruchamiaj WSZYSTKIE testy, nie tylko te które failowały. To jest istota testów regresyjnych.

**Prompt dla agenta:**

```bash
claude "Uruchom pętlę naprawczą:
1. pnpm test -- --run (zbierz failing tests)
2. Napraw najważniejszy błąd
3. pnpm test -- --run (PEŁNY zestaw — regresja!)
4. Powtarzaj aż 0 błędów
5. pnpm build (sprawdź budowanie)
6. pnpm test:e2e (sprawdź E2E)
Naprawiaj: typy > importy > walidacja > logika > E2E"
```

---

## 8. Faza 6 — Bramy produkcyjne i Coverage

### 8.1 Progi jakościowe (Quality Gates)

| Metryka | Próg minimalny | Cel optymalny | Narzędzie |
|---------|---------------|--------------|-----------|
| Unit test coverage — statements | > 80% | > 90% | vitest --coverage |
| Unit test coverage — branches | > 75% | > 85% | vitest --coverage |
| E2E critical paths | 100% zielone | 100% zielone | Playwright |
| API response p95 | < 200ms | < 100ms | k6 |
| API response p99 | < 500ms | < 300ms | k6 |
| Lighthouse Performance | > 85 | > 95 | Lighthouse CI |
| Lighthouse Accessibility | > 90 | > 98 | Lighthouse CI |
| Critical vulnerabilities | 0 | 0 | pnpm audit |
| TypeScript errors | 0 | 0 | tsc --noEmit |
| Build success | TAK | TAK | pnpm build |

### 8.2 Prompt generowania raportu

```bash
claude "Wygeneruj finalny raport jakości MyHelper:
1. pnpm test:coverage → raport pokrycia
2. pnpm test:e2e → wyniki E2E
3. pnpm build → rozmiar bundle
4. pnpm audit → podatności
5. pnpm typecheck → błędy TS
Sprawdź progi: coverage > 80%, E2E 100% green,
API < 200ms p95, 0 critical vulnerabilities.
Jeżeli jakiś próg NIE jest spełniony — wylistuj co naprawić.
Wygeneruj QUALITY_REPORT.md"
```

---

## 9. Faza 7 — CI/CD z GitHub Actions

**Plik:** `.github/workflows/quality-gate.yml`

Utwórz ten plik w katalogu `.github/workflows/` w projekcie:

```yaml
name: Quality Gate
on: [push, pull_request]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:coverage

  e2e-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg18
        env:
          POSTGRES_DB: pos_dev
          POSTGRES_USER: dev_user
          POSTGRES_PASSWORD: dev_pass
        ports:
          - '5432:5432'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps
      - run: pnpm test:e2e

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm audit --audit-level=high
```

---

## 10. Instrukcja wdrożenia — co, gdzie dodać w projekcie

### 10.1 Pliki do UTWORZENIA (nowe)

| Plik | Lokalizacja | Opis | Sekcja |
|------|------------|------|--------|
| `vitest.config.ts` | `/` (katalog główny) | Konfiguracja Vitest | 2.4 |
| `playwright.config.ts` | `/` (katalog główny) | Konfiguracja Playwright | 2.5 |
| `__tests__/setup.ts` | `/__tests__/` | Setup plik dla testów (import matchers) | 2.8 |
| `__tests__/lib/*.test.ts` | `/__tests__/lib/` | Testy logiki biznesowej | 4.1 |
| `__tests__/api/*.test.ts` | `/__tests__/api/` | Testy endpointów API | 4.3 |
| `__tests__/components/*.test.tsx` | `/__tests__/components/` | Testy komponentów React | 4.2 |
| `__tests__/hooks/*.test.ts` | `/__tests__/hooks/` | Testy hooków | 4.4 |
| `tests/auth/*.spec.ts` | `/tests/auth/` | E2E autentykacja | 5.1 |
| `tests/dashboard/*.spec.ts` | `/tests/dashboard/` | E2E dashboard | 5.2–5.5, 5.8–5.9 |
| `tests/client-portal/*.spec.ts` | `/tests/client-portal/` | E2E portal klienta | 5.7 |
| `tests/ai-tools/*.spec.ts` | `/tests/ai-tools/` | E2E narzędzia AI | 5.6 |
| `tests/regression/*.spec.ts` | `/tests/regression/` | Testy regresyjne | 7 |
| `.claude/settings.json` | `/.claude/` | Uprawnienia agentów | 2.7 |
| `.claude/commands/audit.md` | `/.claude/commands/` | Komenda /audit | 3.2 |
| `.claude/commands/test.md` | `/.claude/commands/` | Komenda /test | — |
| `.claude/commands/fix.md` | `/.claude/commands/` | Komenda /fix | — |
| `.claude/commands/regression.md` | `/.claude/commands/` | Komenda /regression | 7.3 |
| `.github/workflows/quality-gate.yml` | `/.github/workflows/` | CI/CD pipeline | 9 |

### 10.2 Pliki do ZMODYFIKOWANIA (istniejące)

| Plik | Co dodać/zmienić | Sekcja |
|------|-----------------|--------|
| `CLAUDE.md` | Dopisać sekcje testowania NA KOŃCU (nie zastępować!) | 2.1 |
| `package.json` | Dodać skrypty test/test:e2e/test:coverage do scripts | 2.6 |
| `package.json` | Dodać devDependencies: vitest, playwright, rtl, msw | 2.3 |
| `.gitignore` | Dodać: `test-results/`, `playwright-report/`, `coverage/` | — |

### 10.3 Komenda `.claude/commands/test.md`

```markdown
Napisz brakujące testy dla pliku: $ARGUMENTS
- Testy jednostkowe: każda funkcja, edge cases, null/undefined inputs
- Testy komponentów: render, props, user interactions
- Uruchom testy po napisaniu i napraw jeśli failują
- Po naprawie uruchom PEŁNY zestaw testów (regresja)
```

### 10.4 Komenda `.claude/commands/fix.md`

```markdown
Uruchom pętlę naprawczą:
1. pnpm test -- --run (zbierz failing tests)
2. Napraw pierwszy failing test
3. Uruchom pnpm test ponownie (PEŁNY zestaw — regresja!)
4. Powtarzaj do 0 błędów
5. Na końcu uruchom pnpm build i napraw błędy buildowania
6. Uruchom pnpm test:e2e i napraw jeśli failują
```

### 10.5 Kolejność wykonywania (krok po kroku)

1. Zainstaluj zależności testowe (sekcja 2.3)
2. Utwórz `vitest.config.ts` i `playwright.config.ts` (sekcje 2.4–2.5)
3. Dodaj skrypty do `package.json` (sekcja 2.6)
4. Dopisz sekcje testowania do `CLAUDE.md` (sekcja 2.1)
5. Utwórz `.claude/settings.json` i katalog `commands/` (sekcje 2.7, 3.2, 7.3)
6. Uruchom `/audit` — poznaj stan projektu (sekcja 3)
7. Uruchom Multi-Agent testy jednostkowe (sekcja 4)
8. Uruchom testy E2E (sekcja 5)
9. Uruchom testy wydajności (sekcja 6)
10. Uruchom `/regression` — pętla naprawcza (sekcja 7)
11. Sprawdź bramy jakościowe (sekcja 8)
12. Skonfiguruj CI/CD (sekcja 9)

---

## 11. Harmonogram realizacji

| Faza | Zadanie | Szacowany czas | Narzędzie |
|------|---------|---------------|-----------|
| 0 | Przygotowanie środowiska | 30 min | Ręczne + pnpm |
| 1 | Audyt kodu (/audit) | 15–30 min | Claude Code (1 agent) |
| 2 | Testy jednostkowe (4 agenty) | 1–2 godziny | Claude Code (multi-agent) |
| 3 | Testy E2E (9 flowów) | 1–2 godziny | Claude Code + Playwright |
| 4 | Testy wydajności | 30–60 min | k6 + Lighthouse |
| 5 | Fix Loop + regresja | 3–6 godzin | Claude Code (iteracyjnie) |
| 6 | Bramy produkcyjne | 30 min | Automatyczne |
| 7 | CI/CD setup | 15–30 min | GitHub Actions |
| **TOTAL** | | **7–13 godzin** | |

**REKOMENDACJA:** Rozłóż pracę na 2–3 dni:
- **Dzień 1:** Fazy 0–2 (środowisko + testy jednostkowe)
- **Dzień 2:** Fazy 3–5 (E2E + Fix Loop)
- **Dzień 3:** Fazy 6–7 (jakość + CI/CD)

---

> **Koniec dokumentu**
> Plan testowania MyHelper v1.0 — Marzec 2026