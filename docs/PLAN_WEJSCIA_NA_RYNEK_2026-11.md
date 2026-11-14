# MyHelper — stan aplikacji i plan wejścia na rynek

**Data:** 2026-11-14 · **Wersja:** 1.1.2 · **Badane:** kod (`main` @ 1320e69), produkcja `my-helper-2.vercel.app`, dokumenty z lipca 2026

Ten dokument uzupełnia `RAPORT_I_PLAN_NAPRAWY_2026-07.md`. Tamten raport zamknął jakość kodu.
Ten dotyczy tego, czego kod nie pokazuje: działania na produkcji, pieniędzy, prawa i wyglądu.

---

## 1. Werdykt

Kod jest w dobrym stanie: 0 błędów TypeScript, 1185 zielonych testów, izolacja salonów przez
`forSalon` + RLS, lipcowe atrapy (zadatki, SMS, e-mail) zastąpione prawdziwymi integracjami.

Aplikacji nie da się dziś sprzedawać z pięciu powodów, z których żaden nie jest błędem w logice:

1. **Nie pobiera pieniędzy.** Okres próbny nigdy nie wygasa i nie ma żadnej blokady dostępu.
2. **Zadatki klientów wpadają na Twoje konto Stripe**, nie na konto salonu, i nie ma mechanizmu wypłaty.
3. **Produkcja jest wolna** (każda strona panelu 2,5–3,5 s), a przypomnienia SMS w ogóle się nie wysyłają.
4. **Brakuje podstaw prawnych**: regulamin, polityka prywatności i kontakt zwracają 404.
5. **Strona sprzedażowa obiecuje funkcje, które są wyłączone**, i powołuje się na „setki salonów".

Do tego interfejs wygląda na niedokończony głównie przez jedną rzecz: brak polskich znaków w całym panelu.

Rekomendacja: wypuścić mniejszy produkt. Sam kalendarz, rezerwacje przez link salonu, klienci,
przypomnienia SMS i płatna subskrypcja. Reszta schowana do czasu, aż każda funkcja przejdzie test na żywo.

---

## 2. Co sprawdziłem i co wyszło

### 2.1 Stan bazowy (potwierdzone dziś)

| Obszar | Stan |
|---|---|
| TypeScript strict | 0 błędów |
| Testy jednostkowe | 1185 / 1185 zielonych (90 plików) |
| ESLint | 0 błędów, 114 ostrzeżeń |
| Rozmiar | 141 tys. linii, 185 endpointów API (41 to AI), 87 stron, 46 tabel |
| Produkcja | odpowiada, `/api/health` zgłasza połączenie z bazą |
| Poprawki bezpieczeństwa z 14.11 | zmergowane lokalnie, **niewypchnięte** — produkcja nadal ma 8 luk, w tym IDOR w wycenie usługi |

### 2.2 Blokery wypuszczenia

Wszystko poniżej zweryfikowane w kodzie albo na produkcji, chyba że zaznaczono inaczej.

| # | Problem | Dowód | Waga |
|---|---|---|---|
| B1 | **Trial nigdy nie wygasa, brak blokady dostępu** | `src/lib/subscription.ts:26-45` uznaje status `trialing` bez sprawdzania `trialEndsAt`; nie ma crona, który zmienia status. Konto testowe: trial skończył się 20.07.2026, 14.11 nadal ma pełny plan Pro i baner „kończy się za 0 dni". Brak subskrypcji = darmowy Basic bez limitu czasu. Layout panelu nie sprawdza subskrypcji. | Krytyczna |
| B2 | **Zadatki trafiają na konto platformy** | `deposits/create-session/route.ts:272` tworzy zwykłą sesję Checkout na Twoim koncie Stripe. W całym `src` nie ma Stripe Connect (`transfer_data`, `on_behalf_of`, konta połączone). Pieniądze klientów salonu lądują u Ciebie i nie ma jak ich przekazać. Przyjmowanie cudzych pieniędzy to usługa płatnicza — do potwierdzenia z prawnikiem, ale w tej postaci nie nadaje się do sprzedaży. | Krytyczna |
| B3 | **Funkcje w USA, baza we Frankfurcie** | Nagłówek `x-vercel-id: arn1::iad1`, baza Neon `eu-central-1`. Każde zapytanie do bazy leci przez Atlantyk. Pomiar: TTFB stron panelu 2,5–3,5 s, pojedyncze API 1,4–3 s, `get-session` 0,8 s. Strony publiczne (bez bazy) 250 ms. | Krytyczna, naprawa jedną linią |
| B4 | **Przypomnienia nie działają na produkcji** | `vercel.json` ma tylko 2 dzienne crony czyszczące (limit planu Hobby). Harmonogram w GitHub Actions wyłączony 31.07. Crony `sms-reminders`, `push-reminders`, `push-reminders-24h` nie są przez nic wywoływane. | Krytyczna |
| B5 | **Vercel Hobby nie pozwala na użytek komercyjny** | Warunki Vercela. Plan Pro (20 USD/mies.) jest konieczny przed sprzedażą i przy okazji rozwiązuje B4. | Krytyczna |
| B6 | **CI nie działa od 31.07** | Każde zadanie kończy się po kilku sekundach: „The job was not started because an Actions budget is preventing further use". Limit wyczerpał cron uruchamiany co kilka minut. Od tego czasu nic nie pilnuje jakości przy pushu. | Wysoka |
| B7 | **Strony prawne nie istnieją** | `/privacy`, `/terms`, `/contact` → 404 na produkcji, a stopka do nich linkuje (`site-footer.tsx:41-43`). Brak usuwania konta i eksportu danych. | Krytyczna |
| B8 | **Kartoteka przechowuje alergie klientów** | To prawdopodobnie dane o zdrowiu (art. 9 RODO), wymagające wyraźnej zgody i mocniejszej ochrony. Do potwierdzenia z prawnikiem. | Wysoka |
| B9 | **Marketing obiecuje wyłączone funkcje** | „Asystent głosowy" jest w statystykach na stronie głównej, w planie Pro w cenniku, w rejestracji i na stronie subskrypcji, a moduł `voiceAi` ma `hardOff`. Do tego „Dołącz do setek salonów", ocena 4,9 i opinie podpisane „Tester Beta". | Wysoka |
| B10 | **Produkcja i development dzielą jedną bazę** | Publiczna lista salonów pokazuje „Salon Test User" i „Beauty Studio Demo". `.env.local` wskazuje tę samą bazę Neon co produkcja. | Wysoka |
| B11 | **Sesja wygasa po 15 minutach bezczynności** | `src/lib/auth.ts:26-27`. Właścicielka przy fotelu będzie wylogowywana kilkanaście razy dziennie. `updateAge: 0` dodatkowo zapisuje sesję do bazy przy każdym żądaniu. | Wysoka |
| B12 | **Brak monitoringu błędów** | W `package.json` nie ma Sentry ani odpowiednika. O awarii dowiesz się od klienta. | Wysoka |
| B13 | **Brak własnej domeny** | Adres `my-helper-2.vercel.app`. Domena jest potrzebna do Resend (DKIM), nazwy nadawcy SMS i zaufania. | Wysoka |
| B14 | **Błędy CSP na każdej stronie produkcji** | Od 2 do 50 błędów „Applying inline style violates Content Security Policy" na stronę. Część stylów wstawianych w atrybutach jest blokowana. Wpływu na wygląd nie zmierzyłem. | Średnia |

### 2.3 Czego nie udało się sprawdzić

- **Zmienne środowiskowe na Vercelu.** CLI nie jest zalogowane. Nie wiem, czy produkcja ma klucze Resend, SMSAPI, `CRON_SECRET`, Blob, Upstash, ani czy Stripe jest w trybie testowym czy produkcyjnym. Lokalne klucze Stripe zaczynają się od `mk_`, co nie jest formatem Stripe.
- **Płatności, SMS i e-mail od początku do końca.** Lipcowe raporty też ich nie testowały. Nikt jeszcze nie widział prawdziwej subskrypcji ani prawdziwego SMS-a z tej aplikacji.
- **Testy E2E.** Na tym komputerze nie ma przeglądarek Playwright, a ta sieć blokuje port 5432 do Neon, więc lokalny panel nie łączy się z bazą.
- **Funkcje AI na żywo, logowanie klienta, dostępność, Lighthouse, prawdziwy telefon.**
- **Linear.** W tej sesji nie ma podpiętych narzędzi Linear.

---

## 3. Decyzje, od których zależy reszta planu

Kolejność według tego, jak drogo jest je zmienić później.

> **Status (2026-11-14): Darek zaakceptował rekomendacje D1–D5 bez wyjątków.** Wariant zakresu: B (etapy 0–4).

### D1. Zadatki online: wyłączyć na start czy od razu Stripe Connect?

**Rekomendacja: wyłączyć na start.** Salon oznacza zadatek ręcznie („wpłacony przelewem / BLIK-iem na telefon").
Stripe Connect (salon podpina własne konto, pieniądze idą prosto do niego) wchodzi w etapie 5.

Powód: Connect to onboarding salonu w Stripe, weryfikacja tożsamości, obsługa sporów i zwrotów na cudzym koncie.
To osobny projekt. Wyłączenie usuwa jednocześnie najbardziej ryzykowny przepływ pieniędzy:
webhook zadatków, auto-zwroty, cron czyszczący.

Koszt: tracisz na start argument „zadatki bez prowizji".

### D2. Co się dzieje po zakończeniu trialu?

**Rekomendacja: panel przechodzi w tryb tylko do odczytu, rezerwacje online przestają przyjmować nowe wizyty.**
Dane zostają, eksport działa, jeden przycisk „Wykup plan" przywraca wszystko.

Odradzam spadek do darmowego Basic: wtedy nikt nie ma powodu płacić 49 zł.

Wymaga decyzji o stanach subskrypcji w schemacie (`trialing → expired → active → past_due → canceled`)
i jednego miejsca, które je egzekwuje: layout panelu + `withApiHandler`.

### D3. Katalog „Szukam salonu": zostawić czy schować?

**Rekomendacja: schować.** Katalog z czterema salonami wygląda na martwy i przeczy pozycjonowaniu
„Twoi klienci są Twoi". Każdy salon dostaje własny adres rezerwacji, kod QR i przycisk na Instagram.

To wymaga czytelnych adresów: `/s/salon-ada` zamiast `/salons/3c0b7926-3bcf-41ee-…`.
Kolumna `salons.slug` to zmiana schematu, więc robimy ją wcześnie.

Przy okazji znikają: ulubione, obowiązkowe konto klienta, ranking, filtry branż.
Rezerwacja gościa bez konta już działa.

### D4. Wyłączony kod: trzymać za flagą czy usunąć z `main`?

**Rekomendacja: usunąć z `main`, zostawić tag `v1.1.2-full`.** Dotyczy asystenta głosowego
(`ai/voice/incoming/route.ts` — 1635 linii, największy plik w repo), generowania wideo, fiskalizacji
i publikacji postów.

W lipcu ustaliliśmy „nie kasować, tylko flagi". Zmieniam zdanie, bo wyłączony kod dalej kosztuje:
zależności `twilio` i `elevenlabs` generują podatności w audycie, wydłużają build, a 41 endpointów AI
trzeba utrzymywać przy każdej zmianie warstwy repozytorium. Z tagu wszystko da się odzyskać.

### D5. Długość sesji

**Rekomendacja: 30 dni z odświeżaniem, ponowne hasło tylko przy operacjach wrażliwych**
(zmiana e-maila, hasła, subskrypcji, eksport klientów). Włączyć `cookieCache`, żeby sesja nie obciążała bazy
przy każdym żądaniu.

---

## 4. Uproszczenia

### 4.1 Zakres produktu na start

| Zostaje (rdzeń) | Dodatki do włączenia w ustawieniach | Schowane do czasu testu na żywo | Usunięte z `main` (D4) |
|---|---|---|---|
| Kalendarz i grafiki | Magazyn | Program lojalnościowy | Asystent głosowy |
| Rezerwacja przez link salonu | Kody rabatowe | Newslettery | Generowanie wideo |
| Klienci | Lista oczekujących | Faktury | Fiskalizacja |
| Usługi i zespół | Raporty zaawansowane | Promocje złożone (happy hours, pakiety, 2+1) | Publikacja postów social |
| Przypomnienia SMS | | Zadatki online (D1) | Relikty BLIK P2P |
| Opinie i galeria | | Katalog salonów (D3) | |
| 3 raporty podstawowe | | Push dla klientów | |
| Asystent AI (Pro) | | Generowanie obrazów | |

Kryterium wyjścia ze „schowanych": funkcja przeszła pełny scenariusz na produkcji z prawdziwym
SMS-em, e-mailem albo płatnością. Lojalność i faktury nie przeszły go nigdy (UAT z 6.07).

Faktury mają dodatkowe ryzyko: obowiązkowy KSeF. Moduł, który wystawia faktury poza KSeF,
może wprowadzać salon w błąd. Do sprawdzenia z księgową przed odsłonięciem.

### 4.2 AI: jeden asystent zamiast sześciu wejść

Dziś hub AI ma 6 kafelków, z których cztery robią to samo z innej strony:
asystent biznesowy, chat, rekomendacje, analiza trendów.

Docelowo dwie rzeczy:
- **Karta „Na dziś"** na pulpicie: jedna, najważniejsza podpowiedź dziennie.
- **Asystent**: jedno okno rozmowy, które zna dane salonu i umie też napisać post albo odpowiedź na opinię.

Rekomendacje dzienne i tygodniowe są liczone regułami bez modelu, ale przy każdym wejściu na pulpit
(4–5,5 s na produkcji). Wystarczy liczyć je raz dziennie i zapisywać wynik.

### 4.3 Nawigacja

Dziś: 20 pozycji w 4 grupach, przy wysokości 900 px ostatnie znikają pod krawędzią ekranu.

Docelowo 5 pozycji: **Dziś · Kalendarz · Klienci · Oferta** (usługi + zespół) **· Wyniki** (raporty + płatności),
plus „Więcej" na dodatki i ustawienia. Na telefonie cztery ikony i środkowy przycisk „+ Wizyta".

### 4.4 Technika i infrastruktura

| Zmiana | Efekt |
|---|---|
| Funkcje Vercela w `fra1` | Panel kilka razy szybszy, zero zmian w kodzie aplikacji |
| Jeden harmonogram: Vercel Cron na planie Pro | Znika workflow crona w GitHub Actions i zewnętrzne schedulery |
| Osobna baza dla produkcji, lokalnie Docker | Koniec z testowaniem na danych klientów |
| `subscriptions/current` pobierane raz i współdzielone | Dziś 2–3 wywołania na stronę po 1,7 s każde |
| Dane pulpitu i list ładowane po stronie serwera | Znika kaskada `salons/mine` → dane i ekrany ze spinnerami |
| Usunięcie `twilio`, `elevenlabs` (D4) | Mniej zależności i podatności |
| Baner „Zainstaluj aplikację" dopiero po zalogowaniu | Dziś wyskakuje anonimowemu gościowi przy pierwszej wizycie |

---

## 5. Interfejs: ocena

Oceniałem 36 ekranów produkcji: strony publiczne, 20 ekranów panelu, 7 widoków telefonu.

### 5.1 Co jest dobre

- Spójna paleta (terakota, krem, brąz) i para fontów. Aplikacja ma własny charakter.
- Kreator rezerwacji dla klienta jest czytelny: usługa → pracownik → termin → potwierdzenie.
- Telefon ma dolną nawigację, a nie zwinięte menu.
- Puste stany istnieją i mówią, co zrobić.
- Tryb ciemny jest zdefiniowany.

### 5.2 Co psuje wrażenie

| # | Problem | Gdzie |
|---|---|---|
| U1 | **Brak polskich znaków.** „Uslugi", „Platnosci", „Ladowanie…", „Haslo", „Zaloguj sie", „Dzien". Samo „Blad" jest w 119 plikach, „zostal" w 97. Strona modułów ma znaki, reszta nie. | Cały panel, logowanie, część strony głównej |
| U2 | **Wszystko jest beżowe na beżowym.** Kremowe karty na kremowym tle, każda z ramką i cieniem. Nic się nie wybija, oko nie wie, gdzie patrzeć. | Cały panel |
| U3 | **Pulpit nowego salonu to ściana zer i czerwonych alarmów.** Baner trialu, dwa bloki AI z alertem „Wysoki", sześć liczników „0". Dzisiejsze wizyty są dopiero pod tym wszystkim. Tytuł strony to „Dashboard". | `/dashboard` |
| U4 | **Listy marnują ekran.** Klienci i usługi to wąska kolumna 530 px na ekranie 1440 px, jedna duża karta na rekord. Raporty i kalendarz są na pełną szerokość. Każdy ekran ma inną szerokość. | Klienci, usługi, pracownicy |
| U5 | **Kalendarz jest poprawny, ale surowy.** Osiem kontrolek nad siatką, legenda zajmuje osobny wiersz, brak linii „teraz". To ekran, na którym właścicielka spędza większość dnia. | `/dashboard/calendar` |
| U6 | **Pływający przycisk mikrofonu na każdym ekranie.** Na telefonie zasłania treść list. | Cały panel |
| U7 | **Niespójny powrót.** Raz „← Dashboard", raz „← Powrót", raz sama strzałka, raz nic. Okruszki pokazują surowe „modules". | Podstrony |
| U8 | **Logowanie i rejestracja.** Pół ekranu zajmuje rozmyte zdjęcie stockowe różowego fotela, pod formularzem pięć linków. Odstaje od reszty. | `/login`, `/register` |
| U9 | **Strona główna to rozdzielacz „Prowadzę salon / Szukam salonu".** Prawdziwa strona sprzedażowa jest pod `/dla-salonow`. | `/` |
| U10 | **Strona sprzedażowa mówi językiem luksusu** („niespotykana elegancja", „ekskluzywny dostęp") do salonów, dla których Booksy jest za drogie. Makieta w nagłówku to abstrakcyjny mini-kalendarz, nie produkt. | `/dla-salonow` |
| U11 | **Strona salonu dla klienta jest pusta wizualnie.** Brak zdjęcia, okładka z ikoną nożyczek, nazwa i dane kontaktowe. To jedyny ekran, który widzą klienci salonu. | `/salons/[id]` |
| U12 | **Ładowanie to spinnery przez 3 sekundy.** Po przeniesieniu do `fra1` będzie krócej, ale szkielety ekranów wyglądają lepiej niż kółka. | Cały panel |
| U13 | **Szum.** Plakietka „Aktywna" przy każdej usłudze, „Klient" przy każdym kliencie, „0.00 PLN" zamiast „0 zł". | Listy, raporty |

---

## 6. Interfejs: kierunek

### 6.1 Zasada: „Pracownia"

Zostaje terakota i ciepło. Zmienia się rola kolorów:

- **Powierzchnie robocze są białe**, tło ciepłe i jaśniejsze. Karta ma ramkę albo cień, nigdy oba.
- **Terakota tylko dla akcji i dla „teraz"**: główny przycisk, linia bieżącej godziny, aktywna pozycja menu.
- **Szeryfowy font tylko tam, gdzie się sprzedaje i świętuje**: strona sprzedażowa, strona salonu, duże liczby. Panel roboczy w całości bezszeryfowy.
- **Gęstość zależy od ekranu**: tabele na komputerze, karty na telefonie.
- **Statusy mają stałe kolory w całej aplikacji** i zawsze towarzyszy im słowo.
- **Język**: polskie znaki wszędzie, „zł" zamiast „PLN", zwroty do kobiety prowadzącej salon bez korporacyjnego tonu.

### 6.2 Ekrany, które robią różnicę

**Dziś (zamiast pulpitu).** Oś czasu dzisiejszych wizyt z linią „teraz". Nad nią trzy liczby:
wizyty dziś, utarg dziś, wolne okna. Obok jedna karta od asystenta. Dla nowego salonu zamiast zer
lista „3 kroki do pierwszej rezerwacji" z paskiem postępu.

**Kalendarz.** Linia „teraz", kolor wizyty według usługi, awatary pracowników w nagłówkach kolumn,
klik w pusty slot od razu otwiera nową wizytę z wpisaną godziną. Kontrolki zwinięte do jednego paska.
Na telefonie widok dnia jako lista, bez poziomego przewijania kolumn.

**Wizytówka salonu.** Okładka i logo salonu, galeria, opinie, zespół ze zdjęciami,
chipy „wolne dziś: 14:00 · 15:30 · 17:00" i przyklejony przycisk „Zarezerwuj".
Salon wybiera jeden z pięciu motywów kolorystycznych, więc strona wygląda jak jego, nie jak MyHelper.

**Salon w 5 minut.** Kreator po rejestracji: nazwa i adres → godziny otwarcia → cennik → zespół → gotowy link i QR.
W kroku „cennik" właścicielka wkleja tekst albo zdjęcie swojego cennika, a AI zamienia to w listę usług
z cenami i czasem trwania. To samo dla klientów z pliku CSV lub kontaktów telefonu.
To jest odpowiedź na główną barierę przejścia z Booksy: „nie chce mi się tego przepisywać".

**Plakat z QR.** Jeden przycisk generuje PDF do wydruku przy lustrze i grafikę na Instagram
z kodem QR i adresem rezerwacji.

**Podgląd SMS-a.** W ustawieniach powiadomień makieta telefonu pokazuje dokładnie to, co zobaczy klientka.

**Zamknięcie dnia.** Wieczorem jedna karta: utarg, liczba wizyt, nieobecności, jutro pierwsza wizyta o…

**Strona sprzedażowa.** Pod `/`, z prawdziwymi zrzutami produktu. Trzy argumenty: stała cena bez prowizji,
klienci zostają u Ciebie, przenosiny w 5 minut. Kalkulator „ile oszczędzasz względem Booksy".
Opinie dopiero wtedy, gdy będą prawdziwe.

### 6.3 Następny krok dla wyglądu

Zanim ruszę kod interfejsu, proponuję jeden plik HTML z trzema wariantami ekranu „Dziś" i wizytówki salonu.
Wybierzesz kierunek na makiecie, a nie po przeróbce 87 stron.

---

## 7. Plan etapami

Rozmiary: S = do pół dnia, M = 1–2 dni, L = 3–5 dni pracy z agentem. To szacunki, nie zobowiązania.

### Etap 0 — Fundament (bez pisania funkcji)

| # | Zadanie | Rozmiar | Kto |
|---|---|---|---|
| 0.1 | `git push origin main` — poprawki bezpieczeństwa z 14.11 na produkcję | S | Darek |
| 0.2 | `"regions": ["fra1"]` w `vercel.json`, pomiar przed i po | S | agent |
| 0.3 | Vercel Pro, pełny harmonogram cronów w `vercel.json`, `CRON_SECRET` | S | Darek + agent |
| 0.4 | Odblokowanie GitHub Actions (limit wydatków), usunięcie workflow crona | S | Darek + agent |
| 0.5 | Domena, DNS, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | S | Darek |
| 0.6 | Osobna baza produkcyjna w Neon, lokalnie Docker, usunięcie danych testowych | M | Darek + agent |
| 0.7 | Przegląd zmiennych na Vercelu według `ZADANIA_WLASCICIELA.md`: Resend, SMSAPI, Blob, Upstash, Stripe | M | Darek |
| 0.8 | Sentry + alert dostępności na `/api/health` | S | agent |

### Etap 1 — Pieniądze i prawda

| # | Zadanie | Rozmiar |
|---|---|---|
| 1.1 | Stany subskrypcji + wygasanie trialu + tryb tylko do odczytu (D2). Zaczynamy od testu, który odtwarza B1. | L |
| 1.2 | Wyłączenie zadatków online, ręczne oznaczanie zadatku (D1) | M |
| 1.3 | Usunięcie ze strony sprzedażowej, cennika, rejestracji i strony subskrypcji wszystkiego, czego produkt nie robi | S |
| 1.4 | Regulamin, polityka prywatności, kontakt, umowa powierzenia danych dla salonów | M + prawnik |
| 1.5 | Usunięcie konta i eksport danych salonu; decyzja o polu „alergie" (B8) | M |
| 1.6 | Sesja 30 dni + `cookieCache` (D5) | S |
| 1.7 | Naprawa CSP dla stylów w atrybutach (B14) | S |

### Etap 2 — Odchudzanie

| # | Zadanie | Rozmiar |
|---|---|---|
| 2.1 | `salons.slug`, adres `/s/[slug]`, przekierowania ze starych adresów (D3) | M |
| 2.2 | Schowanie katalogu salonów; `/` staje się stroną sprzedażową | S |
| 2.3 | Tag `v1.1.2-full`, usunięcie voice, wideo, fiskalizacji, social i ich zależności (D4) | M |
| 2.4 | Zamrożenie lojalności, newsletterów, faktur i promocji złożonych (`hardOff`) | S |
| 2.5 | Jeden asystent AI zamiast sześciu wejść; rekomendacje liczone raz dziennie | M |
| 2.6 | Nawigacja: 5 pozycji + „Więcej" | M |

### Etap 3 — Wygląd

| # | Zadanie | Rozmiar |
|---|---|---|
| 3.1 | Makieta HTML: 3 warianty „Dziś" i wizytówki salonu → wybór kierunku | M |
| 3.2 | Polskie znaki w całej aplikacji + test, który pilnuje, żeby nie wróciły | L |
| 3.3 | Tokeny kolorów i powierzchni według „Pracowni", jeden szablon strony (szerokość, nagłówek, powrót) | M |
| 3.4 | Ekran „Dziś" z listą pierwszych kroków | L |
| 3.5 | Kalendarz: linia „teraz", szybkie dodawanie, widok dnia na telefonie | L |
| 3.6 | Listy jako tabele na komputerze; szkielety zamiast spinnerów | M |
| 3.7 | Wizytówka salonu z motywem kolorystycznym | L |
| 3.8 | Logowanie i rejestracja; strona sprzedażowa z prawdziwymi zrzutami | M |

### Etap 4 — Dowód

| # | Zadanie | Rozmiar |
|---|---|---|
| 4.1 | Scenariusz na produkcji z prawdziwymi usługami: rejestracja → e-mail weryfikacyjny → trial → płatność Stripe → rezerwacja gościa → SMS potwierdzenia → przypomnienie z crona → anulowanie → wygaśnięcie trialu | L |
| 4.2 | Ten sam scenariusz jako test E2E uruchamiany po każdym wdrożeniu | M |
| 4.3 | Próbne odtworzenie bazy z kopii | S |
| 4.4 | Beta z 3–5 zaprzyjaźnionymi salonami przez 2 tygodnie, za darmo, z cotygodniową rozmową | — |
| 4.5 | Lista kontrolna wydania i pierwsza płatna sprzedaż | S |

### Etap 5 — Wyróżniki (po pierwszych płacących)

| # | Zadanie | Rozmiar |
|---|---|---|
| 5.1 | Salon w 5 minut: import cennika i klientów przez AI | L |
| 5.2 | Stripe Connect i powrót zadatków online | L+ |
| 5.3 | Plakat z QR, grafika na Instagram | M |
| 5.4 | Zamknięcie dnia, podgląd SMS-a | M |
| 5.5 | Odmrażanie modułów po kolei, każdy po teście na żywo | — |

### Trzy warianty zakresu

| Wariant | Co obejmuje | Kiedy ma sens |
|---|---|---|
| **A. Zamknięta beta** | Etapy 0, 1.3, 1.4, 3.2 | Chcesz szybko postawić aplikację przed prawdziwym salonem, bez pobierania pieniędzy |
| **B. Płatny start** (rekomendowany) | Etapy 0–4 | Chcesz produkt, za który można uczciwie wziąć 49 zł |
| **C. Start z wyróżnikiem** | B + 5.1 i 5.3 przed premierą | Chcesz wejść z argumentem „przenosiny z Booksy w 5 minut" |

---

## 8. Otwarte pytania do Darka

1. ~~D1–D5: czy zgadzasz się z rekomendacjami?~~ Zaakceptowane 2026-11-14.
2. Czy masz już domenę i nazwę, pod którą to sprzedajesz?
3. Czy są salony gotowe do bety?
4. Kto zrobi regulamin i umowę powierzenia: prawnik czy szablon do weryfikacji?
5. Jeden plan czy dwa na start? Dwa plany to zmiana planu w trakcie okresu, rozliczenia proporcjonalne i limity AI. Jeden plan na premierę uprościłby etap 1.1.
