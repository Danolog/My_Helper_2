# Komenda: /faza1
# Lokalizacja: .claude/commands/faza1.md
# Użycie: wpisz /faza1 w Claude Code

## Cel: Pełny audyt kodu projektu MyHelper

Przeczytaj TYLKO sekcję 3 ("Faza 1") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 0 jest zakończona (✅). Jeśli NIE — powiedz użytkownikowi żeby najpierw uruchomił /faza0.

## Wykonaj następujące kroki:

### Krok 1: TypeScript check
```bash
pnpm typecheck 2>&1 | tee /tmp/ts-errors.log
```
Zapisz liczbę błędów.

### Krok 2: ESLint check
```bash
pnpm lint 2>&1 | tee /tmp/eslint-errors.log
```
Zapisz liczbę problemów.

### Krok 3: Audyt API Security
Przejrzyj KAŻDY plik w `src/app/api/` szukając:
- Endpointów bez try/catch
- Endpointów bez walidacji Zod na inputach
- Endpointów bez weryfikacji sesji (Better Auth)
- Endpointów bez sprawdzenia roli użytkownika (owner/employee/receptionist/client)

### Krok 4: Audyt komponentów
Przejrzyj `src/components/` szukając:
- Komponentów bez stanów error/loading
- useEffect bez cleanup (memory leaks)
- Formularzy bez walidacji

### Krok 5: Audyt schematu bazy
Sprawdź `src/lib/schema.ts` pod kątem:
- Brakujących indeksów na kolumnach: salonId, clientId, employeeId, startTime, status, createdAt
- Brakujących relacji/constraints

### Krok 6: Audyt bezpieczeństwa zależności
```bash
pnpm audit 2>&1 | tee /tmp/audit-results.log
```

### Krok 7: Wygeneruj raport
Utwórz plik `AUDIT_REPORT.md` w katalogu głównym z sekcjami:
- **KRYTYCZNE** (P0) — blokujące produkcję
- **WYSOKIE** (P1) — poważne problemy
- **ŚREDNIE** (P2) — do naprawienia
- **NISKIE** (P3) — kosmetyczne

Każdy wpis powinien zawierać: plik, linia, opis problemu, sugerowana naprawa.

## Kryterium sukcesu
- Plik AUDIT_REPORT.md istnieje i jest kompletny
- Każdy plik w src/app/api/ został sprawdzony
- Znane są dokładne liczby: błędy TS, problemy ESLint, brakujące try/catch, brakujące walidacje

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 1 na ✅ ZAKOŃCZONA z datą.
W uwagach wpisz podsumowanie: ile błędów krytycznych, ile wysokich.
Powiedz użytkownikowi: "Faza 1 zakończona. AUDIT_REPORT.md gotowy. Uruchom /orchestrator żeby przejść dalej."
