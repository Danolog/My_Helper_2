# Komenda: /faza6
# Lokalizacja: .claude/commands/faza6.md
# Użycie: wpisz /faza6 w Claude Code

## Cel: Weryfikacja bram jakościowych

Przeczytaj TYLKO sekcję 8 ("Faza 6") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 5 jest zakończona (✅).

## Uruchom wszystkie weryfikacje:

```bash
# 1. Coverage
pnpm test:coverage 2>&1 | tail -20

# 2. E2E
pnpm test:e2e 2>&1 | tail -20

# 3. Build
pnpm build 2>&1 | tail -10

# 4. Security
pnpm audit 2>&1 | tail -20

# 5. TypeScript
pnpm typecheck 2>&1 | tail -10
```

## Sprawdź progi (z sekcji 8.1):

| Metryka | Próg minimalny | Wynik | Status |
|---------|---------------|-------|--------|
| Coverage statements | > 80% | ? | ✅/❌ |
| Coverage branches | > 75% | ? | ✅/❌ |
| E2E P0 paths | 100% green | ? | ✅/❌ |
| TypeScript errors | 0 | ? | ✅/❌ |
| Critical vulnerabilities | 0 | ? | ✅/❌ |
| Build | success | ? | ✅/❌ |

## Jeśli jakikolwiek próg NIE jest spełniony:
Wylistuj DOKŁADNIE co naprawić. Wróć do /faza5 jeśli potrzeba.

## Wygeneruj raport
Utwórz QUALITY_REPORT.md z tabelą wyników powyżej.

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 6 na ✅ ZAKOŃCZONA.
Powiedz: "Faza 6 zakończona. Uruchom /orchestrator żeby przejść dalej."
