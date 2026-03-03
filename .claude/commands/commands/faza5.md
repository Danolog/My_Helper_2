# Komenda: /faza5
# Lokalizacja: .claude/commands/faza5.md
# Użycie: wpisz /faza5 w Claude Code

## Cel: Pętla naprawcza z testami regresyjnymi

Przeczytaj TYLKO sekcję 7 ("Faza 5") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 4 jest zakończona (✅). Jeśli NIE — powiedz użytkownikowi żeby najpierw uruchomił /faza4.

## ⚠️ TO JEST NAJWAŻNIEJSZA FAZA — CZYTAJ UWAŻNIE

### Zasada #1: Po KAŻDEJ naprawie uruchom PEŁNY zestaw testów
Nie tylko testy dla zmienionego pliku — WSZYSTKIE testy. To jest istota regresji.

### Zasada #2: Naprawiaj od fundamentalnych do złożonych
Kolejność: TypeScript errors > import errors > walidacja Zod > logika biznesowa > E2E

### Zasada #3: Jeden bug na raz
Napraw JEDEN problem → uruchom WSZYSTKIE testy → dopiero potem następny.

## Pętla naprawcza — wykonuj iteracyjnie:

### Iteracja N:

```bash
# 1. Sprawdź typy
pnpm typecheck 2>&1 | head -50

# 2. Uruchom testy jednostkowe
pnpm test -- --run 2>&1 | tail -30

# 3. Policz failing testy
```

Jeśli są failing testy:
1. Wylistuj WSZYSTKIE failing testy
2. Wybierz NAJWAŻNIEJSZY (wg priorytetów z docs/TESTING_PLAN.md sekcja 1.4)
3. Napraw TEN JEDEN bug
4. Uruchom `pnpm test -- --run` (PEŁNY zestaw!)
5. Jeśli naprawa stworzyła NOWE failing testy → napraw JE NAJPIERW
6. Wróć do kroku 1

Powtarzaj aż: `pnpm test -- --run` daje 0 failing tests.

### Po osiągnięciu 0 failing unit tests:

```bash
# Sprawdź build
pnpm build 2>&1 | tail -20

# Sprawdź E2E
pnpm test:e2e 2>&1 | tail -30
```

Jeśli E2E failują — napraw tą samą metodą (jeden bug → pełna regresja).

## Macierz zależności — użyj przy diagnozowaniu

Przeczytaj sekcję 7.2 z docs/TESTING_PLAN.md.
Jeśli naprawiasz moduł X — sprawdź w macierzy które moduły mogą się zepsuć.

## Kryterium sukcesu
- `pnpm typecheck` — 0 błędów
- `pnpm test -- --run` — 0 failing tests
- `pnpm build` — sukces
- `pnpm test:e2e` — P0 flows 100% zielone

## Po zakończeniu
Utwórz REGRESSION_REPORT.md z:
- Ile bugów naprawiono
- Ile iteracji pętli
- Które moduły były najbardziej problematyczne

Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 5 na ✅ ZAKOŃCZONA.
Powiedz: "Faza 5 zakończona. Uruchom /orchestrator żeby przejść dalej."
