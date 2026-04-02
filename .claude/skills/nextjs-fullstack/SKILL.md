---
name: nextjs-fullstack
metadata:
  version: 1.0.0
description: >
  Living Skill dla projektów Next.js fullstack. Używaj tego skilla zawsze gdy:
  startujesz nowy projekt Next.js, debugujesz E2E testy, konfigurujesz workspace
  lub CI/CD pipeline, naprawiasz TypeScript errors, pracujesz z better-auth,
  Drizzle ORM, Playwright, Vercel. Skill zawiera battle-tested patterns z
  realnych projektów — konkretne antywzorce, gotowe rozwiązania i agent contracts.
  Skill sam się aktualizuje po każdym projekcie — im więcej projektów, tym mądrzejszy.
---

# Next.js Fullstack Living Skill
**Wersja:** 1.0.0 | **Ostatnia aktualizacja:** 2026-03 | **Projekty:** MyHelper v2

> Living Skill — rośnie po każdym projekcie. Po zakończeniu projektu
> uruchom: `/skill-retrospective` żeby zaktualizować ten plik.

---

## Stack (v1.0)
```
Node 22+       pnpm           Next.js 15+     TypeScript strict
Drizzle ORM    better-auth    Playwright       Vitest
Vercel         GitHub Actions  PostgreSQL (Neon/Docker)
```

---

## Trigger Conditions — kiedy czytać ten skill

- Nowy projekt Next.js → zacznij od **Day-0 Checklist**
- Debugging E2E → przejdź do **Anti-Patterns › e2e.md**
- Setup CI/CD → przejdź do **references/ci-cd-setup.md**
- TypeScript errors → przejdź do **Anti-Patterns › typescript.md**
- Koniec projektu → uruchom **Retrospective Protocol**

---

## Critical Rules — nigdy nie łam

Zakodowane z 14+ commitów naprawiających te same błędy w MyHelper:

### E2E
1. `button[type="submit"].click()` — nigdy `keyboard.press('Enter')`
2. `waitUntil: 'load'` — nigdy `'networkidle'` (Next.js nigdy jej nie osiąga)
3. Global setup przez API (`/api/auth/sign-in/email`) — nigdy przez UI
4. `storageState` dla testów dashboardu — nigdy `loginAsUser()` w każdym teście
5. Workers w CI = 2 (GitHub runner = 2 CPU) — więcej paradoksalnie spowalnia

### Database
6. Seed zawsze idempotentny (`onConflictDoUpdate`) — nigdy czysty `insert`
7. Better Auth wymaga wpisu w tabeli `verification` — samo `emailVerified: true` nie wystarczy
8. N+1 queries — zawsze `inArray()` + groupBy w JS zamiast pętli z await

### TypeScript
9. Naprawiaj TypeScript przed E2E — błędy TS mogą być przyczyną failujących testów
10. `pnpm build:ci` w CI — pomija połączenie z DB podczas kompilacji

---

## Day-0 Checklist — nowy projekt

```bash
# 1. Struktura
cp templates/.claude/settings.json .claude/settings.json
cp templates/playwright.config.ts playwright.config.ts
cp templates/vitest.config.ts vitest.config.ts
cp templates/quality-gate.yml .github/workflows/quality-gate.yml

# 2. CLAUDE.md
# Wypełnij szablon z templates/CLAUDE.md

# 3. Testy od razu — nie na końcu
mkdir -p __tests__/components __tests__/lib
mkdir -p tests/auth tests/dashboard tests/production
touch tests/global-setup.ts
touch scripts/seed-test.ts

# 4. Tagi od pierwszego testu
# @smoke, @full, @production — zawsze, od początku

# 5. GitHub Secrets (ręcznie w UI)
# BETTER_AUTH_SECRET
# BETTER_AUTH_BASE_URL_PROD
```

---

## Feature Testing Loop — podczas budowania

Po każdym skończonym feature:

```
1. git diff --name-only HEAD → znajdź zmienione pliki
2. Napisz unit testy dla nowej logiki (edge cases + error paths)
3. Napisz E2E test happy path (tag @smoke jeśli krytyczny)
4. Napisz E2E test error path (tag @full)
5. pnpm test + npx playwright test --grep @smoke
6. Jeśli zielone → commit "feat: [nazwa] + tests"
7. Jeśli czerwone → napraw PRZED commitem
```

**Zasada:** nigdy nie przechodź do następnego feature z czerwonymi testami.

---

## Known Solutions — biblioteka problem → rozwiązanie

| Problem | Rozwiązanie | Źródło |
|---------|-------------|--------|
| Login flaky w CI | Global setup przez API + storageState | MyHelper v2 |
| `networkidle` timeout | Zmień na `'load'` lub `'domcontentloaded'` | MyHelper v2 |
| Better Auth blokuje login mimo emailVerified | Dodaj wpis w tabeli `verification` | MyHelper v2 |
| E2E Full > 2h | Workers=2, @smoke/@full split, storageState | MyHelper v2 |
| N+1 w raportach | `inArray()` + groupBy JS | MyHelper v2 |
| 14 HIGH vulnerabilities | `pnpm overrides` w package.json | MyHelper v2 |
| React re-renders w kalendarzu | `React.memo` + `useCallback` | MyHelper v2 |
| Branch coverage < 80% | Testy error paths + edge cases | MyHelper v2 |

---

## Agents — kiedy używać którego

```
/coder              → pisanie kodu feature
/code-review        → review przed merge
/better-auth-expert → problemy z autentykacją
/tester             → pisanie i debugowanie testów
```

Szczegóły: `agents/AGENT_CONTRACT.md`

---

## Retrospective Protocol — po zakończeniu projektu

Uruchom po każdym projekcie żeby skill urósł:

```
Przeprowadź retrospektywę projektu i zaktualizuj Living Skill.

1. Przejrzyj git log --oneline i znajdź:
   - Błędy które powtarzały się > 1 raz
   - Problemy które zajęły > 2h do rozwiązania
   - Nowe wzorce które odkryłeś

2. Dla każdego nowego odkrycia:
   - Dodaj do Known Solutions table w SKILL.md
   - Dodaj szczegóły do odpowiedniego anti-patterns/*.md
   - Jeśli to nowy typ błędu — utwórz nowy plik w anti-patterns/

3. Zaktualizuj wersję:
   - Nowy anti-pattern → patch (1.0.0 → 1.0.1)
   - Nowa sekcja/agent → minor (1.0.0 → 1.1.0)
   - Zmiana stacku/fundamentalna zmiana → major (1.0.0 → 2.0.0)

4. Zaktualizuj CHANGELOG.md:
   ## [NOWA_WERSJA] — YYYY-MM
   ### Added
   - [co nowego]
   ### Fixed patterns
   - [jakie antywzorce odkryłeś]
   ### Projects
   - [nazwa projektu] — [krótki opis]

5. Zaktualizuj pola w SKILL.md:
   - version: [nowa wersja]
   - Ostatnia aktualizacja: [data]
   - Projekty: [dodaj nowy projekt]
```

---

## Referencje

| Plik | Kiedy czytać |
|------|-------------|
| `references/test-setup.md` | Konfiguracja Playwright, global setup, seed |
| `references/ci-cd-setup.md` | GitHub Actions, workflows, sekrety |
| `anti-patterns/e2e.md` | Debugging E2E, flaky tests |
| `anti-patterns/typescript.md` | TypeScript errors, common fixes |
| `anti-patterns/database.md` | N+1, indeksy, migracje, seed |
| `agents/AGENT_CONTRACT.md` | Multi-agent setup, role agentów |
| `templates/` | Gotowe pliki do kopiowania |
| `CHANGELOG.md` | Historia zmian skilla |
