# Procedura zaproszenia salonu do bety

Beta działa tylko na zaproszenie. Salon może założyć wyłącznie konto, którego
adres e-mail jest na liście dozwolonych (`BETA_ALLOWED_OWNER_EMAILS`,
`src/lib/beta-access.ts`). Bramka sprawdza trzy rzeczy naraz:

1. adres konta z sesji jest na liście (wielkość liter i spacje wokół adresu
   nie mają znaczenia);
2. na serwerze działa wysyłka poczty;
3. adres konta jest potwierdzony linkiem z e-maila.

Pusta lista oznacza, że nikt nie założy salonu. Konto spoza listy może się
zarejestrować, ale przy zakładaniu salonu dostaje komunikat, że beta jest na
zaproszenie. Bramka działa tylko przy zakładaniu salonu. Jedno konto ma
najwyżej jeden salon.

**Kto.** Wszystkie kroki z odczytem bazy produkcyjnej i ze zmianą sekretu
wykonuje **wyłącznie właściciel**, we własnym terminalu i we własnej konsoli
chmury. Zespół przygotowuje parametry, pilnuje kolejności i prowadzi zapis
w prywatnym systemie zadań. Agenci nie wykonują żadnego z tych kroków.

**Co nie trafia do repozytorium.** Adresy e-mail, nazwy salonów,
identyfikatory salonów, daty dnia 0 powiązane z salonem oraz zawartość listy
dozwolonych. Te dane trzymamy w prywatnym systemie zadań z dostępem tylko dla
zespołu.

---

## 0. Każde połączenie z bazą produkcyjną

Dotyczy wszystkich odczytów w tej procedurze (1a, 1e, 2a, 3, 4b, 7) i bloku
z sekcji 5.

1. **Krok kontrolny przed blokiem połączenia.** Właściciel wpisuje najpierw:

   ```bash
   echo "P=${P:-BRAK}"
   ```

   Jeśli wynik to `BRAK`, zmienna nie jest ustawiona i **bloku połączenia nie
   wklejamy.** Najpierw ustawiamy zmienną, potem ponawiamy krok kontrolny.
   Dopiero wynik bez `BRAK` pozwala wkleić blok.
2. **Połączenie.** Blok połączenia administracyjnego (login aplikacji)
   z runbooka wdrożenia i bazy danych w katalogu docs, sekcja 9a
   (przedłużenie pilotażu). Rola tylko do odczytu nie widzi tabeli kont i tak
   zostaje, dlatego odczyty idą tym połączeniem.
3. **Dwie warstwy tylko do odczytu przy odczytach.** Do `PGOPTIONS` w bloku
   połączenia dopisujemy `-c default_transaction_read_only=on` (jak
   w kontrolach po wdrożeniu w tym samym runbooku), a każde zapytanie
   i tak stoi między `BEGIN READ ONLY;` a `ROLLBACK;`. Pomyłka przy wklejaniu
   poza transakcją też niczego nie zapisze. Opcję dopisujemy wewnątrz
   istniejącego cudzysłowu `PGOPTIONS`. Pierwsze zapytanie w sesji to
   `SHOW default_transaction_read_only;` i ma zwrócić `on`. Inny wynik =
   wyjście z `psql`. Wyjątek: blok zmiany z sekcji 5 idzie bez tej opcji,
   dokładnie według runbooka, i ten sam `SHOW` ma tam zwrócić `off`.
4. **Bez historii.** `psql` uruchamiamy z `-n` (bez edycji linii, więc bez
   pliku historii). Wariant z klientem w kontenerze uruchamiamy z `--rm`.
   Adres zaproszonego nie może zostać w pliku historii na stacji.
5. **Wynik to liczby.** Wyniku nie kopiujemy poza terminal. Zespół dostaje
   tylko liczby.

---

## 1. Warunki twarde przed PIERWSZYM zaproszeniem

Wszystkich pięć musi być spełnionych i zapisanych (data, wynik) w prywatnym
systemie zadań. Brak któregokolwiek = **pierwszego zaproszenia nie wysyłamy.**

### 1a. Dane testowe usunięte

Blok porządkowy usunięcia danych testowych z produkcji wykonał właściciel.
Blok obejmuje:

- oba salony testowe,
- konta właścicieli tych salonów,
- rezerwacje utworzone w testach (także rezerwacje gości),
- wpisy akceptacji dokumentów tych kont (to dane testowe, a nie dowód wobec
  prawdziwego klienta).

Sam blok przechodzi pełną recenzję przed uruchomieniem. **Bloku nie ma =
pierwszego zaproszenia nie wysyłamy.**

Dowód: wynik bloku (liczby usuniętych wierszy) w prywatnym systemie zadań
oraz niezależny odczyt kontrolny właściciela po bloku (połączenie jak
w sekcji 0):

```sql
BEGIN READ ONLY;
SELECT
  (SELECT count(*) FROM salons)            AS salony,
  (SELECT count(*) FROM appointments)      AS wizyty,
  (SELECT count(*) FROM clients)           AS klienci,
  (SELECT count(*) FROM legal_acceptances) AS akceptacje;
ROLLBACK;
```

Oczekiwane: cztery zera. Na produkcji nie było prawdziwego salonu, więc każdy
wiersz jest testowy, także salon demonstracyjny z danych startowych
i rezerwacje gości. Warunek nie zależy więc od tego, czy blok trafił we
wszystkie salony testowe. Wynik różny od zera = stop.

### 1b. Publiczny katalog pusty

Przed pierwszym prawdziwym salonem katalog nie może pokazywać żadnego salonu
testowego:

```bash
curl -s "https://<adres aplikacji>/api/salons" | grep -o '"count":[0-9]*'
```

Oczekiwane: `"count":0`. Odpowiedź katalogu jest buforowana do 60 sekund, więc
odczyt robimy co najmniej minutę po bloku z 1a. Wynik inny niż `0` = stop
i sprawdzenie, który salon jest widoczny. Nie zapraszamy, dopóki katalog nie
jest pusty.

Po pierwszym zaproszeniu liczba rośnie razem z prawdziwymi salonami, które
uzupełnią adres, telefon i branżę. Warunek `0` dotyczy tylko chwili przed
pierwszym zaproszeniem.

### 1c. Dokumenty prawne opublikowane

Flaga publikacji w `src/lib/legal/documents.ts` jest włączona na wdrożonej
wersji, a każda strona dokumentu odpowiada 200:

```bash
for p in terms privacy dpa podprocesorzy contact; do
  printf '%s %s\n' "/$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://<adres aplikacji>/$p")"
done
```

Oczekiwane: pięć linii, każda z `200`. Odpowiedź `404` oznacza, że dokumenty
nie są opublikowane na tej wersji. Wtedy stop.

### 1d. Moduł opinii zamrożony na wdrożonej wersji

Opinie są dziś w rdzeniu aplikacji i nie są zamrożone. Przed pierwszym
zaproszeniem moduł opinii ma `hardOff: true` w `src/lib/features.ts`
w rewizji, która obsługuje 100% ruchu.

Dowód w prywatnym systemie zadań: identyfikator wdrożonej rewizji (commit)
i potwierdzenie, że w tym commicie moduł opinii ma `hardOff: true`. Brak
zamrożenia na wdrożonej wersji = stop.

### 1e. Zadatki zablokowane w kodzie na wdrożonej wersji

Dziś salon może włączyć zadatek (u klienta w panelu, w usłudze przez API),
a klient z wymaganym zadatkiem trafiłby do płatności kartą. Regulamin mówi,
że płatność kartą jest wyłączona. Przed pierwszym zaproszeniem rewizja, która
obsługuje 100% ruchu, musi zawierać blokadę zadatków w kodzie: włączenie
zadatku i rozpoczęcie płatności zadatku kończą się odmową.

Dowód w prywatnym systemie zadań: identyfikator wdrożonej rewizji (commit)
z blokadą oraz odczyt właściciela (połączenie jak w sekcji 0):

```sql
BEGIN READ ONLY;
SELECT
  (SELECT count(*) FROM services WHERE deposit_required) AS uslugi_z_zadatkiem,
  (SELECT count(*) FROM clients WHERE require_deposit)   AS klienci_z_zadatkiem;
ROLLBACK;
```

Oczekiwane: `0` i `0`. Brak blokady na wdrożonej wersji albo wynik różny od
zera = stop.

---

## 2. Przed KAŻDYM zaproszeniem

### 2a. Na ten adres nie ma jeszcze konta

Właściciel sprawdza w bazie produkcyjnej (połączenie jak w sekcji 0), że
adresu jeszcze nie ma. Wynik to tylko liczby, bez adresu w wyniku:

```sql
BEGIN READ ONLY;
SELECT
  count(*)                              AS konta,
  count(*) FILTER (WHERE email_verified) AS potwierdzone
FROM "user"
WHERE lower(email) = lower('<adres zaproszenia>');
ROLLBACK;
```

Oczekiwane: `konta` równe `0`.

- `konta` = `0`: idziemy dalej.
- `konta` = 1 lub więcej: **stop, adresu nie dodajemy do listy.** Konto na
  ten adres założył już ktoś wcześniej, może sam zaproszony, a może ktoś
  inny. Właściciel kontaktuje się z zaproszonym innym kanałem niż ten adres
  (telefon, rozmowa) i ustala, czy to jego konto. Dopiero po potwierdzeniu,
  że konto należy do zaproszonego, a `potwierdzone` jest równe `konta`, wolno
  dodać adres do listy.

Odczyt dotyczy danych osobowych, więc wykonuje go wyłącznie właściciel.
Zespół dostaje tylko dwie liczby.

### 2b. Dodanie adresu do listy dozwolonych (krok właściciela)

Lista dozwolonych to **sekret w chmurze** („sekret listy dozwolonych”). Zmienia
go **tylko właściciel**:

1. Właściciel dodaje nową wersję sekretu listy dozwolonych. Dotychczasowe
   adresy zostają, a nowy adres dochodzi po przecinku. Adresy do usunięcia
   (4d) wypadają w tej samej wersji.
2. Lista żyje wyłącznie w sekrecie. Nie wpisujemy jej do zmiennych jawnych
   CI ani konfiguracji wdrożenia, do repozytorium, do zgłoszeń ani do
   rozmowy z zespołem. Wartości zmiennych jawnych trafiają do logów
   przebiegów.
3. Kontrola bez ujawniania adresów: właściciel sprawdza tylko **liczbę**
   adresów w nowej wersji. Wartość idzie wprost do liczenia, bez ekranu
   i pliku:

   ```bash
   CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1 gcloud --project="${P}" \
     secrets versions access latest --secret='<sekret listy dozwolonych>' \
     | tr ',' '\n' | grep -c '[^[:space:]]'
   ```

   Liczenie pomija puste pozycje, tak jak bramka. Oczekiwana liczba to
   poprzednia minus liczba usuniętych plus liczba nowych. Zespołowi
   właściciel przekazuje tylko tę liczbę.
4. **Zmiana listy działa dopiero po wdrożeniu nowej rewizji, która przejęła
   100% ruchu.** Sekret jest wpięty jako zmienna środowiskowa w wersji
   „najnowsza” i odczytywany przy starcie instancji. Działające instancje
   mają starą listę, a instancja startująca później (także w starej
   rewizji) może mieć już nową. Do wdrożenia instancje mogą więc mieć różne
   listy i wynik bramki zależy od tego, która instancja obsłuży żądanie.
   Wdrożenie wymaga zgody właściciela.

Zaproszenie wysyłamy dopiero **po wdrożeniu z pkt 4**, gdy nowa rewizja ma
100% ruchu. Inaczej zaproszony może przy zakładaniu salonu dostać odmowę.

### 2c. Treść zaproszenia

Szablon jest w sekcji 6. W treści muszą być:

- ostrzeżenie, że konto zakładamy **wyłącznie na adres, na który przyszło
  zaproszenie**;
- informacja, że adres trzeba potwierdzić linkiem z e-maila;
- informacja, że zadatki (sekcja 3) i opinie (1d) są w pilotażu niedostępne;
- prośba, żeby salon potwierdził odpowiedzią e-mail, że przyjmuje te
  ograniczenia pilotażu (brak zadatków, brak opinii). Regulamin obiecuje
  obie funkcje, więc różnicę zamyka indywidualne ustalenie, a wiąże ono
  tylko wtedy, gdy salon je przyjął.

---

## 3. Zadatki wyłączone u salonów pilotażowych

Dopóki ścieżka zadatku nie zostanie zatwierdzona, salon pilotażowy **nie
włącza zadatku**: ani w usłudze („wymagaj zadatku”), ani u klienta.

Pierwszą warstwą jest blokada w kodzie (warunek 1e): włączenie zadatku kończy
się odmową. Prośba do salonu i wykrywanie są drugą warstwą.

- Właściciel mówi to wprost w zaproszeniu (sekcja 6).
- Jeśli salon zgłosi, że włączył zadatek, prosimy o wyłączenie tego samego
  dnia i sprawdzamy, czy powstały rezerwacje z zadatkiem. Właściciel robi
  też odczyt z 4b (zadatek w usługach i u klientów). Oczekiwane po wyłączeniu:
  `0` i `0`.
- Zniesienie tego zakazu = osobna decyzja po zatwierdzeniu ścieżki zadatku.
  Wtedy ta sekcja dostaje zmianę w repozytorium, a salony pilotażowe
  wiadomość.

---

## 4. Po założeniu salonu przez zaproszonego

### 4a. Potwierdzenie nowego salonu innym kanałem

Nowy salon potwierdzamy **odczytem dziennym nowych salonów**, a nie samą
wiadomością od zaproszonego. Przed odczytem zespół podnosi o 1 oczekiwaną
liczbę nowych okresów próbnych. Odczyt ma pokazać dokładnie tyle nowych
salonów, ile było zaproszeń, które zakończyły się założeniem salonu.

- Liczba zgodna: idziemy dalej.
- Liczba większa niż oczekiwana: salon powstał bez naszej wiedzy. Niczego
  w bazie nie usuwamy. Tego samego dnia:
  1. zgłoszenie do zespołu bezpieczeństwa;
  2. izolacja: właściciel usuwa z listy dozwolonych adresy, przez które salon
     mógł powstać, a w razie wątpliwości wszystkie adresy niewykorzystane
     (2b, 4d);
  3. wdrożenie nowej rewizji tego samego dnia, bo usunięcie działa dopiero po
     nim (2b pkt 4);
  4. przerwa w wysyłaniu zaproszeń do wyjaśnienia sprawy.
- Liczba mniejsza: zaproszony jeszcze nie założył salonu albo trafił na
  odmowę bramki (często inny adres, sekcja 7).

### 4b. Odczyt akceptacji dokumentów

Właściciel czyta wpisy akceptacji nowego salonu (połączenie jak w sekcji 0).
Identyfikator salonu bierze z podzapytania po adresie konta, bez wypisywania
listy salonów. `<adres konta>` to adres z zaproszenia albo nowy adres
z sekcji 7. Wynik bez identyfikatora konta i bez danych osobowych:

```sql
BEGIN READ ONLY;
SELECT document, version, source, accepted_at
FROM legal_acceptances
WHERE salon_id = (
  SELECT s.id FROM salons s JOIN "user" u ON u.id = s.owner_id
  WHERE lower(u.email) = lower('<adres konta>')
)
ORDER BY document;
ROLLBACK;
```

Oczekiwane: **dokładnie 2 wiersze**, `dpa` i `terms`:

- w obu `version` równa bieżącej wersji dokumentu
  z `src/lib/legal/documents.ts` na wdrożonej wersji aplikacji;
- w obu `source` równe `registration` albo `create_salon`. U zaproszonego
  salonu akceptacja powstaje tylko w formularzu. Źródło `email_pilot` jest
  zarezerwowane dla akceptacji e-mailem, której formularz nie zapisuje, więc
  u zaproszonego salonu oznacza zapis spoza aplikacji.

Inny wynik (0, 1 albo więcej niż 2 wiersze, wersja inna niż bieżąca, źródło
`email_pilot` albo inne spoza formularza) = stop. Salon nie dostaje
przedłużenia pilotażu, a sprawa idzie do zespołu bezpieczeństwa tego samego
dnia.

W tej samej sesji właściciel sprawdza, że salon nie włączył zadatku ani
w usługach, ani u klientów (sekcja 3):

```sql
BEGIN READ ONLY;
SELECT
  (SELECT count(*) FROM services WHERE salon_id = s.id AND deposit_required) AS uslugi,
  (SELECT count(*) FROM clients  WHERE salon_id = s.id AND require_deposit)  AS klienci
FROM (
  SELECT s.id FROM salons s JOIN "user" u ON u.id = s.owner_id
  WHERE lower(u.email) = lower('<adres konta>')
) s;
ROLLBACK;
```

Oczekiwane: jeden wiersz, `0` i `0`. Brak wiersza oznacza, że na ten adres nie
ma salonu, i wtedy stop.

### 4c. Zapis dnia 0

Dzień 0 to data założenia salonu, czyli początek 14-dniowego okresu
próbnego (regulamin pkt 12.1). Zespół zapisuje go w prywatnym systemie zadań,
w zgłoszeniu salonu, razem z:

- datą 14. dnia (koniec okresu próbnego bez przedłużenia),
- datą końca pilotażu ustaloną z salonem e-mailem (regulamin pkt 12.2),
- potwierdzeniem salonu odpowiedzią e-mail, że przyjmuje ograniczenia
  pilotażu (brak zadatków, brak opinii; 2c),
- wynikami z 4a i 4b.

**Bez zapisanego potwierdzenia ograniczeń nie ma przedłużenia z sekcji 5.**

Do repozytorium nie trafia ani data powiązana z salonem, ani jego
identyfikator.

### 4d. Usunięcie adresu z listy dozwolonych

Po założeniu salonu adres na liście nie ma już żadnej funkcji, a jest daną
osobową w sekrecie. Zostawiony adres to też ryzyko: po usunięciu konta ktoś,
kto przejmie skrzynkę, mógłby założyć salon.

- Po zgodnych 4a i 4b adres usuwamy z listy w najbliższej nowej wersji
  sekretu (2b). Bez osobnego wdrożenia: zmiana wchodzi z najbliższym.
- Adres z zaproszenia niewykorzystanego przez 14 dni usuwamy tak samo.
- Przy usunięciu konta na prośbę salonu sprawdzamy, że adresu nie ma na
  liście.
- Usunięcie działa dopiero po wdrożeniu (2b pkt 4). Do tego czasu usunięty
  adres może nadal przejść bramkę. Przy pilnym odebraniu dostępu wdrożenie
  robimy tego samego dnia.
- Po wdrożeniu nowej rewizji poprzednie wersje sekretu właściciel wyłącza,
  bo nadal zawierają usunięte adresy. Wyłączenie, nie zniszczenie,
  przynajmniej do końca okna cofnięcia wdrożenia.

---

## 5. Przedłużenie pilotażu przed 14. dniem

Po 14. dniu panel salonu przechodzi w tryb tylko do odczytu. Przedłużenie
musi więc wejść **przed 14. dniem**. Najlepiej od razu po ustaleniu daty końca
pilotażu e-mailem, żeby salon nigdy nie zobaczył blokady. Warunek: w zgłoszeniu
salonu jest zapisane potwierdzenie ograniczeń pilotażu (4c).

Procedura: runbook wdrożenia i bazy danych w katalogu docs, sekcja 9a
(przedłużenie pilotażu). Stamtąd obowiązuje wszystko: kopia na żądanie przed
zmianą, data w UTC, jedna transakcja, odczyt przed zmianą i po zmianie, wpis
w dzienniku audytu bez danych salonu.

Przed blokiem właściciela z sekcji 9a obowiązuje krok kontrolny i `psql -n`
z sekcji 0 (pkt 1 i 4). Opcji tylko do odczytu tu nie dopisujemy, bo blok
zmienia datę.

---

## 6. Szablon treści zaproszenia

Krótko, po polsku. Bez cen. Bez obietnic funkcji zamrożonych (faktury,
program lojalnościowy ani inne moduły wyłączone w `src/lib/features.ts`) ani
opinii (1d). Bez obietnic działania, którego nie sprawdziliśmy na wdrożonej
wersji. Adres w szablonie to przykład.

> **Temat:** Zaproszenie do pilotażu MyHelper
>
> Dzień dobry,
>
> zapraszamy Państwa salon do pilotażu MyHelper: kalendarz wizyt, kartoteka
> klientów, usługi, pracownicy i rezerwacja online.
>
> **Ważne: konto proszę założyć wyłącznie na adres salon@example.com, na który
> przyszło to zaproszenie.** Na inny adres nie da się założyć salonu. Po
> rejestracji przyjdzie e-mail z linkiem potwierdzającym adres. Salon można
> założyć dopiero po kliknięciu tego linku.
>
> W pilotażu nie pobieramy żadnych opłat. Plan jest jeden i prosty. Termin
> końca pilotażu ustalimy z Państwem w osobnej wiadomości.
>
> W pilotażu część funkcji jest niedostępna:
>
> - **zadatki** – prosimy ich nie włączać ani w usługach, ani u klientów;
>   napiszemy, kiedy będzie to możliwe;
> - **opinie klientów** – w pilotażu są niedostępne.
>
> Prosimy o krótką odpowiedź na tę wiadomość z potwierdzeniem, że przyjmują
> Państwo te ograniczenia pilotażu.
>
> Jeśli coś nie zadziała, wystarczy odpowiedzieć na tę wiadomość.
>
> Pozdrawiamy,
> zespół MyHelper

---

## 7. Zaproszony założył konto na inny adres

Objaw: zaproszony zgłasza, że przy zakładaniu salonu widzi komunikat
o becie na zaproszenie, albo odczyt dzienny nie pokazuje nowego salonu.

1. **Nie dopisujemy nowego adresu od razu.** Najpierw potwierdzamy tożsamość
   kanałem związanym z zaproszeniem: odpowiedzią z adresu, na który poszło
   zaproszenie, albo innym kanałem znanym wcześniej (telefon, rozmowa).
2. **Wariant zalecany: konto na adres z zaproszenia.** Zaproszony rejestruje
   się na adres z zaproszenia, potwierdza go i zakłada salon. Konto na inny
   adres zostaje bez salonu. Pytamy, czy je usunąć. Usunięcie wykonuje
   właściciel ręcznie, zgodnie z polityką prywatności.
3. **Wariant, gdy zaproszony chce zostać przy innym adresie.** Po
   potwierdzeniu z punktu 1:
   - właściciel sprawdza tym samym odczytem co w 2a, że na nowy adres jest
     dokładnie jedno konto, to założone przez zaproszonego;
   - właściciel dodaje nowy adres do sekretu listy dozwolonych (krok 2b)
     i w tej samej wersji usuwa adres z zaproszenia. Liczba adresów nie
     zmienia się;
   - zmiana działa dopiero po wdrożeniu nowej rewizji ze 100% ruchu
     (2b pkt 4). Do tego czasu adres z zaproszenia może nadal przejść
     bramkę, a nowy może dostać odmowę;
   - bramka nadal wymaga potwierdzonego adresu, więc zaproszony musi
     kliknąć link potwierdzający na nowy adres.
4. Zmianę adresu zapisujemy w zgłoszeniu salonu w prywatnym systemie zadań
   (bez adresów w repozytorium). Dalej sekcja 4 bez zmian, z nowym adresem
   jako `<adres konta>` w 4b.
5. Jeśli zaproszony nie potwierdzi tożsamości kanałem z punktu 1, adresu nie
   dopisujemy. Konto na inny adres traktujemy jak każde konto spoza bety.
