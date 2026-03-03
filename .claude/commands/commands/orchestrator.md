# Komenda: /orchestrator
# Lokalizacja: .claude/commands/orchestrator.md
# Użycie: wpisz /orchestrator w Claude Code

Jesteś orkiestratorem testowania projektu MyHelper.

## Twoje zadanie

Przeczytaj TYLKO sekcję "10.5 Kolejność wykonywania" z docs/TESTING_PLAN.md.
NIE czytaj całego dokumentu — jest za duży na kontekst.

## Sprawdź aktualny stan

1. Sprawdź czy istnieje plik `docs/TESTING_STATUS.md`
2. Jeśli NIE istnieje — utwórz go z poniższym szablonem
3. Jeśli istnieje — przeczytaj go i określ która faza jest następna

## Szablon TESTING_STATUS.md

```markdown
# Status Testowania MyHelper

## Postęp faz

| Faza | Status | Data rozpoczęcia | Data zakończenia | Uwagi |
|------|--------|-----------------|-----------------|-------|
| 0 — Środowisko | ⏳ OCZEKUJE | | | |
| 1 — Audyt | ⏳ OCZEKUJE | | | |
| 2 — Testy jednostkowe | ⏳ OCZEKUJE | | | |
| 3 — Testy E2E | ⏳ OCZEKUJE | | | |
| 4 — Wydajność | ⏳ OCZEKUJE | | | |
| 5 — Fix Loop + Regresja | ⏳ OCZEKUJE | | | |
| 6 — Bramy jakościowe | ⏳ OCZEKUJE | | | |
| 7 — CI/CD | ⏳ OCZEKUJE | | | |

## Ostatnia zakończona faza: BRAK
## Następna faza do wykonania: Faza 0

## Logi zmian
- [DATA] — Inicjalizacja planu testowania
```

## Po ustaleniu następnej fazy

Powiedz użytkownikowi:
1. Która faza jest następna
2. Jaką komendę powinien uruchomić (np. `/faza0`, `/faza1` itd.)
3. Szacowany czas wykonania

NIE wykonuj żadnej fazy samodzielnie — tylko informuj i zarządzaj statusem.

Po zakończeniu każdej fazy użytkownik powinien wrócić do Ciebie (`/orchestrator`) żebyś zaktualizował status i wskazał następny krok.
