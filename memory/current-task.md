# Bieżące zadanie
**Cel:** Naprawa wszystkich braków z audytu + wydajność + skalowalność (user dał pełną autonomię: "Zdecyduj sam")
**Rozpoczęto:** 2026-07-03 (audyt), naprawy 2026-07-04
**Status:** ZAKOŃCZONE (kod) — gałąź fix/audyt-funkcjonalny-2026-07 (z origin/main), 11 commitów, testy 1133 zielone, typecheck/lint czyste. Push ZABLOKOWANY uprawnieniami — czeka na push/PR przez użytkownika (E2E pobiegnie w CI). Lista zadań właściciela: docs/ZADANIA_WLASCICIELA.md

## Postęp napraw (commity na fix/audyt-funkcjonalny-2026-07)
- [x] email: src/lib/email.ts (Resend REST, symulacja bez klucza) + auth verify/reset + newsletter + faktury + env + testy
- [x] AI nav: hub AI z kafelkami content-generator/rekomendacje/usage, filtrowanie hardOff, ModuleGate testimonials
- [x] SMS potwierdzenia rezerwacji bez zadatku (appointments POST, best-effort)
- [x] sidebar: Opinie/Płatności/Rozliczenia/Lista oczekujących (mobile przez sheet Więcej)
- [x] galeria: upload przez lib/storage (Blob) — był zapis na efemeryczny dysk = 404 w prod
- [x] martwy kod: ServiceIllustrationButton usunięty (brak kolumny na obrazek w services — wire-in wymagałby schematu); relikty BLIK P2P ZOSTAWIONE świadomie (czysty stan wewnętrzny, nie ruszać krytycznego flow dla refactoru — P3)
- [x] db.ts: prepare:false + DB_POOL_MAX (Neon pooler/serverless)
- [x] crony: flagi sentAt PRZED wysyłką + maxDuration=300 + LIMIT 200 + vercel.json crons (BYŁ CAŁKIEM BRAK harmonogramu — crony w prod nie działały!)
- [x] perf: lazy jsPDF, hoist isProPlan, N+1 waiting-list, capy na listach (appointments 2000/clients 2000/reviews 1000/client-appointments 500)
- [x] rate limit available-slots (checkAsync); salons GET zostawiony na ISR (limiter zabiłby cache); UNIQUE stripe_payment_intent_id + onConflictDoNothing (migracja drizzle/0007); indeks notifications(salonId,createdAt)
- [x] docs/ZADANIA_WLASCICIELA.md (Resend/SMSAPI/CRON_SECRET/Blob/Neon+dedup przed 0007/Upstash/VAPID)

## Niewdrożone rekomendacje (kolejna iteracja, wg wartości)
1. SSR/ISR publicznych stron salonów (SEO/LCP) — refactor 2 stron klienckich
2. Session: cookieCache + updateAge>0 (dziś zapis sesji na KAŻDY request) — zmienia semantykę 15-min idle, dotyka E2E
3. Raporty: domyślny/maks. zakres dat + agregacja w SQL zamiast .reduce() w JS
4. Newsletter: chunking/kolejka (QStash) dla dużych baz odbiorców
5. birthday: LIKE '%MM-DD' omija indeks — kolumny (month,day) lub indeks wyrażeniowy
6. time-grid: memoizacja map eventsByEmployee (O(n) per komórka)
7. Kalendarz: waterfall salons/mine → salonId server-side
8. Paginacja cursor + UI dla list (capy to tylko bezpiecznik)

## Raporty agentów (kluczowe, pełne w rozmowie)
- Wydajność: TOP = jsPDF statycznie w 13 raportach; isProPlan w pętli per-klient; N+1 client/waiting-list; listy bez LIMIT (appointments/clients GET); publiczne strony salonów CSR zamiast SSR; time-grid bez memo; indeks notifications; birthday LIKE '%..' omija indeks. N+1 w cronach i indeksy z audytu marcowego JUŻ naprawione.
- Skalowalność: R1 db.ts bez prepare:false/max (bloker Neon pooler); R2 crony sekwencyjne + flagi po pętli = duplikaty SMS; R3 brak rate-limit na publicznych + limiter tylko in-memory (checkAsync/Upstash nieużyty); R4 ~5-6 roundtripów/request (updateAge:0, brak cookieCache); R5 raporty/eksporty bez zakresu dat; R6 galeria (NAPRAWIONE); R7 webhook Stripe bez dedup (subscriptionPayments duplikaty przy retry); R8 newsletter bez chunków. vercel.json BEZ crons!

> Poprzednie zadanie (RLS/R2/R3) — kod ZROBIONY; zostały akcje człowieka: merge PR #10, sekrety Neon (#8 staging), sign-off Darka (#9 prod rollout).

## Wyniki audytu (2026-07-03)

### Zgłoszone bugi — potwierdzone
1. **Rejestracja bez weryfikacji maila**: `src/lib/auth.ts:51` `requireEmailVerification: false` + brak jakiegokolwiek providera email w repo (zero nodemailer/resend/sendgrid). UI kłamie: "Wysłaliśmy email weryfikacyjny" (`sign-up-form.tsx:112-115`, `StepConfirmation.tsx:45-49`). Spec wymaga weryfikacji (`app_spec.txt:115,191`).
2. **Zakładka AI**: hub `src/app/dashboard/ai-assistant/page.tsx:8-72` ma 4 kafelki (voice/business/trends/chat), **brak linku do `/dashboard/content-generator`** — generator treści osierocony (dostęp tylko Ctrl+K). Kafelek voice linkuje bezwarunkowo mimo hardOff `voiceAi` → ślepy ekran "Wkrótce".

### Krytyczne braki systemowe
3. **Brak transportu email w całej apce** — dotyka: weryfikacji maila, resetu hasła (link tylko w logach — nie działa e2e), newslettera (`api/newsletters/[id]/send/route.ts:154-161` — stub), faktur mailem (`api/invoices/[id]/send-email/route.ts:150` — stub).
4. **Rezerwacja bez zadatku nie wysyła klientowi ŻADNEGO potwierdzenia** (`api/appointments/route.ts` — 0 wywołań sms/push). SMS działa tylko na ścieżce zadatku + crony przypomnień.
5. **Gating niespójny**: `content-generator/testimonials/page.tsx` bez ModuleGate mimo mapy na hardOff `videoGen` (`lib/features.ts:168`); huby ai-assistant i content-generator nie filtrują kafelków hardOff (ślepe zaułki "Wkrótce").
6. Newsletter `scheduleAt` przyjmowany i po cichu ignorowany (`send/route.ts:19,74`).
7. Mobile: brak nawigacyjnego dojścia do finance/payments/reviews/waiting-list/promo-codes (Cmd+K niedostępna na telefonie, bottom-nav renderuje tylko SidebarNav).
8. Martwy kod: `ServiceIllustrationButton` (nieużywany, route API żywy), kafelek "Opisy usług" bez href (`content-generator/page.tsx:42-48`), relikty BLIK P2P w booking (`use-booking-data.ts:58-60,550`).

### Co działa (zweryfikowane w kodzie)
- Flow rezerwacji klienta kompletny (usługa→wariant→pracownik→termin→potwierdzenie, gość+zalogowany).
- Zadatki: prawdziwy Stripe Checkout (card/blik/p24), kwota liczona serwerowo, webhook źródłem prawdy, auto-refund >24h, cron czyszczący. BLIK P2P świadomie usunięty (BLIK przez Stripe).
- Subskrypcje Basic/Pro + trial 14 dni + cancel — błąd K9 z audytu marcowego NAPRAWIONY (`subscriptions/cancel/route.ts:76-78`).
- SMS (SMSAPI, fallback symulacja) i push (web-push VAPID) realne.
- Magazyn/promocje/raporty/grafiki/kalendarz — wszystkie 88 endpointów wołanych z dashboardu istnieje, implementacje realne.
- Session timeout 15 min idle (`auth.ts:25-26`); Google OAuth okablowany (zależny od env).

## Plan napraw (propozycja — do decyzji)
- [ ] P0: provider email (np. Resend) + podpięcie verify/reset/newsletter/faktury
- [ ] P0: `requireEmailVerification: true` po wdrożeniu maili (do tego czasu: poprawić mylący komunikat UI)
- [ ] P0: link do content-generator w hubie AI + filtrowanie kafelków hardOff w hubach
- [ ] P1: potwierdzenie rezerwacji bez zadatku (SMS/push)
- [ ] P1: ModuleGate na testimonials / decyzja o ROUTE_MODULE_MAP
- [ ] P2: mobile nav (finance/payments/reviews/…), martwy kod, scheduleAt

## Notatki dla następnej sesji
- Źródło prawdy o zakresie: `docs/RAPORT_I_PLAN_NAPRAWY_2026-07.md` (unieważnia AUDIT_REPORT.md). hardOff: voice AI (Twilio), video gen (Veo), fiskalizacja, social publishing — asystent głosowy MA być niedostępny, więc jego kafelek w hubie to bug nawigacji, nie brak funkcji.
- Better Auth realnie 1.6.23 (nie 1.4.18 jak w CLAUDE.md).
