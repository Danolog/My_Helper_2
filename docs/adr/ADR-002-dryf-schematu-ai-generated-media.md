# ADR-002 — Dryf schematu `ai_generated_media` (rozjazd `schema.ts` ↔ historia migracji)

**Status:** Zdecydowany (Ethan, CTO — mandat decyzji technicznej, CLAUDE.md sekcja 8). Część wykonalna lokalnie/test wchodzi od razu (migracja `0006`, idempotentna). **Zastosowanie na bazie produkcyjnej Neon = czerwona linia** (migracja schemy prod, CLAUDE.md sekcja 4) → osobny sign-off Darka w Plan Mode.
**Data:** 2026-06-18
**Autor:** Ethan (CTO)
**Wersja:** v1.0
**Dotyczy:** `Danolog/My_Helper_2` @ gałąź `chore/rls-runbook-gates`. Powiązane: ADR-001 (RLS), runbook prod RLS (`docs/security/2026-06-18-prod-rls-rollout-runbook.md` sekcja 3.1, dług D-RLS-3, ryzyko R4), migracja `drizzle/0006_ai_generated_media_catchup.sql`.
**Lens:** standard production-readiness nordsignal — domena 2 (API & backend), domena 8 (Security & RLS), domena 6 (Data & migracje).

> **Słowniczek** (żargon tłumaczony, CLAUDE.md sekcja 3):
> **dryf schematu** (rozjazd między modelem docelowym w kodzie a tym, co faktycznie założono w bazie/migracjach);
> **migracja** (ponumerowany plik SQL zmieniający schemat bazy, stosowany w stałej kolejności przez `db:migrate`);
> **`db:push`** (tryb drizzle, który czyta `schema.ts` i nadpisuje schemat bazy BEZPOŚREDNIO, z pominięciem plików migracji — wygodny lokalnie, ale nie zostawia historii);
> **snapshot drizzle** (`drizzle/meta/*.json` — zapis stanu schematu, który drizzle „pamięta"; podstawa liczenia różnic przy `db:generate`);
> **journal** (`drizzle/meta/_journal.json` — lista migracji uznanych za zaaplikowane, w kolejności);
> **catch-up / backfill** (migracja „doganiająca" — pojednuje historię migracji ze stanem już istniejącym w bazie, bez tworzenia czegokolwiek od nowa);
> **idempotentny** (można puścić wielokrotnie bez błędu i bez zmiany skutku — tu: `IF NOT EXISTS`, guardy `pg_constraint`);
> **RLS** (Row-Level Security — izolacja najemcy egzekwowana przez bazę; ADR-001);
> **`to_regclass`** (funkcja Postgres zwracająca nazwę obiektu, gdy istnieje, albo `NULL`, gdy nie — bezpieczny test obecności tabeli).

---

## 1. Problem — co jest rozjechane i dlaczego to ważne

Tabela `ai_generated_media` jest zdefiniowana w `src/lib/schema.ts:816-843` (kolumny: `id`, `salon_id` NOT NULL z FK do `salons` ON DELETE cascade, `type`, `source_url`, `result_url`, `provider`, `prompt`, `status`, `task_id`, `metadata` jsonb, `error_message`, `created_at`, `updated_at`; trzy indeksy). **Żadna migracja `0000`–`0004` jej nie tworzy**, a migracja `0005` (RLS) tylko **wymienia ją na liście** tabel do izolacji najemcy — z komentarzem wprost: „ai_generated_media nie ma jeszcze migracji tworzącej".

Dlaczego to nie jest kosmetyka: tabela trzyma `salon_id` i jest celem żywej funkcji. Rozjazd między modelem (`schema.ts`) a zastosowanym schematem to dokładnie klasa błędu, która otwiera ciche dziury cross-tenant (ryzyko R4 runbooka) — RLS „nie wie", że ma chronić tabelę, której migracje nie znają.

---

## 2. Ustalony stan faktyczny (decyzja oparta na dowodach, nie na założeniu)

**(a) Tabela jest UŻYWANA — to żywa funkcja, nie martwy kod.**
- `src/lib/ai/openrouter.ts:433` — `db.insert(aiGeneratedMedia)`.
- `src/app/api/ai/video/generate/route.ts`, `.../video/status/[taskId]/route.ts`, `.../video/story/route.ts` — insert/select/update z filtrem `salonId`.
- `src/app/api/ai/usage/route.ts` — agregacja po `type`/`provider`.
- UI ją napędza: `src/components/content-generator/{video-generator,story-generator,testimonial-template}.tsx`.
- Brak markerów `TODO`/`WIP`/`disabled`/`stub` w tych trasach. Funkcja jest zbudowana end-to-end. → **Wariant 1 (martwy kod / celowo nieobecna) odpada.**

**(b) Jak powstał dryf — `db:push` zamiast migracji.**
- Tabela weszła do `schema.ts` jednym dużym commitem `df68df8` „feat: AI First transformation — full implementation (6 sprints)".
- `grep -rn ai_generated_media drizzle/*.sql` → tylko `0005` (lista RLS), **zero `CREATE TABLE ai_generated_media`**.
- **`drizzle-kit generate` jej nie zna**: w `drizzle/meta/0005_snapshot.json` `ai_generated_media` występuje **0 razy** (dla porównania `ai_conversations` — 12 razy, bo dostała `CREATE TABLE` w migracji `0002`). Czyli po dodaniu do `schema.ts` nikt nie odpalił `db:generate`.
- Repo ma dwie ścieżki materializacji schematu: `db:migrate` (`package.json:build`, README) **oraz** `db:push` (`db:dev`, `db:reset`, i — kluczowe — CI quality-gate buduje bazę testową przez `pnpm db:push`: `.github/workflows/quality-gate.yml:92,:160`). `db:push` czyta `schema.ts` bezpośrednio, więc na bazach push tabela istnieje mimo braku migracji.
- **To nie odosobniony przypadek.** Ten sam typ dryfu dotyczy też kilku FK/indeksów zdefiniowanych w `schema.ts`, których nie ma w żadnej migracji ani w snapshotach: `appointment_materials_product_id_products_id_fk`, `fiscal_receipts_appointment_id/salon_id ... fk`, indeks `clients_birthday_idx`. `ai_generated_media` jest najpoważniejszym (bo niesie `salon_id`), ale nie jedynym objawem systemowego dryfu z workflow opartego na `db:push`.

**(c) Czy tabela istnieje na PRODUKCJI — wniosek z dowodów + jedna niewiadoma.**
- Build deployujący prod to **`build:ci` = `next build`** (z `vercel.json`), **bez** `db:migrate` ani `db:push`. Brak też kroku migrate w CI deployu. Czyli prod-schemat = suma tego, co historycznie ręcznie/`db:push`-em zastosowano na Neon — nie potrafię tego odtworzyć z repo.
- **Wniosek z dowodów:** jedyny mechanizm, jakim ta tabela kiedykolwiek powstaje, to `db:push` z `schema.ts`. Jeśli funkcję AI media kiedykolwiek uruchamiano na prod (a jest w pełni zbudowana i wpięta w UI), tabela najpewniej **została tam wepchnięta przez `db:push`** — i wtedy **istnieje na prod**, a brakuje tylko historii migracji (klasyczny **Wariant 3 — backfill**). Jeśli funkcji nigdy nie puszczono na prod — tabeli tam nie ma.
- Nie mam dostępu do prod (czerwona linia). Zamiast zgadywać — projektuję decyzję tak, by była **poprawna w obu przypadkach** (migracja idempotentna), i wskazuję **jedno** read-only pytanie rozstrzygające (sekcja „Weryfikacja").

---

## 3. Decyzja — Wariant 3 (backfill / pojednanie historii), idempotentny, bezpieczny w obu stanach prod

Wybieram **Wariant 3**: pojednać historię migracji ze stanem `schema.ts`, nie tworzyć tabeli na ślepo (Wariant 2). Powód: dowody wskazują, że tabela najpewniej **już istnieje na prod** (powstała przez `db:push`) — wtedy ślepy `CREATE TABLE` z Wariantu 2 wywróciłby się na `relation already exists`. Wariant 3 z `CREATE TABLE IF NOT EXISTS` degeneruje się czysto do Wariantu 2, gdyby jednak tabeli nie było (wtedy ją tworzy). Jedna migracja pokrywa oba stany prod.

**Co robię (i co jest w repo na tej gałęzi):**
- **`drizzle/0006_ai_generated_media_catchup.sql`** — migracja catch-up, **w pełni idempotentna**:
  - `CREATE TABLE IF NOT EXISTS ai_generated_media` (definicja 1:1 z `schema.ts`, identyczna z tym, co policzył `drizzle-kit generate`),
  - FK + 3 indeksy tej tabeli (FK idempotentnie przez sprawdzenie `pg_constraint`, indeksy `IF NOT EXISTS`),
  - pozostały dryf tego samego typu (FK `appointment_materials`/`fiscal_receipts`, indeks `clients_birthday`) — też idempotentnie, żeby `0006` realnie pojednało bazę z `schema.ts` (zgodnie ze snapshotem `0006`),
  - **warunkowo RLS na `ai_generated_media`**: blok zakłada `ENABLE RLS` + politykę `tenant_isolation` + `GRANT` dla roli `myhelper_app` **tylko jeśli ta rola istnieje** (tj. RLS-tenant już wdrożony na tej bazie — lokalnie z `0005`). Na prod przed RLS rola nie istnieje → blok się pomija → politykę założy runbook RLS (ma `ai_generated_media` na liście). To domyka ryzyko „tabela żywa, ale bez polityki = cross-tenant".
- **Snapshot + journal** (`drizzle/meta/0006_snapshot.json`, wpis w `_journal.json`) wygenerowane przez `drizzle-kit generate` — pojednują stan, który drizzle „pamięta", ze `schema.ts`. Od teraz `db:generate` nie będzie już zgłaszać tego dryfu jako różnicy.

**Czego świadomie NIE robię:**
- Nie stosuję `0006` na prod. To migracja schemy produkcyjnej — czerwona linia (CLAUDE.md sekcja 4), sign-off Darka.
- Nie usuwam niczego z `schema.ts` (tabela jest używana — Wariant 1 odrzucony).
- Nie wpisuję drizzle'owej, nieidempotentnej wersji `0006` (surowe `CREATE TABLE`/`ADD CONSTRAINT`), bo wywaliłaby się na prod, gdzie obiekty już istnieją.

---

## 4. Weryfikacja — JEDNO pytanie rozstrzygające stan prod (read-only, bezpieczne)

Przed (lub w trakcie) sign-offu Darka, na prod (read-only, bez czerwonej linii — sam `SELECT`):

```sql
SELECT to_regclass('public.ai_generated_media');
```

- **Zwraca nazwę** → tabela ISTNIEJE na prod (potwierdzony Wariant 3 — powstała przez `db:push`). `0006` zadziała jako czysty backfill (no-op na `CREATE`, ewentualnie tylko polityka RLS, jeśli RLS już wdrożony). Izolacja: upewnić się, że runbook RLS obejmie tabelę (już obejmuje).
- **Zwraca `NULL`** → tabeli NIE ma na prod (funkcji nigdy nie puszczono na prod). `0006` ją utworzy (FK + indeksy). Kolejność: `0006` **przed** wdrożeniem RLS.

Albo zwięźlej, łącznie z resztą dryfu (do wglądu przy przeglądzie zakresu Ryana):

```sql
SELECT to_regclass('public.ai_generated_media') AS tabela,
       to_regclass('public.clients_birthday_idx') AS idx_birthday;
```

Wynik = artefakt do bramki (zrzut do PR). To jedyna niewiadoma, której nie da się rozstrzygnąć z repo; nie przerzucam na Darka całej decyzji — tylko ten jeden odczyt.

---

## 5. Konsekwencje i kolejność wykonania (po sign-offie Darka)

1. **Read-only check** `to_regclass(...)` na prod → zapis wyniku.
2. **`0006` na prod** (po sign-offie) — ręcznie, w transakcji, pod rolą owner, endpoint bezpośredni Neon (jak runbook RLS sekcja 3; **nie** przez `db:migrate` celujący w prod — zakaz R6 runbooka). Idempotentna, więc bezpieczna niezależnie od wyniku kroku 1.
3. **RLS prod** (runbook) — jeśli jeszcze nie wdrożony: po `0006`. Asercja F1 runbooka i tak zatrzyma wdrożenie, gdyby `ai_generated_media` istniała bez polityki — `0006` + lista runbooka domykają to z wyprzedzeniem.
4. **Dług resztkowy** — pełne sprzątanie workflow „migracje vs `db:push`" (żeby CI i prod nie rozjeżdżały się znowu) to osobne zadanie: albo CI quality-gate przechodzi z `db:push` na `db:migrate` (spójność jednej ścieżki), albo zostaje świadomie reguła „push tylko lokalnie". To poza tym ADR — tu domykam wyłącznie skutek dla `ai_generated_media` i izolacji najemcy.

Aktualizacja runbooka: sekcja 3.1 odsyła do tej decyzji (Wariant 3) zamiast pozostawiać „Wariant 1 vs 2 do sign-offu". Dług D-RLS-3 w runbooku wskazuje ten ADR jako rozstrzygnięcie.

---

## 6. Alternatywy odrzucone

- **Wariant 1 (tabela martwa / celowo nieobecna; ewentualnie usunąć z `schema.ts`).** Odrzucony twardo dowodem: tabela jest celem 4 tras API i UI generatora wideo/story (sekcja 2a). Usunięcie z `schema.ts` zepsułoby działającą funkcję.
- **Wariant 2 (ślepa migracja `CREATE TABLE` bez `IF NOT EXISTS`).** Odrzucony: dowody wskazują, że tabela najpewniej już istnieje na prod (push) — `CREATE TABLE` rzuciłby `relation already exists` i wywrócił wdrożenie. Wariant 3 z `IF NOT EXISTS` pokrywa też przypadek „nie istnieje", więc dominuje Wariant 2 bez jego ryzyka.
- **Surowa migracja z `drizzle-kit generate` (nieidempotentna).** Odrzucona: poprawna dla świeżej bazy, ale na prod z istniejącymi obiektami wywala się; miesza też w jednym pliku wiele różnych deltad dryfu bez guardów.

---

## Self-critique (rola: principal engineer po incydencie cross-tenant z migracji-widma)

Pięć słabości i co z nimi:

1. **„Najpewniej istnieje na prod" to wciąż wnioskowanie, nie pomiar — czy decyzja nie stoi na założeniu o stanie prod?** Świadomie rozdzieliłem: *decyzja o wariancie* (backfill, idempotentny) NIE zależy od stanu prod — migracja jest poprawna w obu przypadkach (`IF NOT EXISTS`). Od stanu prod zależy tylko *kolejność* względem RLS i interpretacja (czysty backfill vs utworzenie). Tę jedną niewiadomą rozstrzyga jedno read-only `to_regclass` (sekcja 4), nie cała decyzja. To jest właśnie „wybierz najbezpieczniejszy wariant + jedno pytanie", nie przerzucenie decyzji.

2. **Idempotentny `CREATE TABLE IF NOT EXISTS` może zamaskować rozjazd kolumn.** Jeśli tabela na prod powstała przez starszy `db:push` z innym zestawem kolumn niż dzisiejszy `schema.ts`, `IF NOT EXISTS` jej NIE wyrówna (pominie). Ryzyko rezydualne: kolumny mogą się różnić. Mitygacja zapisana: definicja `0006` jest 1:1 z `schema.ts` (więc świeża baza będzie zgodna), a dla istniejącej tabeli różnice kolumn wychwyci `drizzle-kit generate` przy następnym sprawdzeniu dryfu (snapshot `0006` jest teraz odniesieniem). Pełne wyrównanie kolumn = część „długu resztkowego" (sekcja 5.4), nie udaję, że `0006` to robi.

3. **`0006` dokłada FK/indeksy spoza `ai_generated_media` (fiscal_receipts itd.) — rozszerzam zakres ponad temat zadania.** Świadome: to ten sam dryf z tego samego `db:push`, a snapshot `0006` i tak je obejmuje — zostawienie ich tylko w snapshocie, a nie w SQL, dałoby kolejny rozjazd (snapshot mówi „są", SQL ich nie kładzie). Wszystkie są idempotentne i nie dotyczą izolacji najemcy (to FK/indeksy, nie tabele z `salon_id` do RLS), więc nie rozszerzają powierzchni bezpieczeństwa. Alternatywę (osobna migracja na resztę) odrzuciłem jako sztuczne dzielenie jednego catch-upu.

4. **Czy RLS-blok warunkowy (`IF rola istnieje`) nie jest zbyt sprytny?** Ryzyko: ktoś założy rolę `myhelper_app` na bazie BEZ pełnego RLS i blok założy politykę tylko na tej jednej tabeli. W praktyce rola `myhelper_app` powstaje wyłącznie z `0005`/runbooka, które zakładają RLS na całości — więc obecność roli jest wiarygodnym sygnałem „RLS tu jest". Gdyby jednak nie — asercja F1 runbooka wychwyci niespójność zakresu. Prostsza alternatywa (zawsze zakładaj politykę) odrzucona, bo na prod przed RLS rzuciłaby błąd na braku roli `myhelper_app` w `GRANT`.

5. **Zostawiam dług workflow `db:push` vs migracje nierozwiązany — to znów się rozjedzie.** Prawda: jeśli CI dalej buduje przez `db:push`, kolejna tabela dodana tylko do `schema.ts` powtórzy historię. Nazwałem to wprost jako dług resztkowy (sekcja 5.4) z dwiema konkretnymi opcjami (CI na `db:migrate` albo świadoma reguła „push tylko lokalnie") — ale świadomie poza zakresem tego ADR, którego ostrzem jest izolacja najemcy `ai_generated_media`, nie reforma pipeline'u. Asercja F1 chroni izolację niezależnie od tego, kiedy dług workflow zostanie spłacony.
