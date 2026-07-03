# MyHelper — Finalny raport audytu i plan wypuszczenia do klienta

**Data:** 2026-07-02 · **Wersja aplikacji:** 1.1.2 · **Zakres:** bezpieczeństwo, jakość kodu, funkcjonalności, strategia produktowa

> Ten dokument zastępuje `AUDIT_REPORT.md` z 2026-03-03, który jest w większości nieaktualny —
> czerwcowa akcja naprawcza (widoczna w git: naprawy P0 IDOR, RLS, warstwa `forSalon`, webhooki)
> usunęła większość tamtych ustaleń.

---

## 1. Podsumowanie zarządcze

**Werdykt: aplikacji nie trzeba przerabiać — trzeba ją domknąć i schować połowę.**

Fundament jest ponadprzeciętny jak na projekt tej skali (~137 tys. linii, 182 endpointy API,
86 stron, 46 tabel): izolacja salonów wymuszona strukturalnie (warstwa repozytorium
`forSalon` + Row-Level Security w Postgresie), 0 błędów TypeScript w trybie strict,
centralna walidacja Zod, 926 testów jednostkowych + testy integracyjne izolacji tenantów
na realnej bazie + E2E Playwright.

**Do wypuszczenia blokują trzy rzeczy, które są sercem obietnicy biznesowej, a dziś są atrapami:**

1. **Pobieranie zadatków nie działa naprawdę** — `deposits/create-session` zwraca fałszywy
   `sessionId`, `paymentUrl` prowadzi do nieistniejących endpointów, frontend symuluje płatność.
   „Blik P2P" to tylko pole na numer telefonu. Realne są jedynie zwroty przez Stripe.
2. **SMS-y nie wychodzą** — `src/lib/sms.ts` loguje do konsoli i oznacza powiadomienie jako „sent".
3. **Fiskalizacja to symulacja** — test-connection/test-print udają (słusznie odłożona, ale wymaga decyzji).

Do tego dochodzą: **130 podatności w zależnościach** (w tym Next.js proxy bypass i SQLi w drizzle-orm),
**brak twardych limitów kosztów AI** (ryzyko ujemnej marży na planie Pro) oraz **21 failujących testów**,
w tym testy izolacji tenantów.

Realna ścieżka do klienta: **4–6 tygodni** (Fazy 0–2 poniżej), z czego większość to dokończenie
trzech integracji, nie pisanie nowych funkcji.

---

## 2. Bezpieczeństwo — stan aktualny

### Co jest dobre (zweryfikowane)

- **168/182 (92%) endpointów z autoryzacją** (`requireAuth`/`getUserSalonId`/`requireCronSecret`/`requireProAI`);
  14 pozostałych to zasadnie publiczne trasy (health, auth, publiczne profile salonów, webhooki z podpisem).
- **Multi-tenancy — mocny punkt:** `forSalon(salonId)` wymusza filtr + prawdziwy RLS w Postgresie
  (`SET LOCAL ROLE myhelper_app`, migracja `0005_rls_tenant_isolation.sql`, 38 polityk). Ręczna próbka
  15 endpointów CRUD: wszystkie poprawnie izolują salon.
- **Stripe webhook:** obowiązkowa weryfikacja podpisu, bez dev-fallbacku. **Twilio webhook głosowy:**
  walidacja `X-Twilio-Signature`, fail-closed.
- **`deposits/confirm`:** wyłączony w produkcji (twardy guard NODE_ENV), dev-only symulator.
- **CRON (8 tras):** `requireCronSecret` fail-closed — brak sekretu w env = 500, nie przepuszcza.
- **`/api/seed`:** zablokowany w produkcji (403) + wymaga roli owner.
- **Sekrety:** zero hardcoded kluczy w repo, `.env*` w `.gitignore`, `env.example` tylko z placeholderami.
- **CSRF + CSP:** signed double-submit cookie + per-request nonce w `src/proxy.ts`.

### Do naprawienia

| Priorytet | Problem | Szczegóły / pliki |
|---|---|---|
| **KRYTYCZNY** | 130 podatności w zależnościach (2 critical, 45 high) | **next 16.1.6 — proxy bypass** (w proxy żyje CSRF i CSP!); **drizzle-orm — SQL injection**; twilio (axios ×10 HIGH), better-auth, @vercel/blob, @google/genai (protobufjs critical) |
| WYSOKI | Brak twardych limitów kosztów AI | Użycie tylko rejestrowane (`trackAIUsage`); brak kwoty miesięcznej i rate-limitu na generowanie obrazów/video/rozmowy. Użytkownik Pro (149 PLN) może wygenerować nieograniczone koszty Veo/Twilio |
| ŚREDNI | Upload plików — stored XSS | `src/app/api/gallery/upload/route.ts`: rozszerzenie z `file.name.split(".").pop()` bez walidacji, MIME deklarowany przez klienta → można wgrać `.html`/`.svg`. Fix: allowlista rozszerzeń + magic bytes (sharp); `storage.ts` ma gotowe sanityzacje, trasa z nich nie korzysta |
| ŚREDNI | Rate limiting in-memory | `src/lib/rate-limit.ts` — na serverless per-instancja, reset na cold start; pokrywa 18/182 tras, żadnej AI. Potrzebny Upstash/Redis |
| NISKI | Drobiazgi | Brak podpisu Twilio na `ai/voice/twilio/status`; dev-fallback sekretu CSRF w `csrf.ts` (zamienić na twardy błąd w prod); 4 trasy `promotions/check*` sondowalne po UUID; martwe wpisy w `CRON_ENDPOINTS` w `proxy.ts` |

---

## 3. Jakość kodu — stan aktualny

| Obszar | Wynik | Ocena |
|---|---|---|
| TypeScript (strict) | **0 błędów**; 1× `: any`, 3× `as any` na 137 tys. linii | DOBRA |
| ESLint | 13 errors, 1957 warnings (1060 auto-fix; ~1105 to `import/order`) | ŚREDNIA |
| Testy jednostkowe | **905 passed / 21 failed** (926 testów, 65 plików) | DOBRA z regresją |
| Error handling API | 180/182 tras z try/catch; 178/182 z `logger`; console.log tylko w samym loggerze | DOBRA |
| Walidacja | 100/118 tras mutujących z Zod (centralnie: `api-validation.ts` + `validateBody`) | DOBRA |
| Schema (46 tabel) | 81 FK, 104 indeksy, RLS; migracja 0004 dodała kompozyty | DOBRA z brakami |

### Najważniejsze problemy

1. **Niedokończona migracja na `forSalon` — 98/182 tras nadal na surowym `db`**
   (98 warningów `no-restricted-imports` — własna reguła lintera to śledzi). Skutek przykładowy:
   `GET /api/services` bez parametru `salonId` zwraca usługi wszystkich salonów. Migracja „R2"
   jest w toku (git) — domknąć.
2. **21 failujących testów, w tym izolacja tenantów P0-A**: `__tests__/api/gallery-id.test.ts` —
   `DELETE /api/gallery/[id]` zwraca 500 zamiast 404 (cudzy zasób) / 200 (własny). Regresja
   handlera lub rozjazd mocków z warstwą repozytorium — do wyjaśnienia w pierwszej kolejności.
3. **God files w `src/app/api/ai/**`**: `voice/incoming/route.ts` — **1634 linie** (cały voice-bot
   w handlerze HTTP); `business/{alerts,trends,weekly-recommendations}` — 905/865/729 linii.
   Logika domenowa inline, nietestowalna jednostkowo.
4. **Niedomknięte punkty schematu** (jedyne, co zostało z marcowego audytu):
   brak FK `appointments.variantId → service_variants.id` (kolumna używana m.in. w
   `client/appointments/[id]/route.ts` — realne ryzyko sierot) i brak indeksu na `appointments.endTime`.
5. **Środowisko dev:** projekt na `/mnt/c` z node_modules zbudowanymi pod Windows — Vitest w WSL
   nie startuje bez ręcznego dogrania natywnych binariów (rollup/esbuild), a pełny przebieg testów
   trwa 14 min, z czego same testy 17 s (reszta = I/O). Przenieść na dysk WSL (ext4) albo pracować
   konsekwentnie spod Windows.
6. Brak wrappera `withApiHandler()` — ~15-liniowy preambuł (rate-limit → auth → validate → try/catch)
   kopiowany w 182 trasach.

---

## 4. Funkcjonalności — mapa i kompletność

Spec deklaruje 253 funkcje; kod realnie implementuje: 57 podstron dashboardu, 15 podstron portalu
klienta, ~182 endpointy na prawdziwej bazie (nie mocki).

### Kompletne i gotowe (rdzeń)

Kalendarz + grafiki, rezerwacje (pełny cykl z materiałami/prowizjami/historią zabiegów),
kartoteka klientów (historia, alergie, zgody), usługi + warianty + ceny per pracownik,
pracownicy, **portal klienta** (przeglądanie salonów, rezerwacja online, ulubione, opinie,
lista oczekujących), galeria before/after, opinie z moderacją, subskrypcje Stripe
(checkout + webhook + gating Basic/Pro egzekwowany serwerowo), magazyn, promocje,
kody rabatowe, lojalność, 13 raportów z eksportem PDF/Excel, faktury, push (VAPID), PWA.

### Atrapy / świadome stuby (blokują sprzedaż)

| Funkcja | Stan | Co trzeba zrobić |
|---|---|---|
| **Zadatki — pobranie płatności** | Fałszywy sessionId, nieistniejące trasy checkout, frontend symuluje | Prawdziwy Stripe Checkout (model danych, walidacja slotów i zwroty już działają) |
| **Blik P2P** | Tylko pole na numer telefonu, brak bramki | Usunąć — BLIK przyjdzie „za darmo" jako metoda płatności w Stripe (PLN) |
| **SMS** | `sms.ts` loguje do konsoli, oznacza jako „sent" | Polski provider (SMSAPI / SerwerSMS) — interfejs gotowy, wymiana implementacji |
| **Fiskalizacja** | test-connection/test-print symulują | Osobny projekt — decyzja strategiczna, nie kod na już |
| **Publikacja postów social** | Symulowana | Odłożyć (flaga) |

### AI (tylko Pro, gating poprawny) — 4 płatnych dostawców

| Funkcja | Dostawca | Rekomendacja |
|---|---|---|
| Asystent biznesowy (chat nad danymi salonu, rekomendacje, alerty, trendy) | OpenRouter (Claude) | **Zostawić — główny wyróżnik vs Booksy** |
| Generator treści (posty, opisy, newslettery, odpowiedzi na opinie) | OpenRouter | Zostawić (tanie) |
| Generowanie obrazów | Google Imagen | Zostawić z limitem miesięcznym |
| Generowanie video | Google Veo (~0,15 USD/wywołanie) | **Wyłączyć flagą** — ryzyko marży |
| Asystent głosowy telefoniczny | Twilio + ElevenLabs + OpenRouter | **Wyłączyć flagą** — najdroższy i najbardziej złożony moduł; wrócić jako płatny dodatek |
| TTS/STT | ElevenLabs | Wyłączyć razem z voice |

---

## 5. Plan naprawy

### Faza 0 — Blokery techniczne (~1 tydzień) — **WYKONANA 2026-07-03**

- [x] **Naprawa 21 czerwonych testów** — przyczyną nie była regresja bezpieczeństwa, lecz mocki
      nienadążające za warstwą repozytorium (`sql.raw` dla `SET LOCAL ROLE`, `tx.execute`);
      naprawione w gallery-id / appointments / appointment-complete + zaktualizowane 3 testy
      komponentów (OfflineBanner ×2, SignInButton — test nieaktualny wobec kodu)
- [x] **Aktualizacja zależności**: next 16.1.6→16.2.10, drizzle-orm 0.44.7→0.45.2 (SQLi),
      better-auth 1.4.18→1.6.23, @vercel/blob 2.0.1→2.5.0, drizzle-kit, vitest 4.1.9 +
      overrides (axios, protobufjs, path-to-regexp, undici 7.28, ws, defu, fast-uri, tmp,
      form-data, picomatch scoped, hono) + vite 7.3.5 jako devDep (peer omijał overrides)
      → **`pnpm audit --prod`: 0 critical / 0 high** (zostały 22 low/moderate przechodnie)
- [x] Fix uploadu galerii: rozszerzenie wyłącznie z formatu wykrytego przez sharp (magic bytes),
      nazwa pliku nigdy z wejścia klienta
- [x] CSRF: brak `BETTER_AUTH_SECRET` w produkcji = twardy błąd przy starcie; podpis Twilio
      (fail-closed) na `voice/twilio/status` — wspólny helper w `src/lib/twilio.ts`
- [x] ESLint: **0 errors** (było 13), warnings 1957→179 (pozostałe to głównie celowe
      98 `no-restricted-imports` śledzące dług forSalon); `--max-warnings` w CI — do włączenia
      po domknięciu forSalon
- [x] Migracja DB `0006`: FK `appointments.variantId`→service_variants (set null) + indeksy
      `endTime`/`variantId` + domknięcie długu po `db:push` (tabela `ai_generated_media`
      **z polityką RLS** — bez tego czysta baza tworzyłaby ją bez izolacji; FK fiscal_receipts
      i appointment_materials z czyszczeniem sierot). Idempotentna; zweryfikowana na czystej
      bazie 0000→0006 + ponowne wykonanie (kontener jednorazowy)

Uwaga środowiskowa: `node_modules` przebudowane pod Linux/WSL — przy pracy spod Windows
powtórzyć `pnpm install`.

### Faza 1 — Dokończenie rdzenia sprzedażowego (2–4 tygodnie)

- [ ] **Prawdziwy Stripe Checkout dla zadatków** + obsługa webhooka płatności depozytu; usunięcie atrapy „Blik P2P" (BLIK = metoda płatności Stripe w PLN)
- [ ] **Realny provider SMS** (SMSAPI / SerwerSMS; koszt ~7–9 gr/SMS wliczyć w cennik)
- [ ] **Twarde limity AI**: miesięczna pula kredytów per salon egzekwowana PRZED wywołaniem (infrastruktura `trackAIUsage` już liczy koszty) + rate limit na trasach AI
- [ ] **Rate limiting na Upstash/Redis** (jedna integracja na Vercelu)
- [ ] **Domknięcie migracji `forSalon`** dla pozostałych 98 tras (mechanicznie, paczkami jak w git „R2")

### Faza 2 — Uproszczenie produktu (równolegle z Fazą 1)

**Spec wykonawcza (2026-07-03):** migracja `salons.enabled_modules jsonb` (default = lean core;
brak wpisu = mo

Nie kasować kodu — **feature flags per salon** + domyślnie chudy interfejs:

**Widoczne od 1. dnia (Basic):** kalendarz + grafiki · rezerwacje + portal klienta · kartoteka
klientów · usługi/cennik · zadatki · przypomnienia SMS/push · opinie + galeria · **3 raporty**
(przychód, popularność usług, pracownicy).

**Domyślnie wyłączone (do włączenia w ustawieniach):** magazyn, promocje/happy-hours/pakiety,
lojalność, lista oczekujących, newslettery, faktury, pozostałe 10 raportów.

**Wyłączone całkiem flagą (na później):** asystent głosowy (Twilio), generowanie video (Veo),
fiskalizacja, publikacja postów social.

**Wyróżnik Pro:** asystent biznesowy AI + generator treści tekstowych i obrazów (z limitami).

### Faza 3 — Po pierwszych klientach

- [ ] Role `employee`/`receptionist` (dziś API jest owner-only; spec deklaruje 4 role, działają 2)
- [ ] Refaktoryzacja god files AI (wydzielenie logiki do `src/lib/ai/`)
- [ ] Wrapper `withApiHandler()` dla 182 tras
- [ ] Decyzja o fiskalizacji (integracja z drukarkami = osobny projekt)
- [ ] Środowisko: projekt na dysk WSL (ext4) / spójna platforma; pełny suite w CI

---

## 6. Pozycjonowanie vs Booksy

Booksy w Polsce: ~200–300 PLN/mies. + opłaty Boost (prowizja od nowych klientów).
MyHelper: Basic 49 PLN / Pro 149 PLN — przewaga cenowa jest realna.

**Argumenty komunikacyjne:**
- **„Twoi klienci są Twoi"** — w Booksy klient należy do marketplace'u; tu salon ma własną bazę, zgody RODO i kanał komunikacji
- **Zadatki bez prowizji od rezerwacji** — tylko standardowa opłata Stripe
- **Asystent biznesowy AI (Pro)** — realny wyróżnik funkcjonalny, którego Booksy nie ma
- Uczciwie: Booksy daje ruch z marketplace'u — MyHelper nie. Grupa docelowa na start:
  salony z własną bazą klientek, którym Booksy jest „za drogie i za dużo"

**Ryzyko cenowe:** przy 149 PLN za Pro limity AI muszą być częścią cennika (pula kredytów
miesięcznie) — inaczej marża może być ujemna. Dlatego limity z Fazy 1 są warunkiem uruchomienia Pro.

---

*Raport przygotowany na podstawie: weryfikacji 182 endpointów API, ręcznej próbki 15 tras CRUD,
przebiegu `pnpm typecheck` / `eslint` / `vitest` (926 testów), `pnpm audit --prod`, analizy
schematu (46 tabel) i migracji, oraz mapy funkcjonalności z kodu i `app_spec.txt`.*
