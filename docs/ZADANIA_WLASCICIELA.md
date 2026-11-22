# Zadania właściciela — maile, SMS-y i usługi zewnętrzne na produkcji (GCP)

Stan na 2026-11-22. Produkcja działa docelowo na GCP: Cloud Run i Cloud SQL w regionie
Warszawa. Kod jest gotowy. Niżej są tylko konta, klucze i ustawienia, których nie da się
zrobić w kodzie.

## 0. Gdzie wpisujesz klucze i ustawienia

- **Sekrety** (klucze API, tokeny) trafiają do Secret Manager w projekcie GCP.
- **Zwykłe ustawienia** (np. nazwa nadawcy) trafiają do zmiennych środowiska
  `production-gcp` w GitHubie: repozytorium → Settings → Environments →
  `production-gcp` → Variables.
- Co jest sekretem, a co zwykłą zmienną, mówi `infra/gcp/env-manifest.json`
  (pole `class`; nazwa sekretu w polu `secretName`). To jedyne źródło prawdy.
- Wartości nigdy nie trafiają do repo ani do zgłoszeń.

**Nowa wersja sekretu — przez schowek, we własnym terminalu:**

1. Wyłącz menedżer schowka i Handoff (Universal Clipboard).
2. Skopiuj samą wartość z panelu dostawcy. Polecenie samo usuwa enter na końcu.
   Spacji nie usuwa — kopiuj bez spacji na początku i na końcu.
3. W poleceniu podmień oba znaczniki, razem z nawiasami `< >`:
   `<projekt GCP>` na nazwę projektu, `<nazwa>` na nazwę sekretu z manifestu
   (np. `smsapi-token`). Bez podmiany zsh potraktuje `<nazwa>` jako odczyt z pliku.
4. Uruchom:

   ```bash
   set +x; set -o pipefail
   P='<projekt GCP>'
   add() { local v; v="$(tr -d '\r\n')"; [ -n "$v" ] || { echo "error: empty value for $1 — gcloud not called" >&2; return 1; }; printf '%s' "$v" | CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project=$P secrets versions add "$1" --data-file=-; }
   pbpaste | add <nazwa>; pbcopy </dev/null
   ```

   To ta sama funkcja `add` co w `docs/runbook-krok-d.md`, sekcja 5. Usuwa enter
   na końcu, a przy pustym schowku nie wywołuje gcloud. Ostatnie polecenie czyści schowek.
5. Sprawdź, czy wersja powstała:

   ```bash
   gcloud --project='<projekt GCP>' secrets versions list <nazwa> --sort-by=~createTime --limit=1 --format='value(name,state)'
   ```

   Ma być nowy numer wersji i `ENABLED`.
6. Nigdy `echo … |` — wartość trafiłaby do historii powłoki.

**Po każdej zmianie** sekretu albo zmiennej potrzebne jest nowe wdrożenie, bez migracji
(`docs/runbook-krok-d.md`, sekcja 7). Wdrożenie podpina tylko te sekrety, które mają wersję.
Wdrożenia nie uruchamiasz sam. Uruchamia je zespół za Twoją zgodą, a Ty je zatwierdzasz
w GitHubie jako wymagany recenzent środowiska `production-gcp`.

## 1. E-maile — Resend (PRIORYTET: bez tego nie działa weryfikacja konta i reset hasła)

1. Załóż konto w Resend (darmowy plan: 100 maili/dzień, 3000/mies.).
2. Dodaj domenę nadawcy: Resend → Domains → Add Domain.
3. Resend pokaże rekordy DNS: DKIM i SPF (oraz DMARC, jeśli Resend go wymaga).
   Dodaj je w Cloudflare jako **DNS only** (bez proxy Cloudflare).
   Wartości przepisz z panelu Resend. Nie zapisuj ich w repo.
   Weryfikacja trwa zwykle do 1 h.
4. Utwórz API key: Resend → API Keys → Create API Key, uprawnienie „Sending access”.
5. Dodaj klucz jako sekret `resend-api-key` (sekcja 0).
6. Ustaw zmienną `EMAIL_FROM` w `production-gcp`:
   `MyHelper <adres w zweryfikowanej domenie>`.
   Bez tej zmiennej maile idą z testowego nadawcy Resend. Taki nadawca dostarcza
   pocztę tylko na adres, na który założono konto Resend.
7. Nowe wdrożenie (zatwierdzasz je, sekcja 0).

**Co się stanie po włączeniu:** rejestracja zacznie WYMAGAĆ potwierdzenia maila
(tak jak w spec). Bez klucza wymóg jest wyłączony, żeby nie zablokować logowania.
Mail wtedy nie wychodzi; w logu jest tylko wpis, bez linku. Niezweryfikowane konta dostaną link weryfikacyjny
przy najbliższej próbie logowania. Zacznie też realnie wychodzić reset hasła.
Newslettery i faktury mailem są zamrożone (plan, zadanie 2.4).

**Test:** zarejestruj konto na własny adres, inny niż adres konta Resend → mail z linkiem
powinien dojść; „zapomniałem hasła” → mail z linkiem resetu. Gdy mail dochodzi tylko
na adres konta Resend, `EMAIL_FROM` nie jest ustawiona.

## 2. SMS-y — SMSAPI.pl (potwierdzenia i przypomnienia wizyt)

1. Załóż konto firmowe w SMSAPI i doładuj punkty (SMS ~7-9 gr).
2. Zarejestruj pole nadawcy (np. „MyHelper” albo nazwa salonu):
   SMSAPI → Ustawienia → Pola nadawcy → Dodaj. Akceptacja trwa zwykle 1 dzień roboczy.
3. Wygeneruj token OAuth: SMSAPI → API → Tokeny (uprawnienie wysyłki SMS).
4. Dodaj token jako sekret `smsapi-token` (sekcja 0).
5. Ustaw zmienną `SMSAPI_SENDER` w `production-gcp` = zaakceptowana nazwa nadawcy
   (bez niej SMS pójdzie z „Info”).
6. Nowe wdrożenie (zatwierdzasz je, sekcja 0).

Bez tokena SMS na produkcji nie wychodzi: jest błąd w logu i brak wpisu w historii
powiadomień. Symulacja działa tylko poza produkcją.

**Test przed włączeniem przypomnień:** warunek w `docs/runbook-krok-d.md`, linie 722–734
(przed włączeniem zadania `mh-sms-reminders`). Brak SMS-a w teście = przypomnień nie włączać.

## 3. Przypomnienia i zadania cykliczne — Cloud Scheduler

Na GCP zadania cykliczne uruchamia tylko Cloud Scheduler w projekcie GCP.

Zadań jest 5 (tabela w `infra/gcp/scheduler.sh`):
- `mh-sms-reminders` — przypomnienia SMS, co 5 min;
- `mh-cleanup-pending-deposits` — porządki w zadatkach, co 15 min;
- `mh-cleanup-temporary-access` — porządki w dostępach tymczasowych, co godzinę;
- `mh-push-reminders` i `mh-push-reminders-24h` — stoją, dopóki powiadomienia push
  są wyłączone w kodzie.

Wszystkie zadania powstają wstrzymane. **Włączenie = prawdziwe SMS-y do klientów salonów.
To Twoja decyzja.** Procedura: `docs/runbook-krok-d.md`, sekcja 8.

`CRON_SECRET` (sekret `cron-secret`) jest losowany w procedurze z `docs/runbook-krok-d.md`,
sekcja 5. Nie kopiujesz go nigdzie ręcznie — skrypt harmonogramu sam dokłada go do zadań.

**Dzienne powiadomienia** (urodziny, niski stan magazynu, „tęsknimy”) nie mają zadań
w harmonogramie. Dzisiejsze trasy działają na jeden salon, więc z harmonogramu nic
by nie zrobiły. Wrócą później razem z trasą dla wszystkich salonów.

## 4. Galeria zdjęć — Cloud Storage

Zdjęcia trafiają do zasobnika Cloud Storage w projekcie GCP. Zmienne `STORAGE_DRIVER`
i `GCS_BUCKET` są ustawiane przy pierwszym wdrożeniu (`docs/runbook-krok-d.md`, sekcja 6).
Starych plików z Vercela nie przenosimy (były tylko konta testowe).
Po Twojej stronie jest tylko test.

**Test:** dashboard → Galeria → wgraj zdjęcie → odśwież stronę → zdjęcie ma być widoczne.

## 5. Baza danych — Cloud SQL

- Baza produkcyjna to Cloud SQL w projekcie GCP. Startuje pusta, tylko ze schematem
  z migracji. Danych z Neona nie przenosimy — każdy zakłada konto od nowa.
- `POSTGRES_URL` (sekret `postgres-url`) ustawia procedura tworzenia bazy
  (`docs/runbook-krok-d.md`, sekcja 3.6). Nie zmieniaj go ręcznie.
- Migracje idą tylko przez workflow wdrożenia z `run_migrations=true` albo przez zespół
  według runbooka (`docs/runbook-krok-d.md`, sekcja 7). Nigdy ręcznie.
- `DB_POOL_MAX` = 4 (mała instancja bazy ma mało połączeń). Ustawia go pierwsze
  wdrożenie (`docs/runbook-krok-d.md`, sekcja 6), nie Ty.
- Neona nie kasujemy, nie kopiujemy i nie zmieniamy do zadania 0.13 planu
  (po tygodniu stabilnej pracy na GCP i udanym odtworzeniu kopii). Skasować go możesz tylko Ty.

## 6. Rate limiting rozproszony — Upstash Redis (zalecane przy realnym ruchu)

Limiter działa bez tego (w pamięci każdej instancji), ale przy kilku instancjach
Cloud Run łatwo go obejść. Docelowo:
1. Załóż bazę Redis w Upstash.
2. Dodaj token jako sekret `upstash-redis-rest-token` (sekcja 0).
3. Ustaw zmienną `UPSTASH_REDIS_REST_URL` w `production-gcp`.
4. Nowe wdrożenie (zatwierdzasz je, sekcja 0). Kod sam zacznie używać Redisa (`checkAsync`).

## 7. Push — klucze VAPID

Parę kluczy generuje procedura z `docs/runbook-krok-d.md`, sekcja 5. Klucz prywatny
trafia do sekretu `vapid-private-key`, publiczny do zmiennej `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
Nie generuj pary ręcznie — obie połówki muszą do siebie pasować.

- `VAPID_SUBJECT` (zmienna) = `mailto:` + adres kontaktowy.
- Powiadomienia push są dziś wyłączone w kodzie, a ich zadania w harmonogramie stoją.

## 8. Czego nie ustawiasz

- **Stripe:** nie dotyczy (Stripe nieużywany na produkcji; wraca z 1.1 planu, jeśli
  subskrypcja pójdzie przez Stripe). Sekrety `stripe-secret-key` i `stripe-webhook-secret`
  zostają puste. Żadnemu nie dodawaj wersji. Jeśli kiedyś, to obu naraz — jeden bez
  drugiego zatrzymuje wdrożenie.
- **Zadatki:** decyzja jest taka: bez płatności online, klient płaci BLIK-iem na telefon
  właściciela salonu, a salon oznacza zadatek ręcznie (plan, decyzja D1). Przełączenie
  w kodzie nie jest jeszcze włączone — to zadanie 1.2 planu, w kroku „Pieniądze i prawda”,
  po przenosinach na GCP. Do tego czasu portal rezerwacji wybiera ścieżkę płatności online.
  Nic tu nie ustawiasz.
- **Logowanie Google:** wyłączone na betę. Bez `GOOGLE_CLIENT_ID` i bez wersji sekretu
  `google-client-secret`. Logowanie tylko e-mailem i hasłem. Przycisk Google na razie
  zostaje widoczny i po kliknięciu pokazuje błąd. To znane, nie zgłaszaj tego jako awarii.
  Ukrycie przycisku to osobna zmiana w kodzie, przed oknem przełączenia.
- **Vercel:** zmienne, Blob i crony Vercela nie są częścią produkcji na GCP.

## 9. Sprawdzenie po wszystkim (checklist)

- [ ] Rejestracja: mail weryfikacyjny dochodzi, konto wymaga potwierdzenia
- [ ] Reset hasła: mail z linkiem dochodzi
- [ ] Rezerwacja bez zadatku: SMS potwierdzenia dochodzi (test z sekcji 2)
- [ ] Rezerwacja z zadatkiem: salon oznacza zadatek ręcznie w panelu — dopiero gdy
      przełączenie na BLIK (zadanie 1.2 planu) będzie włączone w kodzie
- [ ] Przypomnienie SMS przed wizytą — po włączeniu `mh-sms-reminders`; pierwszy przebieg
      z wizytami bez błędów (`docs/runbook-krok-d.md`, linie 722–734, pkt 2)
- [ ] Galeria: upload i wyświetlanie zdjęć
- [ ] Newsletter i faktura mailem — dopiero po odmrożeniu tych modułów
