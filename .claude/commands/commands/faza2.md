# Komenda: /faza2
# Lokalizacja: .claude/commands/faza2.md
# Użycie: wpisz /faza2 w Claude Code

## Cel: Napisać testy jednostkowe dla całego projektu

Przeczytaj TYLKO sekcję 4 ("Faza 2") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 1 jest zakończona (✅). Jeśli NIE — powiedz użytkownikowi żeby najpierw uruchomił /faza1.

## WAŻNE: Strategia podziału pracy

Ta faza jest NAJWIĘKSZA — obejmuje ~160 endpointów, wiele komponentów i hooków.
Podziel pracę na 4 OSOBNE przebiegi (lub użyj subagentów jeśli dostępne).

Jeżeli pracujesz jako JEDEN agent — wykonuj przebiegi SEKWENCYJNIE:
1. Najpierw: testy lib/ (logika biznesowa)
2. Potem: testy api/ (endpointy)
3. Potem: testy components/ (UI)
4. Na końcu: testy hooks/

Jeżeli masz dostęp do SUBAGENTÓW — deleguj równolegle:

```
Utwórz 4 subagentów:
- Agent 1: "Przeczytaj sekcję 4.1 z docs/TESTING_PLAN.md i napisz testy dla src/lib/"
- Agent 2: "Przeczytaj sekcję 4.3 z docs/TESTING_PLAN.md i napisz testy dla src/app/api/"
- Agent 3: "Przeczytaj sekcję 4.2 z docs/TESTING_PLAN.md i napisz testy dla src/components/"
- Agent 4: "Przeczytaj sekcję 4.4 z docs/TESTING_PLAN.md i napisz testy dla src/hooks/"
```

## Przebieg 1: Testy logiki biznesowej (__tests__/lib/)

Dla KAŻDEJ funkcji eksportowanej z src/lib/ napisz testy w __tests__/lib/[nazwa].test.ts:
- Happy path (poprawne dane → poprawny wynik)
- Error path (błędne dane → obsłużony błąd)
- Edge cases (null, undefined, puste stringi, graniczne wartości)

Mockuj: bazę danych (Drizzle), Stripe API, OpenRouter API.
Format: describe('NazwaModułu', () => { it('should...') })

Po napisaniu uruchom: `pnpm test -- --run __tests__/lib/`

## Przebieg 2: Testy API (__tests__/api/)

Dla KAŻDEGO endpointu z src/app/api/ napisz testy w __tests__/api/[domena].test.ts.

KAŻDY endpoint musi mieć 5 scenariuszy:
1. ✅ Sukces (200/201) — poprawne dane, poprawna odpowiedź
2. 🔒 Brak autoryzacji (401) — brak sesji / wygasła sesja
3. 🚫 Brak uprawnień (403) — zła rola
4. ❌ Nieprawidłowe dane (400) — walidacja Zod
5. 💥 Błąd serwera (500) — obsługa wyjątków

Grupuj testy po domenach:
- __tests__/api/appointments.test.ts
- __tests__/api/clients.test.ts
- __tests__/api/employees.test.ts
- __tests__/api/services.test.ts
- __tests__/api/products.test.ts
- __tests__/api/subscriptions.test.ts
- __tests__/api/reports.test.ts
- __tests__/api/ai.test.ts
- __tests__/api/client-portal.test.ts

Po napisaniu uruchom: `pnpm test -- --run __tests__/api/`

## Przebieg 3: Testy komponentów (__tests__/components/)

Użyj React Testing Library + @testing-library/user-event.
Mockuj API calls z MSW (Mock Service Worker).

Priorytet komponentów (testuj w tej kolejności):
1. Formularze autentykacji (LoginForm, RegisterForm)
2. Formularze CRUD (EmployeeForm, ServiceForm, ProductForm)
3. Dialogi wizyt (AppointmentDialog, CompleteDialog, CancelDialog)
4. Komponenty kalendarza (TimeGrid, WeekTimeGrid, EventComponent)
5. Komponenty raportów (ReportFilters, RevenueChart)
6. Bramka subskrypcji (SubscriptionGate)
7. Komponenty AI (ChatInterface, ContentGenerator)

Po napisaniu uruchom: `pnpm test -- --run __tests__/components/`

## Przebieg 4: Testy hooków (__tests__/hooks/)

Użyj renderHook z @testing-library/react.
Testuj: wywołania API, cache'owanie, obsługę błędów, stany ładowania.

Po napisaniu uruchom: `pnpm test -- --run __tests__/hooks/`

## Po wszystkich przebiegach — weryfikacja

```bash
pnpm test -- --run                    # wszystkie testy jednostkowe
pnpm test -- --run --coverage         # raport pokrycia
```

## Kryterium sukcesu
- Wszystkie testy przechodzą (0 failing)
- Coverage > 60% (cel to 80%, ale na tym etapie 60% jest OK — Fix Loop podniesie)
- Każdy endpoint API ma minimum 3 scenariusze testowe

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 2 na ✅ ZAKOŃCZONA.
W uwagach: liczba testów, coverage %, ew. skipped/failing.
Powiedz: "Faza 2 zakończona. Uruchom /orchestrator żeby przejść dalej."
