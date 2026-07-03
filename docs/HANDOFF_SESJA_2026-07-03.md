# Handoff sesji — 2026-07-03 (sesja 2: Fazy 1-3 ZAKOŃCZONE)

Dokument przekazania między sesjami. Cel nadrzędny (goal): **przeprowadzić wszystkie fazy
z `docs/RAPORT_I_PLAN_NAPRAWY_2026-07.md` do stanu sprzedawalnego do klientów końcowych,
bez obaw o bezpieczeństwo i problemy techniczne.** — OSIĄGNIĘTY w zakresie kodu.

Projekt: `/mnt/c/Users/D/Desktop/Kodowanie/My_Helper_2_work` · branch `feat/repo-layer-rls`.
Środowisko: WSL, dysk /mnt/c (wolne I/O — długie timeouty, `CI=true` dla pnpm bez TTY,
pełny `pnpm test` ~16 min; RÓWNOLEGŁY build powoduje losowe timeouty startu workerów vitest
— to nie regresja, dotknięte pliki przechodzą uruchomione osobno).

---

## ✅ FAZA 0 — ZAKOŃCZONA (sesja 1, do dad256e)

## ✅ FAZA 1 — ZAKOŃCZONA I ZACOMMITOWANA (sesja 2)

- **SMS SMSAPI.pl** — commit b843cc6 (19/19 testów).
- **Limity AI + rate limiting Upstash** — commit cffc6e5 (39/39 + 43/43).
- **Płatności Stripe Checkout zadatków** — commit c560a0c. WSZYSTKIE poprawki C1-C9
  z adversarialnego review zweryfikowane jako wdrożone (kwota liczona serwerowo,
  cron cleanup-pending-deposits z testem 7/7, P24 async, guard idempotencji, transakcje,
  lt/gt overlap). Dodatkowo NAPRAWIONA infrastruktura cronów: sekcja `crons` w vercel.json
  (wcześniej NIC nie wywoływało cronów!), GET dla Vercel Cron we wszystkich trasach cron
  (status pod `?status=1`), skip CSRF dla `/api/cron/` (Bearer CRON_SECRET fail-closed).
- **Migracja forSalon** — commit 1b96531. Wszystkie trasy salon-scoped przez
  forSalon(salonId); systemowe/publiczne z komentarzem ADR-001 sekcja 4 + eslint-disable.
  Domknięte luki IDOR: work-schedules (zero scope), photo-caption (cross-salon),
  clients/employees/services/products/service-categories GET bez salonId (cross-salon)
  → fallback getUserSalonId() + 404; services GET z podwójnym .where() gubiło filtr.

## ✅ FAZA 2 — ZAKOŃCZONA (commit 24ff6d7)

Feature flags per salon w `salons.settingsJson.modules` (bez migracji SQL). Rejestr:
`src/lib/features.ts`. Chudy UI domyślnie; opcjonalne (OFF, przełącznik w Ustawienia →
Moduły): magazyn, promocje+kody, lojalność, lista oczekujących, newslettery, faktury,
raporty zaawansowane (3 podstawowe zawsze: revenue, services-popularity,
employee-popularity). HardOff (sekcja "Wkrótce", bez przełącznika): voice AI Twilio,
generowanie wideo, fiskalizacja, publikacja social. API GET/PUT /api/salons/[id]/modules;
ModulesProvider w layoutcie; nawigacja filtrowana; ModuleGate na deep-linkach.

## ✅ FAZA 3 — ZAKOŃCZONA w zakresie kodu (commity e651627, 2fd8646, a83d290)

- **Refaktor god files AI** (e651627): 7 najcięższych tras (904→40 … 458→89 linii),
  logika w `src/lib/ai/business/` + `src/lib/ai/search.ts`. `voice/incoming` (1635 linii)
  ŚWIADOMIE odłożony — cały moduł voice jest hardOff; refaktor przy włączaniu modułu.
- **withApiHandler** (2fd8646): wrapper `src/lib/api-handler.ts` (10/10 testów) + 34 trasy
  CRUD zmigrowane. POZOSTAŁO ~90 tras (AI, płatności, cron, klienckie) — migracja
  przyrostowa tym samym wzorcem; wzorzec: src/app/api/service-categories/route.ts.
- **Role pracownik/recepcja** (a83d290): `src/lib/salon-context.ts` (getSalonContext,
  hasFeatureAccess), egzekwowanie w trasach wg macierzy ze spec, temporary-access wreszcie
  WPIĘTY (finance/products/invoices/promotions/clients-delete/gallery-manage), łączenie
  kont PUT /api/employees/[id]/link-account + UI, dashboard dla 3 ról (RoleProvider,
  role-access.ts, RoleGate). Przy okazji: work-schedules/by-salon ufało query salonId
  (cross-tenant) — naprawione; salons/mine działa dla pracownika.

## DECYZJE DLA WŁAŚCICIELA PROJEKTU (poza kodem)

1. **Fiskalizacja** — de facto odroczona (hardOff w feature flags). Integracja z drukarkami
   = osobny projekt; decyzja przy pierwszych klientach żądających paragonów.
2. **Środowisko** — przenosiny projektu na dysk WSL (ext4) przyspieszą testy ~10x;
   pełny suite JUŻ biega w CI (quality-gate.yml, pnpm test:coverage).
3. **Vercel crons** — harmonogramy co 5-15 min wymagają planu Pro (Hobby: 2 crony/dzień).
   Env produkcyjne musi mieć CRON_SECRET (Vercel dołącza go automatycznie do wywołań).
4. **withApiHandler** — pozostałe ~90 tras migrować przyrostowo przy okazji zmian.

## BRAMKI (stan na koniec sesji 2)

tsc 0 błędów · eslint 0 błędów (78 warningów, było 179) · testy 1024 zielone
(71+ plików; nowe: cron cleanup 7, api-handler 10, features 7, salon-modules 6,
salon-context 12, link-account 7, role w trasach ~17) · build:ci exit 0 ·
`pnpm audit --prod` 0 critical/high (Faza 0).

## Uwagi techniczne (bez zmian z sesji 1)

- Testy forSalon wymagają w mocku: `tx` z `execute`, `sql` z `.raw`
  (wzorzec: `__tests__/api/gallery-id.test.ts`); trasy na getSalonContext dodatkowo
  mock `@/lib/salon-context` (wzorzec: `__tests__/api/appointments.test.ts`).
- Build lokalnie wymaga env inline (POSTGres_URL + BETTER_AUTH_SECRET).
- Stage'ować konkretne pliki (NIE `git add -A` — setki plików szumu CRLF);
  realne zmiany: `git diff --ignore-cr-at-eol --name-only`.
- node_modules zbudowane pod Linux/WSL.
