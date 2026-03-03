# Komenda: /faza0
# Lokalizacja: .claude/commands/faza0.md
# Użycie: wpisz /faza0 w Claude Code

## Cel: Przygotowanie środowiska testowego

Przeczytaj TYLKO sekcję 2 ("Faza 0") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Wykonaj następujące kroki w tej kolejności:

### Krok 1: Instalacja zależności
```bash
pnpm add -D vitest @vitejs/plugin-react @testing-library/react \
  @testing-library/jest-dom @testing-library/user-event \
  @playwright/test msw happy-dom @vitest/coverage-v8
```

### Krok 2: Utwórz pliki konfiguracyjne
Przeczytaj sekcje 2.4 i 2.5 z docs/TESTING_PLAN.md i utwórz:
- `vitest.config.ts` (w katalogu głównym)
- `playwright.config.ts` (w katalogu głównym)
- `__tests__/setup.ts` (zawartość: `import '@testing-library/jest-dom';`)

### Krok 3: Dodaj skrypty do package.json
Przeczytaj sekcję 2.6 z docs/TESTING_PLAN.md i dodaj skrypty testowe do istniejącej sekcji "scripts" w package.json. NIE nadpisuj istniejących skryptów.

### Krok 4: Utwórz strukturę katalogów
```bash
mkdir -p __tests__/{lib,api,components,hooks}
mkdir -p tests/{auth,dashboard,client-portal,ai-tools,regression}
mkdir -p .claude/commands
mkdir -p .github/workflows
```

### Krok 5: Dopisz do CLAUDE.md
Przeczytaj sekcję 2.1 z docs/TESTING_PLAN.md. DOPISZ sekcje testowania NA KOŃCU istniejącego pliku CLAUDE.md. NIE zastępuj istniejącej treści.

### Krok 6: Utwórz .claude/settings.json
Przeczytaj sekcję 2.7 z docs/TESTING_PLAN.md i utwórz plik.

### Krok 7: Dodaj do .gitignore
Dopisz na końcu .gitignore:
```
test-results/
playwright-report/
coverage/
```

### Krok 8: Weryfikacja
Uruchom:
```bash
pnpm test 2>&1 || echo "Vitest skonfigurowany (brak testów to OK)"
pnpm typecheck
```

## Kryterium sukcesu
- `pnpm test` uruchamia się bez błędów konfiguracji (brak testów = OK)
- `pnpm typecheck` przechodzi bez błędów
- Istnieją katalogi __tests__/ i tests/
- Istnieje .claude/settings.json

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 0 na ✅ ZAKOŃCZONA z datą.
Powiedz użytkownikowi: "Faza 0 zakończona. Uruchom /orchestrator żeby przejść dalej."
