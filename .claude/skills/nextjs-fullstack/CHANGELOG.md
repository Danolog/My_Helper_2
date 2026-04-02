# Changelog — Next.js Fullstack Living Skill

Format: `[wersja] — YYYY-MM | Projekt: nazwa`

---

## [1.0.0] — 2026-03 | Projekt: MyHelper v2

### Projekty
- **MyHelper v2** — aplikacja SaaS dla salonów (Next.js 15, Drizzle, better-auth, Vercel)
  - 818 unit testów, 171 E2E testów, 0 failed
  - E2E czas: 2.6h → 4.6 min (28x szybciej)
  - 14 vulnerabilities → 0
  - Branch coverage: 77% → 88%

### Added
- Day-0 Checklist dla nowych projektów
- Feature Testing Loop (testuj każdy feature od razu)
- Three-layer testing: @smoke / @full / @production
- Global setup przez API (nie przez UI)
- StorageState pattern dla testów wymagających auth
- Retrospective Protocol — jak aktualizować skill po projekcie
- Agent Contract dla multi-agent workflows

### Battle-tested Anti-Patterns (odkryte w MyHelper v2)

**E2E — 14+ commitów naprawiających te same błędy:**
- `keyboard.press('Enter')` → zawodne gdy React nie hydrated
- `waitUntil: 'networkidle'` → Next.js nigdy nie osiąga (keep-alive)
- Logowanie przez UI w global setup → race condition
- Workers > 2 w CI → paradoksalnie wolniej (GitHub runner = 2 CPU)
- Brak wpisu w tabeli `verification` → Better Auth blokuje login

**Database:**
- N+1 queries w raportach (31 zapytań → 4, 87% redukcja)
- Seed bez `onConflictDoUpdate` → failuje przy ponownym uruchomieniu

**Performance:**
- Composite DB indexes (CIDX-01, CIDX-02, IDX-01, IDX-02) — 0.03-0.15ms
- React.memo + useCallback w CalendarPage — 20+ → 0 re-renderów

### Known Solutions dodane
- 8 wpisów w tabeli Known Solutions
- 3 pliki anti-patterns z konkretnymi wzorcami kodu
