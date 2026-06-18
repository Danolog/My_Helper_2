# PLAN AKTUALIZACJI PODATNOŚCI BEZPIECZEŃSTWA — My_Helper_2

**Zespół:** Ethan (CTO) + Leo (Tech Lead) · nordsignal
**Data:** 2026-06-18
**Status:** PLAN (proposal) — żadna zmiana zależności nie została wykonana.
**Wykonanie PR-0 (siatka testów):** w toku, gałąź `test/pr0-siatka-bezpieczenstwa`.

> **Żargon w nawiasach przy pierwszym użyciu.** CVE = publicznie zarejestrowana luka bezpieczeństwa. Peer dependency = zależność wzajemna (pakiet A wymaga konkretnej wersji pakietu B). Breaking change = zmiana łamiąca zgodność wstecz. Transitive = zależność pośrednia (przyciągnięta przez inny pakiet). Override = ręczne wymuszenie wersji zależności pośredniej.

---

## 0. Sprostowanie do briefu — zanim cokolwiek ruszymy

Pierwotny brief mówił „13 podatności (4 low, 7 moderate, 2 high)" — liczył je `npm audit`. **Tej liczby nie potwierdzamy.** Repo używa **pnpm**, nie npm. Żywy `pnpm audit` na obecnym lockfile pokazuje:

**128 podatności: 11 low · 71 moderate · 44 high · 2 critical.**

- Decyzję podejmujemy na danych z 2026-06-18, nie na liczbie z briefu.
- Są **2 krytyczne**, których brief nie wymieniał: `protobufjs` (wykonanie dowolnego kodu, przez `@google/genai`) i `vitest` (odczyt dowolnego pliku gdy działa Vitest UI — narzędzie deweloperskie, nie produkcja).

Korekta faktyczna: brief twierdził, że poprawka drizzle-orm to breaking change „przeciw better-auth". **Jest odwrotnie** — `better-auth@1.6.19` już deklaruje `drizzle-orm: ^0.45.2` jako peer dependency. Obecny `drizzle-orm@0.44.7` **już teraz łamie wymóg better-auth**. Aktualizacja drizzle go *naprawia*.

---

## 1. Triage — które luki realnie dotykają aplikacji (wg ryzyka produkcyjnego)

Kryterium: czy podatna ścieżka jest osiągalna **na produkcji** (Vercel runtime), czy to narzędzie deweloperskie/CI (continuous integration).

### Tier 1 — produkcyjne, osiągalne przez atakującego (napraw najpierw)

| Pakiet | Severity | Realny wpływ | Ścieżka używana? |
|---|---|---|---|
| **next** (16.1.6 → ≥16.2.5) | high | DoS (Denial of Service) na Server Components; obejście CSRF w dev HMR, cache poisoning, redirecty middleware/proxy. | TAK — cała aplikacja |
| **drizzle-orm** (0.44.7 → ≥0.45.2) | high | SQL injection „via improperly escaped SQL identifiers" (nazwy kolumn/tabel, nie wartości). Repo **nie** buduje identyfikatorów z danych użytkownika. Blast radius (zasięg) realnie niski — ale to high CVE w sercu każdej trasy API. | TAK (169 plików), wzorzec podatny nieobecny |
| **better-auth peer mismatch** | ryzyko | wymaga drizzle ≥0.45.2; mamy 0.44.7. Niezgodność może dać subtelne błędy auth. | TAK — auth każdej trasy chronionej |

### Tier 2 — produkcyjne, ale wektor wąski / za zaufaną granicą

| Pakiet | Severity | Uwaga |
|---|---|---|
| **axios** (przez `twilio`) | high ×4 | prototype pollution, header injection. Transitive przez Twilio (SMS) — wektor mało realny. Fix = bump `twilio`. |
| **@google/genai → protobufjs** | **critical** | code execution. Wektor wymaga kontroli bajtów protobuf z modelu Google — realnie niski. Fix = bump `@google/genai` lub override `protobufjs ≥7.5.6`. |
| **@ai-sdk/provider-utils** | low | uncontrolled resource consumption (brief mówił „moderate" — audit pokazuje **low**). |

### Tier 3 — wyłącznie dev/CI, NIE produkcja (nie blokuje deploya)

| Pakiet | Severity | Dlaczego nie produkcja |
|---|---|---|
| **vitest** | **critical** | Vitest UI — uruchamiany lokalnie, nigdy na produkcji. |
| **esbuild** | moderate | **Już naprawione** — override `esbuild: ">=0.25.0"`, zainstalowany 0.25.12. |
| vite, happy-dom, picomatch, flatted, brace-expansion, fast-uri, @babel/core, dompurify, path-to-regexp | high/mod/low | devDependencies / narzędzia. Nie trafiają do bundle produkcyjnego. |

**Wniosek triage:** z 44 high realnie produkcyjne i wymagające zmiany kodu są **dwa** (next, drizzle-orm). Skala zadania: **S/M**, nie L.

---

## 2. Kolejność aktualizacji

1. **PR-0 (M):** test CSRF/proxy + test SQL injection `check-first-visit`. Siatka bezpieczeństwa. **← realizowane teraz.**
2. **PR-1 (S):** override'y zależności pośrednich (`protobufjs ≥7.5.6`, `axios ≥1.15.2`, `fast-uri`, `picomatch`, `path-to-regexp`, `vite`, `vitest`, `happy-dom`, `defu`). Zero zmian w naszym kodzie.
3. **PR-2 (S/M):** `drizzle-orm 0.45.2` + `drizzle-kit` zgodny (idą razem). Po tym peer better-auth spełniony.
4. **PR-3 (M):** `next ≥16.2.5` + `eslint-config-next` (idą razem). Najwięcej uwagi na `proxy.ts`.
5. **PR-4 (L) — ODŁOŻONY:** `ai@6` + `@ai-sdk/react@3` + provider-utils. Zamyka tylko 1 low, wymaga re-testu całej ścieżki AI. Osobna decyzja Sophii (PO).

Muszą iść w parze: drizzle-orm ↔ drizzle-kit; next ↔ eslint-config-next; ai ↔ @ai-sdk/react ↔ provider-utils.

---

## 3. Breaking changes — co konkretnie może się zepsuć

### 3a. drizzle-orm 0.44 → 0.45 (PR-2)
- Jedyne surowe podzapytanie na danych użytkownika: `src/app/api/promotions/check-first-visit/route.ts:102` — `sql\`${appointments.bookedByUserId} IN (SELECT id FROM "user" WHERE email = ${email})\``. `${email}` jest parametryzowany (bezpieczny). **Action: test, że wstrzyknięcie `email = "x' OR '1'='1"` nie ucieka z parametryzacji** — test powinien istnieć niezależnie od CVE.
- 169 plików importuje drizzle; dominują bezpieczne wzorce (`eq`, `and`, `inArray`, `sql` z kolumnami jako placeholdery). Brak `sql.raw()` i konkatenacji do SQL.
- **DoD PR-2:** `pnpm db:generate` bez nieoczekiwanej migracji; `pnpm typecheck` zielony; testy `__tests__/api/*` zielone; regresja P0 zielona.

### 3b. next 16.1.6 → ≥16.2.5 (PR-3) — tu leży ryzyko dla napraw P0
Newralgiczny plik: **`src/proxy.ts`** (w Next 16 „middleware" przemianowano na „proxy"; istnieje martwy `src/middleware.ts.bak` do usunięcia). `proxy.ts` robi rdzeń napraw P0: (1) CSP z nonce per-request (Content Security Policy; nonce = jednorazowy token), (2) ochronę CSRF (signed double-submit cookie), (3) ochronę auth tras `/dashboard`, `/admin`.
Do weryfikacji po bumpie: zachowanie `NextRequest`/`NextResponse` i `getSessionCookie`, wstrzykiwanie nagłówków CSP/nonce, sygnatury `params: Promise<{id}>`.

### 3c. ai 5 → 6 (PR-4, odłożony)
Repo używa API z wersji 5 (`streamText().toUIMessageStreamResponse()`, `convertToModelMessages`, `UIMessage`). Bump wymusza zmianę backendu i frontendu (`useChat`) naraz. Nagroda: 1 low. Relacja ryzyko/korzyść zła dla tej rundy.

---

## 4. Pokrycie testami regresji

**Istnieje:** `stripe-webhook.test.ts` (P0-C), `gallery-id.test.ts` (P0-A IDOR), `tests/auth/authentication.spec.ts` (e2e logowania), testy `[id]` izolacji salonów, CI `quality-gate.yml` + `e2e-production.yml`.

**Brakuje (domknąć PRZED aktualizacją):**
1. **Dedykowany test CSRF/proxy** — żaden test nie sprawdza, że mutacja (POST/PATCH/DELETE) bez ważnego tokenu CSRF jest odrzucana, ani że trasa chroniona przekierowuje niezalogowanego. **Największa luka** — bo PR-3 dotyka właśnie `proxy.ts`.
2. **Test SQL injection na `check-first-visit`** (sekcja 3a).
3. Test izolacji multi-tenant na poziomie zapytań drizzle.
4. Weryfikacja pokrycia webhooka Twilio (widoczny test tylko dla Stripe).

**Rekomendacja:** PR-0 = testy 1 i 2. Bez nich aktualizujemy Next/drizzle bez siatki na wektory, które repo dopiero co załatało („compounding > heroics" — najpierw siatka, potem skok).

---

## 5. Rekomendacja

**Wariant zalecany: „Tier 1+2 teraz, AI SDK odłożony, najpierw siatka testowa".** Sekwencja PR-0 → PR-1 → PR-2 → PR-3, PR-4 odłożony.

**Łączny nakład PR-0…PR-3: M (średni), 2–4 dni robocze** — dominują testy (PR-0) i weryfikacja proxy po bumpie Next (PR-3).

**Ryzyko: NISKIE-ŚREDNIE.** Niskie dla PR-1/PR-2; średnie dla PR-3 (Next dotyka warstwy CSRF/auth) — zmitygowane przez PR-0.

Świadomie *nie* zamykamy w tej rundzie: 1 critical w `vitest` (tylko dev), 1 low w ai SDK (zła relacja ryzyko/korzyść). Oba udokumentowane jako akceptowane — Built-to-Sell wymaga śladu „dlaczego nie".

**Czerwone linie (CLAUDE.md sekcja 4):** PR-2 = migracja schemy bazy produkcyjnej; cała runda rusza kod auth/CSRF. Każdy PR wymaga code review Ethana + drugiego reviewera na Opus 4.8 i **nie wchodzi na produkcję** bez sign-offu bezpieczeństwa Ryana i akceptacji Darka dla migracji prod.

---

## 6. Self-critique (5 słabości, poprawione)

1. „Blast radius drizzle niski" oparte na grep — zawężono do „nie znaleziono wzorca `sql.identifier`/`orderBy` z requestu" + drizzle zostaje w Tier 1 + wymóg testu injection.
2. PR-3 (Next) nie jest „zwykłym bezpiecznym bumpem" — `proxy.ts` podniesiony do głównego ryzyka rundy, PR-3 uzależniony od testu CSRF (PR-0).
3. Liczby z briefu zakwestionowane (sekcja 0) — inaczej przeoczono by 2 critical i błędny kierunek drizzle↔better-auth.
4. DoD per PR skonkretyzowany (maszynowo sprawdzalne kryteria), usunięcie martwego `middleware.ts.bak`.
5. Critical `vitest` i low `ai` świadomie akceptowane *z uzasadnieniem* — ślad „dlaczego nie zamknęliśmy" jako wymóg Built-to-Sell.
