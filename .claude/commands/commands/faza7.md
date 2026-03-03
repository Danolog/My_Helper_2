# Komenda: /faza7
# Lokalizacja: .claude/commands/faza7.md
# Użycie: wpisz /faza7 w Claude Code

## Cel: Konfiguracja CI/CD z GitHub Actions

Przeczytaj TYLKO sekcję 9 ("Faza 7") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 6 jest zakończona (✅).

## Krok 1: Utwórz workflow

Utwórz plik `.github/workflows/quality-gate.yml` z treścią z sekcji 9 docs/TESTING_PLAN.md.

Upewnij się że:
- Job `e2e-tests` ma service container z PostgreSQL (pgvector/pgvector:pg18)
- Używa pnpm (nie npm)
- Node version pochodzi z .nvmrc
- Playwright jest instalowany z `--with-deps`

## Krok 2: Weryfikacja składni

```bash
# Sprawdź czy YAML jest poprawny
cat .github/workflows/quality-gate.yml | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin)" && echo "YAML OK"
```

## Krok 3: Dodaj badge do README (opcjonalnie)

```markdown
![Quality Gate](https://github.com/[user]/[repo]/actions/workflows/quality-gate.yml/badge.svg)
```

## Kryterium sukcesu
- .github/workflows/quality-gate.yml istnieje i jest poprawnym YAML
- Zawiera 4 joby: typecheck, unit-tests, e2e-tests, security

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 7 na ✅ ZAKOŃCZONA.
Powiedz: "WSZYSTKIE FAZY ZAKOŃCZONE! System testowania MyHelper jest gotowy."
