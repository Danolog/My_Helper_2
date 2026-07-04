# Zadania właściciela — uruchomienie maili, SMS-ów i infrastruktury produkcyjnej

Stan na 2026-07-04. Kod po stronie aplikacji jest gotowy — poniższe kroki to wyłącznie
konta, klucze i zmienne środowiskowe, których nie da się zrobić z poziomu kodu.
Zmienne środowiskowe ustawiaj w Vercel: Project → Settings → Environment Variables
(środowisko Production; do testów możesz też Preview).

## 1. E-maile — Resend (PRIORYTET: bez tego nie działa weryfikacja konta i reset hasła)

1. Załóż konto na https://resend.com (darmowy plan: 100 maili/dzień, 3000/mies.).
2. Dodaj i zweryfikuj swoją domenę (Resend → Domains → Add Domain).
   Resend pokaże rekordy DNS (SPF + DKIM + opcjonalnie DMARC) — dodaj je u swojego
   rejestratora domeny i poczekaj na weryfikację (zwykle do 1h).
3. Utwórz API key (Resend → API Keys → Create API Key, uprawnienie "Sending access").
4. Ustaw w Vercel:
   - `RESEND_API_KEY` = `re_...`
   - `EMAIL_FROM` = `MyHelper <no-reply@twojadomena.pl>` (adres w zweryfikowanej domenie)
5. Redeploy aplikacji.

**Co się stanie po włączeniu:** rejestracja zacznie WYMAGAĆ potwierdzenia maila
(tak jak w spec) — bez klucza wymóg jest wyłączony, żeby nie zablokować logowania.
Istniejące niezweryfikowane konta dostaną link weryfikacyjny przy najbliższej próbie
logowania. Zaczną też realnie wychodzić: reset hasła, newslettery i faktury mailem.

**Test:** zarejestruj konto na własny adres → mail z linkiem powinien dojść;
"zapomniałem hasła" → mail z linkiem resetu.

## 2. SMS-y — SMSAPI.pl (potwierdzenia i przypomnienia wizyt)

1. Załóż konto firmowe na https://www.smsapi.pl i doładuj punkty (SMS ~7-9 gr).
2. Zarejestruj pole nadawcy (np. "MyHelper" albo nazwa salonu):
   SMSAPI → Ustawienia → Pola nadawcy → Dodaj. Akceptacja trwa zwykle 1 dzień roboczy.
3. Wygeneruj token OAuth: SMSAPI → API → Tokeny (uprawnienie wysyłki SMS).
4. Ustaw w Vercel:
   - `SMSAPI_TOKEN` = token
   - `SMSAPI_SENDER` = zaakceptowana nazwa nadawcy (bez tego pójdzie z "Info")

Bez tokena SMS-y są tylko symulowane (log + wpis w bazie), nic nie wychodzi.

## 3. Harmonogram cronów — CRON_SECRET (przypomnienia w ogóle nie działały w prod)

`vercel.json` ma teraz wpisy `crons` (przypomnienia SMS/push, czyszczenie zadatków).
1. Wygeneruj losowy sekret (min. 32 znaki), np. `openssl rand -hex 32`.
2. Ustaw w Vercel: `CRON_SECRET` = wygenerowana wartość.
   Vercel automatycznie doda nagłówek `Authorization: Bearer CRON_SECRET` do wywołań.
3. Uwaga: 6 cronów z krokiem co 15 min wymaga planu Vercel Pro
   (na Hobby crony mogą być tylko dzienne — wtedy przypomnienia nie zadziałają o czasie).

## 4. Galeria zdjęć — Vercel Blob (upload był zepsuty w prod, kod naprawiony)

1. Vercel → Storage → Create → Blob → podłącz do projektu.
2. Vercel sam doda `BLOB_READ_WRITE_TOKEN`. Zweryfikuj, że jest w Production, i redeploy.

**Test:** dashboard → Galeria → wgraj zdjęcie → odśwież stronę → zdjęcie ma być widoczne.

## 5. Baza danych — Neon (przy przejściu na produkcyjną bazę)

- Jako `POSTGRES_URL` w runtime ustaw **pooled** connection string
  (host z `-pooler`) — kod jest już przygotowany (`prepare: false`).
- Do migracji (`pnpm db:migrate`) używaj **direct** connection string.
- Opcjonalnie: `DB_POOL_MAX` (domyślnie 5 połączeń na instancję).
- **Przed wdrożeniem migracji 0007**: jeśli w produkcyjnej bazie są zduplikowane
  `stripe_payment_intent_id` w `subscription_payments` (z powtórek webhooków),
  usuń duplikaty — inaczej CREATE UNIQUE INDEX się nie powiedzie:
  ```sql
  DELETE FROM subscription_payments a USING subscription_payments b
  WHERE a.id > b.id AND a.stripe_payment_intent_id = b.stripe_payment_intent_id
    AND a.stripe_payment_intent_id IS NOT NULL;
  ```

## 6. Rate limiting rozproszony — Upstash Redis (zalecane przy realnym ruchu)

Limiter działa bez tego (in-memory per instancja), ale na serverless jest wtedy
łatwy do obejścia. Docelowo:
1. Vercel → Marketplace → Upstash Redis (albo konto na upstash.com).
2. Ustaw: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
Kod sam zacznie używać Redisa (`checkAsync`).

## 7. Push (jeśli jeszcze nie ustawione) — klucze VAPID

```bash
npx web-push generate-vapid-keys
```
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` = `mailto:kontakt@twojadomena.pl`

## 8. Sprawdzenie po wszystkim (checklist)

- [ ] Rejestracja: mail weryfikacyjny dochodzi, konto wymaga potwierdzenia
- [ ] Reset hasła: mail z linkiem dochodzi
- [ ] Rezerwacja bez zadatku: SMS potwierdzenia dochodzi
- [ ] Rezerwacja z zadatkiem: płatność Stripe + SMS po opłaceniu
- [ ] Przypomnienie 1h przed wizytą (SMS/push) — po ~1 dniu działania cronów
- [ ] Galeria: upload i wyświetlanie zdjęć
- [ ] Newsletter do klientów ze zgodą marketingową dochodzi
- [ ] Faktura mailem dochodzi
