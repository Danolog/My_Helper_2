# Procedura — zatrzymanie zapisów i przełączenie ruchu

Osobna procedura, której wymaga `docs/runbook-przelaczenie-bazy.md` 1.0 pkt 1.
Odwołują się do niej: 1.3 pkt 1, 2.1, 2.9, wycofanie (droga A pkt 3, droga B),
3.3 krok 1 (do przepisania razem z sekcją 6), krok 2 („stop”), krok 10
i „Stop w kroku 7 albo 8”. **Bez
odpowiedzi na fakty F1–F8 z sekcji 0 i bez wyników kroków „do potwierdzenia
w próbie” w `docs/drills/` nie startuje okno.**

Zasady jak w `docs/runbook-przelaczenie-bazy.md` sekcja 0: uruchamia wyłącznie
właściciel, we własnym terminalu; bloki bez linii komentarza, od `set +x`;
w repo tylko symbole zastępcze w `<…>`; do notatki okna wolno zapisać tylko
wartości z wyjątku w sekcji 0 runbooka przełączenia (host `<domena Vercel
Production>`, adresy `*.vercel.app`, `<LB_IP>`), nigdy w repo ani
w zgłoszeniach; polecenie oznaczone „(do potwierdzenia
w próbie)” ma wynik zapisany w `docs/drills/` przed oknem, a polecenie z innym
wynikiem w próbie poprawia się tu przed oknem. Kolumna „Zgoda” wskazuje wiersz
tabeli 1.2 runbooka przełączenia; zgoda jest zapisana w notatce okna przed
krokiem.

Symbole: `<projekt GCP>` jak w runbooku przełączenia (1.6); `<adres run.app
usługi>` = główny adres usługi `myhelper` z `docs/runbook-krok-d.md` sekcja 8
(bez ścieżki); `<LB_IP>` = adres `myhelper-lb-ip` (sekcja 10a); `<sha okna>` =
sha z 1.7; `<domena Vercel Production>` = domena projektu Vercel z F1 (host
tylko w notatce okna); `<adres starszego wdrożenia>` i `<adres wdrożenia
Preview>` = wygenerowane adresy `*.vercel.app` wybrane z panelu Vercela (tylko
w notatce okna).

## 0. Dwie domeny, decyzje i fakty do odczytu

**Założenie procedury: zmiana domeny, nie zmiana rekordu DNS.** Rekord `app`
(`app.nordsignal.cc`) nie istnieje dziś w Cloudflare. Vercel Production działa
pod `<domena Vercel Production>`, której repo nie zna (testy produkcyjne
Vercela biorą ją z sekretu, `.github/workflows/e2e-production.yml:7-8`, `:29`).
Komentarz w `.github/workflows/deploy-cloud-run.yml:216-218` („domena
aplikacji wskazuje Vercela”) jest nieaktualny. GCP startuje pod nową domeną
`app.nordsignal.cc`; `<domena Vercel Production>` po oknie przekierowuje na nią
(krok K1).

Skutki:

- nie ma obniżania TTL ani zapisu starego rekordu — P7 sprawdza brak rekordu;
- użytkownicy, linki w e-mailach i SMS-ach, zakładki i zainstalowane PWA
  wskazują `<domena Vercel Production>` — bez K1 nikt nie trafi na GCP;
- sesje nie przechodzą (kopia pomija `session`, `copy-neon-to-cloudsql.sh:11-18`,
  a ciasteczka są przypisane do domeny): po przełączeniu każdy loguje się od
  nowa. Zapowiedź do salonów według F8;
- `BETTER_AUTH_URL` i `NEXT_PUBLIC_APP_URL` na Vercelu zostają bez zmian (po K1
  kod Vercela nie obsługuje ruchu); na GCP obie = `https://app.nordsignal.cc`,
  ustawione i wdrożone przed oknem (P4, P5). W oknie przebieg wdrożenia GCP jest
  niemożliwy: smoke idzie na adres taga `run.app`
  (`deploy-cloud-run.yml:193-203`), który ingress `internal` blokuje.

### 0.1 Decyzje

| | Decyzja | Kroki |
|---|---|---|
| L1 | Zatrzymanie zapisów Vercela = reguła zapory Vercela (Firewall → Custom Rules) na poziomie projektu: `Deny` dla wszystkich żądań (każda ścieżka, każda metoda), bez wyjątków. Tworzona przed oknem jako wyłączona; w oknie włączana i publikowana; cofnięcie = wyłączenie. Bez kodu i bez wdrożenia. Blokuje też `GET`, bo `GET` odświeża sesję. Zmienna środowiskowa odpada (wymaga wdrożenia w oknie). Jeśli plan Vercela nie daje reguł własnych z `Deny` (F2 = nie): stop, nowa decyzja przed próbą (wariant zapasowy: tryb utrzymania w aplikacji, osobny PR w pełnym procesie) | W1, R1, K1.2 |
| L2 | Crony Vercela: Settings → Cron Jobs → „Disable Cron Jobs” (oba crony, `vercel.json:9-12`); cofnięcie = „Enable”. Okno poza 02:00–03:30 UTC. Po udanym oknie crony Vercela zostają wyłączone na stałe (pracę przejmuje Cloud Scheduler); usunięcie ich z `vercel.json` — osobny krok porządkowy po oknie | W3, R3 |
| L3 | Przed oknem, na stałe: Deployment Protection = „Standard Protection” (Vercel Authentication — blokuje Preview i wygenerowane adresy starszych wdrożeń Production, domena produkcyjna działa dalej) oraz usunięcie `POSTGRES_URL` z zakresu Preview. Preview nie dostaje go z powrotem (nowe Preview nie powstają, `vercel.json:3-7`; gdy wrócą — osobna gałąź Neona). Istniejących wdrożeń Preview nie usuwa się. W oknie W2 = odczyt stanu | P11, W2, R2 |
| L4 | Zmiana domeny (wyżej). Rekord `A app` → `<LB_IP>`, **DNS only** (bez proxy Cloudflare — `TRUSTED_PROXIES` ustawiony z pomiaru adresów LB, `env.example:70-81`), TTL 60 s. Droga B = usunięcie rekordu. Przekierowanie starej domeny = K1 po 2.10 z kodem 0 albo po drodze C (sekcja 3, K1) | P7, T4–T6, B1–B3, K1 |
| L5 | Google OAuth: według F5/F6. Jeśli logowanie Google działa na Vercelu — przed oknem **dopisać** (nie podmieniać) adres przekierowania i origin `app.nordsignal.cc` do tego samego klienta OAuth; wersja `google-client-secret` i `GOOGLE_CLIENT_ID` w `production-gcp` przed przebiegiem z P5. Jeśli nie działa — GCP startuje bez Google, P8 = „nie dotyczy”, a przed P10 osobne sprawdzenie w kodzie, że przycisk Google nie pokazuje się bez `GOOGLE_CLIENT_ID`. Logowania Google na GCP nie testuje się przed oknem (zapis do pustego Cloud SQL rozbiłby `--expect-empty`) — pierwsza próba po 2.10 | P8, P12 |
| L6 | Stripe: jeden endpoint; w oknie zmiana jego adresu (T8), bez nowego endpointu i bez rotacji sekretu — **nie używać „Roll secret”**. Przed oknem sekret podpisu tego endpointu jako wersja `stripe-webhook-secret` (zgodność skrótem, P9). Cofnięcie (B3, droga B) przywraca stary adres. Jeśli F7 = brak endpointu live (zadatki Stripe wyłączone): L6, P9 i T8 = „nie dotyczy”, zapis w notatce | P9, T8, B3 |
| L7 | Zakaz scaleń do `main` trwa od W0 do jednego z czterech zdarzeń: 2.10 z kodem 0, potwierdzenie drogi C odczytem `off`, koniec drogi A albo koniec drogi B. Ogłaszają go w kanale zespołu przed W0 osoby scalające do `main`. Ustawienia GitHuba bez zmian. Wyjątek: K1, scalany po zakazie (po 2.10 z kodem 0 albo po drodze C według sekcji 3, K1). Kontrola: W4 | W4, T3 |
| L8 | Zakres próby generalnej na produkcji — sekcja 0.3 | — |
| L9 | Wiersze tabeli 1.2 runbooka przełączenia dla kroków tej procedury — dopisane | kolumny „Zgoda” |

### 0.2 Fakty do odczytu przez właściciela (przed P10)

Odpowiedź tylko do notatki okna — bez wartości w repo i w zgłoszeniach.

| | Co | Gdzie | Postać odpowiedzi | Skutek |
|---|---|---|---|---|
| F1 | domena Production projektu i inne domeny | Vercel → projekt → Settings → Domains | host = `<domena Vercel Production>`; lista innych domen albo „brak” | każda inna domena dostaje to samo przekierowanie w K1 |
| F2 | reguła własna z akcją `Deny` | Vercel → projekt → Firewall | tak/nie; limit reguł | „nie” = L1 do nowej decyzji, okno nie startuje |
| F3 | przełącznik „Disable Cron Jobs” | Vercel → Settings → Cron Jobs | tak/nie | „nie” = L2 do nowej decyzji |
| F4 | obecne ustawienie ochrony wdrożeń | Vercel → Settings → Deployment Protection | nazwa ustawienia | wejście do P11 |
| F5 | zakresy `POSTGRES_URL`; `GOOGLE_CLIENT_ID` w Production | Vercel → Settings → Environment Variables | lista zakresów (Production / Preview / Development); tak/nie | wejście do P11 i L5 |
| F6 | adresy przekierowań i originy klienta OAuth z F5 | konsola Google → Credentials → klient OAuth | lista hostów (bez identyfikatora klienta) | wejście do P8 (L5) |
| F7 | endpointy webhooka Stripe live | Stripe (live) → Developers → Webhooks | liczba endpointów; host każdego; włączony/wyłączony | więcej niż jeden albo host inny niż `<domena Vercel Production>` = L6 do nowej decyzji; brak = L6 „nie dotyczy” |
| F8 | salon z prawdziwymi danymi na `<domena Vercel Production>` | właściciel | tak/nie | „tak” = K1 obowiązkowy w tym samym oknie i zapowiedź „zaloguj się ponownie, nowy adres” do salonów przed oknem; „nie” = K1 i tak, bez zapowiedzi |

### 0.3 Próba generalna na produkcji (L8)

Godzina małego ruchu, poza 02:00–03:30 UTC; zgoda: wiersz 1.2 „próba
generalna na produkcji”; każdy wynik w `docs/drills/`.

| W próbie | Co sprawdza |
|---|---|
| W0, W4, P2–P5 | odczyty, składnia poleceń |
| W5 → T1 (ingress `internal` → `all`) | oba `curl` z W5; usługa nie ma użytkowników |
| W6 → R5 (pauza i wznowienie zadań Scheduler) | Cloud SQL pusty, zadania bez skutków |
| przełącznik cronów Vercela wyłącz → włącz | F3, ścieżka w panelu |
| reguła zapory jak w L1, zawężona warunkiem do hosta `<adres starszego wdrożenia>`; potem usunięta | czy zapora obejmuje adresy wdrożeń; kod odpowiedzi W1 |
| odczyt W2 | kod odpowiedzi przy ochronie wdrożeń |
| skrót sekretu Stripe (P9) | zgodność sekretu |
| zmiana adresu endpointu i ponowienie zdarzeń w **trybie testowym** Stripe | czy Stripe ponawia zdarzenia na zmieniony adres |
| W7 na gałęzi próbnej Neona (zasada 1.1) | składnia i zachowanie liczników |

**Pierwszy raz w oknie, bez wyniku w `docs/drills/` (decyzja wprost):**
włączenie reguły z L1 dla całego projektu (wyłączyłoby produkcję); T4–T6
(rekord `app` przed oknem wystawiłby GCP z pustą bazą; w próbie zastępuje je
P6 z `--resolve`); T8 na endpoincie live; K1; W7 na produkcyjnym Neonie;
logowanie Google na GCP (L5). Kontrolą zastępczą są W7 i P6.

**Do potwierdzenia w próbie** (nieznane zachowanie Vercela i Stripe): kod
odpowiedzi zapory (`403`) na domenie i na adresie wdrożenia; kod odpowiedzi
ochrony wdrożeń (`401` albo `403`); czy wywołanie crona przechodzi przez
zaporę (dlatego L2 jest osobnym krokiem); ponawianie zdarzeń Stripe na
zmieniony adres (inny wynik = zdarzenia z okna ponawia się ręcznie z panelu
Stripe); składnia `--format` w W0 i P3, P5; nagłówek `x-vercel-id` w T6.

## 1. Warunki przed oknem

Każdy wynik w notatce okna. Inny wynik = okno nie startuje. Zgoda na zmiany
przed oknem: wiersze 1.2 „przed oknem, poza repo, bez wpływu na ruch” (P8,
P9, P11, P12) i „przed oknem: zmienne środowiska `production-gcp` …” (P4, P5).

| # | Warunek | Polecenie | Oczekiwane |
|---|---|---|---|
| P1 | filtr logów i nagłówki `no-referrer` na rewizji GCP (`docs/runbook-krok-d.md` sekcja 10a „Logi LB”, 10b) | sprawdzenia z sekcji 10b („Sprawdzenie”, „Próba filtra”) | jak w 10b |
| P2 | certyfikat LB aktywny | `gcloud --project='<projekt GCP>' certificate-manager certificates describe myhelper-lb-cert --location=europe-central2 --format='value(managed.state)'` | `ACTIVE` |
| P3 | adres LB znany (do notatki, nie do repo) | `gcloud --project='<projekt GCP>' compute addresses describe myhelper-lb-ip --region=europe-central2 --format='value(address)'` (do potwierdzenia w próbie) | jeden adres IPv4 = `<LB_IP>` |
| P4 | adresy domeny na GCP | `gh variable get BETTER_AUTH_URL --env production-gcp` i `gh variable get NEXT_PUBLIC_APP_URL --env production-gcp`; przy L5 „Google działa” także `[[ -n "$(gh variable get GOOGLE_CLIENT_ID --env production-gcp)" ]] && echo google_client_id_set=yes \|\| echo google_client_id_set=no` (identyfikator nie trafia na ekran) | oba adresy `https://app.nordsignal.cc`; `google_client_id_set=yes` (L5) |
| P5 | rewizja zbudowana po ustawieniu P4 (i wersji `google-client-secret`, L5) | `gh variable list --env production-gcp --json name,updatedAt` oraz `gh run list --workflow=deploy-cloud-run.yml --limit=1 --json headSha,conclusion,createdAt`; przy L5 „Google działa” także `gcloud --project='<projekt GCP>' secrets versions list google-client-secret --limit=1 --format='value(name,createTime)'` (wszystkie do potwierdzenia w próbie) | ostatni przebieg `success`, `headSha` = `<sha okna>`, `createdAt` późniejsze niż `updatedAt` zmiennych z P4 i niż `createTime` wersji `google-client-secret` (L5); ruch nadal na Vercelu |
| P6 | LB odpowiada przed utworzeniem rekordu | `curl -s -o /dev/null -w '%{http_code}\n' --resolve "app.nordsignal.cc:443:<LB_IP>" "https://app.nordsignal.cc/api/health"` (przy ingress `all`, przed W5) | `200` |
| P7 | brak rekordu `app` | panel Cloudflare: brak rekordu `app` (A/AAAA/CNAME) do notatki; `dig +short NS nordsignal.cc`, potem `dig +short app.nordsignal.cc @<serwer NS strefy>`; `dig +short SOA nordsignal.cc` — ostatnie pole (minimum SOA) do notatki. Do T4 bez pytań o `app` do resolverów publicznych ani lokalnego (zapamiętałyby brak rekordu na czas minimum SOA, nie 60 s TTL) | pusty wynik z serwera autorytatywnego; minimum SOA w notatce |
| P8 | Google OAuth (L5) | konsola Google: klient OAuth z F6 | lista przekierowań zawiera `https://app.nordsignal.cc/api/auth/callback/google` obok dotychczasowego, originy zawierają `https://app.nordsignal.cc`; przy L5 „nie działa” — „nie dotyczy” |
| P9 | Stripe (L6) | panel Stripe live: endpoint z F7 ma adres `https://<domena Vercel Production>/api/stripe/webhook`. Zgodność sekretu: właściciel kopiuje sekret podpisu z panelu, potem `pbpaste \| shasum -a 256` i `CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project='<projekt GCP>' secrets versions access latest --secret=stripe-webhook-secret \| shasum -a 256`, na końcu `pbcopy </dev/null` (sekret nie zostaje w schowku) | adres na `<domena Vercel Production>` (na `app.nordsignal.cc` dopiero po T8); skróty równe — do notatki „równe tak/nie”, bez skrótów; przy F7 = brak — „nie dotyczy” |
| P10 | F1–F8 odczytane, wyniki „do potwierdzenia w próbie” w `docs/drills/` | — | brak decyzji otwartej (F2, F3, F7) |
| P11 | Preview i starsze wdrożenia zamknięte (L3) | panel Vercela: Deployment Protection = „Standard Protection”; Environment Variables: `POSTGRES_URL` bez zakresu Preview; `curl -s -o /dev/null -w '%{http_code}\n' "https://<adres wdrożenia Preview>/api/health"` | ustawienie i zakresy jak obok; `401` albo `403` (do potwierdzenia w próbie) |
| P12 | reguła zapory gotowa (L1) | panel Vercela → Firewall: reguła `Deny`, cały projekt, każda ścieżka i metoda | reguła istnieje, **wyłączona** |
| P13 | PR K1 gotowy | PR z przekierowaniem w `vercel.json` (sekcja 3, K1) zrecenzowany (1 recenzja — konfiguracja routingu), niescalony | recenzja zatwierdzona, PR otwarty |
| P14 | scalenie K1 nie wdraża GCP | `deploy-cloud-run.yml` w dniu okna ma tylko wyzwalacz `workflow_dispatch` (odczyt `on:` w pliku na `<sha okna>`) | tylko `workflow_dispatch`; inny wyzwalacz = okno nie startuje (zmiana wyzwalacza przed oknem to osobny krok i nowa decyzja) |

## 2. Zatrzymanie zapisów

Kiedy: 2.1 (okno w przód). 3.3 krok 1 (okno powrotu) — do przepisania razem
z sekcją 6. Kolejność
W0 → W7; W7 jest kontrolą końcową przed 2.2.

| Krok | Działanie | Zgoda (1.2) |
|---|---|---|
| W0 | zapis stanu sprzed okna | — (odczyt) |
| W1 | reguła zapory Vercela włączona (L1) | „start okna” |
| W2 | Preview i starsze wdrożenia zamknięte (L3) | — (odczyt; zmiana przed oknem, P11) |
| W3 | crony Vercela wyłączone (L2) | „start okna” |
| W4 | sha `main` bez zmian (L7) | — (odczyt) |
| W5 | ingress Cloud Run `internal` | „start okna” |
| W6 | zadania Scheduler wstrzymane | „start okna” |
| W7 | kontrola braku zapisów w Neonie | — (odczyt) |

**W0 — stan sprzed okna.** Do notatki okna (bez nazw projektów):

```bash
set +x
gcloud --project='<projekt GCP>' run services describe myhelper --region=europe-central2 --format='value(metadata.annotations."run.googleapis.com/ingress")'
gcloud --project='<projekt GCP>' scheduler jobs list --location=europe-central2 --format='value(name.basename(),state)'
git ls-remote origin refs/heads/main
```

Oczekiwane: ingress `all` (`docs/runbook-krok-d.md` sekcja 10a); lista zadań
`mh-*` ze stanem (R5 przywraca dokładnie tę listę); sha = `<sha okna>`. Oba
polecenia gcloud do potwierdzenia w próbie (składnia `--format`). Listy zadań
nie odczytuje się z polem nagłówków (`docs/runbook-krok-d.md` sekcja 4,
koniec). Zakaz scaleń (L7) ogłoszony przed W0.

**W1 — Vercel Production.** Panel Vercela → Firewall: włączyć regułę z P12
i opublikować. Kontrola (do potwierdzenia w próbie):

```bash
set +x
curl -s -o /dev/null -w '%{http_code}\n' "https://<domena Vercel Production>/api/health"
curl -s -o /dev/null -w '%{http_code}\n' "https://<adres starszego wdrożenia>/api/health"
```

Oczekiwane: `403`; dla starszego wdrożenia `403` albo `401` (ochrona z L3).
`200` z któregokolwiek = stop przed 2.2. Główna kontrola: W7.

**W2 — Preview.** Odczyt, bez zmiany: `curl` z P11 → `401` albo `403`, a
`POSTGRES_URL` w panelu bez zakresu Preview. Inny wynik = stop przed 2.2.
W2 nie jest pełną kontrolą: „Standard Protection” przepuszcza zalogowanych
członków zespołu Vercela, a istniejące Preview mają wbudowany stary
`POSTGRES_URL` — w oknie chroni je zapora całego projektu (W1), kontrolą jest W7.

**W3 — crony Vercela.** Panel Vercela → Settings → Cron Jobs → „Disable Cron
Jobs”. Oczekiwane: oba crony w panelu wyłączone. Okno planowane poza
02:00–03:30 UTC (W7 i tak obowiązuje).

**W4 — `main`.** Scalenia wstrzymane (L7):

```bash
set +x
git ls-remote origin refs/heads/main
```

Oczekiwane: `<sha okna>`. To samo polecenie w trzech miejscach; reguła przy
innym sha zależy od miejsca odczytu (inny sha = nowe wdrożenie Vercela
w oknie; ruchu nie dostaje, bo zapora działa na cały projekt):

- **przed 2.9** — stop, droga A, wyjaśnienie przed nowym oknem;
- **T3 (po T1, ingress `all`)** — stop według reguły pod tabelą sekcji 3:
  odczyt stanu (2.10, blok „Odczyt stanu”), dalej droga B albo C. Drogą A
  bez cofnięcia T1 iść nie wolno;
- **na końcu okna przed K1.1** (po 2.10 z kodem 0 albo po drodze C; po K1
  oczekiwany sha = scalenie K1) — drogi A nie ma (Cloud SQL odmrożony, GCP
  mógł zapisać; runbook przełączenia, droga C). K1 się nie scala, ruch
  zostaje na GCP, reguła zapory zostaje `Deny` dla wszystkiego (stan „droga
  C bez K1”, sekcja 3, K1). Dodatkowo odczyt rewizji Cloud Run obsługującej
  ruch:

  ```bash
  set +x
  gcloud --project='<projekt GCP>' run services describe myhelper --region=europe-central2 --format='value(status.traffic[0].revisionName)'
  ```

  Oczekiwane: rewizja z P5. Inna rewizja = stop, decyzja właściciela na
  miejscu (bez cofania rewizji — mogła zapisać). Do notatki okna: oba sha,
  rewizja, wpis „droga C bez K1: inny sha `main`”. K1 dopiero po
  wyjaśnieniu rozjazdu, osobnym scaleniem.

**W5 — ingress Cloud Run `internal`** (od 2.1 do 2.9; w 3.3 do końca okna
powrotu):

```bash
set +x
gcloud --project='<projekt GCP>' run services update myhelper --region=europe-central2 --ingress=internal
gcloud --project='<projekt GCP>' run services describe myhelper --region=europe-central2 --format='value(metadata.annotations."run.googleapis.com/ingress")'
curl -s -o /dev/null -w '%{http_code}\n' '<adres run.app usługi>/api/health'
curl -s -o /dev/null -w '%{http_code}\n' --resolve "app.nordsignal.cc:443:<LB_IP>" "https://app.nordsignal.cc/api/health"
```

Oczekiwane (do potwierdzenia w próbie): aktualizacja bez błędu; odczyt
`internal`; oba `curl` ≠ `200` (oczekiwany `404` — ingress `internal`
odrzuca też ruch z zewnętrznego LB). `200` z któregokolwiek = stop: usługa
przyjmuje ruch, 2.3–2.6 nie mają głównej kontroli (1.3 pkt 1).

**W6 — Scheduler.** Dla każdego zadania ze stanem `ENABLED` z W0 jeden wiersz
(pauza zadania `PAUSED` kończy się błędem `FAILED_PRECONDITION`,
`infra/gcp/scheduler.sh:40-41`):

```bash
set +x
gcloud --project='<projekt GCP>' scheduler jobs pause '<nazwa zadania>' --location=europe-central2
gcloud --project='<projekt GCP>' scheduler jobs list --location=europe-central2 --format='value(name.basename(),state)'
```

Oczekiwane: każde zadanie `PAUSED`. Błąd `ABORTED` = powtórzyć wiersz po
30 s (`scheduler.sh:163-171`). Inny błąd albo zadanie nie `PAUSED` = stop
przed 2.2.

**W7 — brak zapisów w Neonie.** Po W1–W6, poleceniem `psql_neon_owner`
(runbook przełączenia 1.6), dwa razy w odstępie co najmniej 2 min (liczniki
statystyk trafiają do widoku z opóźnieniem):

```bash
set +x
psql_neon_owner <<'SQL'
SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname NOT IN ('session', 'verification', 'auth_rate_limit');
SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname IN ('session', 'verification', 'auth_rate_limit');
SQL
```

Oczekiwane: pierwsza liczba **równa** w obu odczytach. Druga liczba tylko do
notatki (tych trzech tabel kopia nie przenosi, `copy-neon-to-cloudsql.sh:11-18`;
zapisy w nich kończy zamrożenie w 2.2). Pierwsza liczba wyższa w drugim
odczycie = coś nadal zapisuje: stop przed 2.2, przyczyna (W1–W3, lokalne
środowisko z adresem produkcyjnego Neona), potem W7 od nowa. Liczba niższa
w drugim odczycie (wyzerowanie statystyk po restarcie obliczeń Neona) = W7
od nowa.

## 3. Przełączenie ruchu na GCP (2.9) i przekierowanie (K1)

Zgoda: wiersz 1.2 „przełączenie ruchu aplikacji na GCP …”. Warunki: 2.8
z kodem 0; sekcja 1 spełniona. Kolejność: ingress przed DNS (przy `internal`
LB nie dostaje odpowiedzi usługi).

| Krok | Działanie | Polecenie | Oczekiwane |
|---|---|---|---|
| T1 | ingress `all` | `gcloud --project='<projekt GCP>' run services update myhelper --region=europe-central2 --ingress=all`, potem odczyt jak w W5 | odczyt `all` |
| T2 | LB odpowiada | `curl` z P6 | `200` (Cloud SQL zamrożony — odczyt działa) |
| T3 | sha `main` | blok W4 | `<sha okna>` |
| T4 | rekord `app` utworzony | panel Cloudflare: **nowy** rekord `A`, nazwa `app`, wartość `<LB_IP>`, **DNS only** (bez proxy), TTL 60 s | zapis w panelu bez błędu |
| T5 | DNS wskazuje LB | najpierw serwer autorytatywny: `dig +short app.nordsignal.cc @<serwer NS strefy>` (z P7); potem `dig +short app.nordsignal.cc @1.1.1.1` i `@8.8.8.8` | `<LB_IP>` z serwera autorytatywnego; z resolverów publicznych `<LB_IP>` najpóźniej po minimum SOA z P7 |
| T6 | odpowiada GCP, nie Vercel | `curl -s -o /dev/null -w '%{http_code}\n' "https://app.nordsignal.cc/api/health"` i `curl -sI "https://app.nordsignal.cc/api/health" \| grep -ci '^x-vercel-id:'` (do potwierdzenia w próbie); gdy lokalny resolver nie zna jeszcze rekordu — te same dwa polecenia z `--resolve "app.nordsignal.cc:443:<LB_IP>"` jako kontrola zastępcza | `200` i `0` |
| T7 | alert uptime | konsola Cloud Monitoring: włączyć politykę `myhelper-app-health-alert` (`docs/runbook-krok-d.md` sekcja 10a), potem odczyt stanu | włączona |
| T8 | adres webhooka Stripe (L6) | panel Stripe live → endpoint z F7 → zmiana adresu z `https://<domena Vercel Production>/api/stripe/webhook` na `https://app.nordsignal.cc/api/stripe/webhook`; **bez „Roll secret”** | endpoint włączony, nowy adres, sekret bez zmian; przy F7 = brak — „nie dotyczy” |

T5 z serwera autorytatywnego bez `<LB_IP>` po dwóch minutach (dwa TTL) albo
T6 (także z `--resolve`) z wynikiem innym niż oczekiwany = stop: odczyt
stanu (2.10, blok „Odczyt stanu”), dalej droga B albo C według runbooka
przełączenia. Resolver publiczny bez `<LB_IP>` przy poprawnym wyniku
z serwera autorytatywnego to buforowany brak rekordu, nie powód do stopu —
ponowić po minimum SOA, wynik do notatki. Po T8 — 2.10. Od T1 do 2.10 zapisy
na GCP kończą się błędem tylko do odczytu (2.9) — odcinek ma być krótki. Zdarzenia Stripe
odrzucone przez zaporę w oknie Stripe ponawia na bieżący adres endpointu (do
potwierdzenia w próbie, sekcja 0.3). OAuth bez zmian w oknie (P8).

**K1 — przekierowanie `<domena Vercel Production>` → `app.nordsignal.cc`.**
Wykonuje się po 2.10 z kodem 0 albo po drodze C, czyli zawsze po zakazie
scaleń z L7. Warunki przed K1.1 (obie drogi):

1. W4 na końcu okna = `<sha okna>` (inny sha — reguła W4, K1 się nie scala);
2. T5 z serwera autorytatywnego = `<LB_IP>`, oraz resolvery publiczne
   (`@1.1.1.1`, `@8.8.8.8`) = `<LB_IP>` albo od T4 upłynęło minimum SOA
   z P7 (czas do notatki okna);
3. T6 = `200` i `0`; kontrola z `--resolve` wystarcza tylko przy spełnionym
   pkt 2.

Po 2.10 z kodem 0 niespełniony pkt 2 albo 3 = K1.1 czeka do spełnienia
(ruch już na GCP). Po drodze C niespełniony warunek: K1 się nie wykonuje,
reguła zapory zostaje `Deny` dla wszystkiego (nie wyłączać, bo GCP mógł
zapisać), do notatki okna idzie wpis „droga C bez K1: aplikacja wyłączona
dla `<domena Vercel Production>`”, a dalej decyduje właściciel na miejscu.
Zgoda: wiersz 1.2 „po 2.10 z kodem 0 albo po drodze C …”. To wdrożenie
Vercel Production.

| Krok | Działanie | Polecenie | Oczekiwane |
|---|---|---|---|
| K1.1 | scalenie PR z P13 | PR dodaje do `vercel.json` jedno przekierowanie w `redirects`: `{"source": "/:path*", "destination": "https://app.nordsignal.cc/:path*", "permanent": false}` (tymczasowe, żeby powrót z sekcji 6 nie walczył z pamięcią przeglądarek) | wdrożenie Vercel Production `Ready` |
| K1.2 | zawężenie reguły zapory | panel Vercela → Firewall: reguła z L1 zawężona do metod innych niż `GET`/`HEAD`, opublikowana (zapora działa przed przekierowaniem — `Deny` dla wszystkiego zablokowałby też przekierowanie) | reguła włączona, warunek metody |
| K1.3 | przekierowanie działa | `curl -sI "https://<domena Vercel Production>/salon/x" \| grep -i '^location:'` | `location: https://app.nordsignal.cc/salon/x` |
| K1.4 | zapisy na Vercelu nadal blokowane | `curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<domena Vercel Production>/api/health"` (do potwierdzenia przy K1) | `403` |

Każda inna domena z F1 — to samo przekierowanie (osobny wiersz w PR,
rozstrzygnięty przed P13). Przy F8 = tak K1 jest obowiązkowy w tym samym oknie.

## 4. Cofnięcie przełączenia ruchu — droga B

Tylko po odczycie stanu Cloud SQL = `on` (runbook przełączenia, droga B;
2.10 „Odczyt stanu”). K1 nie był scalony (scalenie dopiero po 2.10 z kodem 0
albo po drodze C — obie wykluczają drogę B).
Zgoda: wiersz 1.2 „przełączenie ruchu aplikacji na GCP … przy wycofaniu
(droga B) …”. Do starej domeny wraca się bez DNS. Użytkownicy, którzy
w odcinku T6–2.10 weszli na `app.nordsignal.cc`, po B1 dostają błąd nazwy —
przyjęte (odcinek krótki, zapisy na GCP i tak zablokowane).

| Krok | Działanie | Polecenie | Oczekiwane |
|---|---|---|---|
| B1 | rekord `app` usunięty (jeśli T4 wykonany) | panel Cloudflare: usunięcie rekordu `A app` z T4 | zapis bez błędu; T4 niewykonany — „nie dotyczy” |
| B2 | rekordu brak | `dig +short app.nordsignal.cc @<serwer NS strefy>` (z P7) | pusty wynik; T4 niewykonany — „nie dotyczy” |
| B3 | adres webhooka Stripe przywrócony (jeśli T8 wykonany) | panel Stripe live: adres endpointu z powrotem `https://<domena Vercel Production>/api/stripe/webhook`, bez „Roll secret” | adres jak w P9; przy F7 = brak — „nie dotyczy” |
| B4 | ingress `internal` | blok W5 | odczyt `internal`, oba `curl` ≠ `200` |
| B5 | alert uptime | konsola: polityka `myhelper-app-health-alert` z powrotem wyłączona, jeśli T7 ją włączył | stan wyłączony |

Potem droga A od pkt 1 (odmrożenie Neona, Cloud SQL). Jej pkt 3 to sekcja 5,
a R1 wyłącza tam regułę zapory (zgoda: wiersz „start okna”).

## 5. Wznowienie stanu sprzed okna — droga A pkt 3

Po drodze A pkt 1–2 (Neon odmrożony, Cloud SQL przywrócony albo bez zmian).
Zgoda: kolumna „Zgoda” niżej. Ta sama dotyczy drogi A, do której doszło się
po drodze B.

| Krok | Działanie | Polecenie | Oczekiwane | Zgoda (1.2) |
|---|---|---|---|---|
| R1 | Vercel Production przyjmuje ruch | panel Vercela → Firewall: reguła z L1 **wyłączona** (nie usunięta — zostaje na następne okno) | reguła wyłączona | „start okna” |
| R2 | Preview | bez zmian (L3 na stałe: ochrona zostaje, `POSTGRES_URL` bez zakresu Preview) | `curl` z P11 → `401` albo `403` | — (odczyt) |
| R3 | crony Vercela | panel Vercela → Settings → Cron Jobs → „Enable” | oba crony włączone | „start okna” |
| R4 | ingress `all` dopiero po kontrolach drogi A pkt 2 | blok T1 | odczyt `all` | „start okna” |
| R5 | zadania Scheduler jak w W0 | niżej | lista = lista z W0 | „po oknie albo przy wycofaniu (droga A pkt 3) …” |
| R6 | odpowiada Vercel | `curl -s -o /dev/null -w '%{http_code}\n' "https://<domena Vercel Production>/api/health"` i `curl -sI "https://<domena Vercel Production>/api/health" \| grep -ci '^x-vercel-id:'` | `200` i `1` | — (odczyt) |

R5 — tylko zadania, które w W0 miały `ENABLED` (wiersz 1.2 „po oknie albo
przy wycofaniu (droga A pkt 3) …”):

```bash
set +x
PROJECT_ID='<projekt GCP>' REGION=europe-central2 BASE_URL='<adres run.app usługi>' infra/gcp/scheduler.sh --resume <nazwy zadań ENABLED z W0>
gcloud --project='<projekt GCP>' scheduler jobs list --location=europe-central2 --format='value(name.basename(),state)'
```

Oczekiwane: `resumed <nazwa>` dla każdej nazwy, kod 0; lista = lista z W0.
`--resume` odrzuca przed gcloud nazwę spoza tabeli i zadanie `PAUSED`
w tabeli (`scheduler.sh:112-129`). Zmienne w jednym wierszu z poleceniem
(w zsh `env $S` nie dzieli zmiennej na słowa).

**Okno w przód zakończone (2.10 z kodem 0 albo droga C).** Neon jest
zamrożony. Vercel: K1 scalony i reguła zapory zawężona do metod innych niż
`GET`/`HEAD` (K1.2). Wyjątek: droga C bez K1 (sekcja 3, K1), gdzie reguła
zostaje `Deny` dla wszystkiego. Crony Vercela są wyłączone na stałe (L2).
Ingress zostaje `all`. Scheduler: tylko R5, a po drodze C według decyzji
właściciela (runbook przełączenia, droga C).

**Stop w oknie powrotu** (3.3 krok 2 „stop” i „Stop w kroku 7 albo 8” — ruch
zostaje na GCP): R4 i R5; Vercel bez zmian (przekierowanie i zawężona reguła).

## 6. Powrót ruchu na Vercela — 3.3 krok 10

**Do przepisania pod dwie domeny przed oknem powrotu.** Nie blokuje próby
generalnej ani okna w przód. Poprzednia wersja tej sekcji zakładała jedną
domenę i nie obowiązuje.

Kierunek (do rozpisania na kroki z poleceniem i oczekiwanym wynikiem):
cofnięcie K1 (wdrożenie Vercel Production bez przekierowania), wyłączenie
reguły zapory z L1, włączenie cronów Vercela, usunięcie rekordu `app`,
przywrócenie adresu webhooka Stripe na `<domena Vercel Production>`, ingress
`internal` i Scheduler wstrzymany (3.3 krok 11), alert uptime wyłączony. Do
rozstrzygnięcia przy przepisaniu: kolejność cofnięcia K1 względem usunięcia
rekordu `app` (użytkownicy na `app.nordsignal.cc` po usunięciu dostają błąd
nazwy), zakaz scaleń na czas okna powrotu i wiersz 1.2 „okno powrotu” dla
wdrożenia cofającego K1.
