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
zaproszenie.

**Kto.** Wszystkie kroki z odczytem bazy produkcyjnej i ze zmianą sekretu
wykonuje **wyłącznie właściciel**, we własnym terminalu i we własnej konsoli
chmury. Zespół przygotowuje parametry, pilnuje kolejności i prowadzi zapis
w prywatnym systemie zadań. Agenci nie wykonują żadnego z tych kroków.

**Co nie trafia do repozytorium.** Adresy e-mail, nazwy salonów,
identyfikatory salonów, daty dnia 0 powiązane z salonem oraz zawartość listy
dozwolonych. Te dane trzymamy w prywatnym systemie zadań z dostępem tylko dla
zespołu.

---

## 1. Warunki twarde przed PIERWSZYM zaproszeniem

Wszystkie trzy muszą być spełnione i zapisane (data, wynik) w prywatnym
systemie zadań. Brak któregokolwiek = **pierwszego zaproszenia nie wysyłamy.**

### 1a. Dane testowe usunięte

Blok porządkowy usunięcia danych testowych z produkcji wykonał właściciel.
Blok obejmuje:

- oba salony testowe,
- konta właścicieli tych salonów,
- rezerwacje utworzone w testach (także rezerwacje gości),
- wpisy akceptacji dokumentów tych kont (to dane testowe, a nie dowód wobec
  prawdziwego klienta).

Dowód: wynik bloku (liczby usuniętych wierszy) w prywatnym systemie zadań
i odczyt kontrolny po bloku, zgodnie z treścią bloku. Sam blok przechodzi
pełną recenzję przed uruchomieniem.

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

---

## 2. Przed KAŻDYM zaproszeniem

### 2a. Na ten adres nie ma jeszcze konta

Właściciel sprawdza w bazie produkcyjnej, że adresu jeszcze nie ma. Wynik to
tylko liczba, bez adresu w wyniku i bez kopiowania wyniku poza terminal:

```sql
BEGIN READ ONLY;
SELECT count(*) FROM "user" WHERE lower(email) = lower('<adres zaproszenia>');
ROLLBACK;
```

Oczekiwane: `0`.

- `0`: idziemy dalej.
- `1`: **stop, adresu nie dodajemy do listy.** Konto na ten adres założył już
  ktoś wcześniej, może sam zaproszony, a może ktoś inny. Właściciel
  kontaktuje się z zaproszonym innym kanałem niż ten adres (telefon, rozmowa)
  i ustala, czy to jego konto. Dopiero po potwierdzeniu, że konto należy do
  zaproszonego i ma potwierdzony adres, wolno dodać adres do listy.

Odczyt dotyczy danych osobowych, więc wykonuje go wyłącznie właściciel.
Zespół dostaje tylko wynik: „0” albo „1”.

### 2b. Dodanie adresu do listy dozwolonych (krok właściciela)

Lista dozwolonych to **sekret w chmurze** („sekret listy dozwolonych”). Zmienia
go **tylko właściciel**:

1. Właściciel dodaje nową wersję sekretu listy dozwolonych. Dotychczasowe
   adresy zostają, a nowy adres dochodzi po przecinku.
2. Lista żyje wyłącznie w sekrecie. Nie wpisujemy jej do zmiennych jawnych
   CI ani konfiguracji wdrożenia, do repozytorium, do zgłoszeń ani do
   rozmowy z zespołem. Wartości zmiennych jawnych trafiają do logów
   przebiegów.
3. Kontrola bez ujawniania adresów: właściciel sprawdza tylko **liczbę**
   adresów w nowej wersji. Oczekiwana liczba to poprzednia plus 1.
   Zespołowi przekazuje tylko tę liczbę.
4. Nowa wartość zaczyna działać dopiero wtedy, gdy aplikacja ją odczyta.
   Jeśli wymaga to nowego wdrożenia, to wdrożenie także robi właściciel.

Zaproszenie wysyłamy dopiero **po** kroku 2b. Inaczej zaproszony założy konto,
a przy zakładaniu salonu dostanie odmowę.

### 2c. Treść zaproszenia

Szablon jest w sekcji 6. W treści muszą być:

- ostrzeżenie, że konto zakładamy **wyłącznie na adres, na który przyszło
  zaproszenie**;
- informacja, że adres trzeba potwierdzić linkiem z e-maila;
- informacja, że zadatki są w pilotażu wyłączone (sekcja 3).

---

## 3. Zadatki wyłączone u salonów pilotażowych

Dopóki ścieżka zadatku nie zostanie zatwierdzona, salon pilotażowy **nie
włącza zadatku**: ani w usłudze („wymagaj zadatku”), ani u klienta.

- Właściciel mówi to wprost w zaproszeniu (sekcja 6).
- Jeśli salon zgłosi, że włączył zadatek, prosimy o wyłączenie tego samego
  dnia i sprawdzamy, czy powstały rezerwacje z zadatkiem.
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
- Liczba większa niż oczekiwana: salon powstał bez naszej wiedzy. Tego samego
  dnia zgłoszenie do zespołu bezpieczeństwa. Niczego nie usuwamy.
- Liczba mniejsza: zaproszony jeszcze nie założył salonu albo trafił na
  odmowę bramki (często inny adres, sekcja 7).

### 4b. Odczyt akceptacji dokumentów

Właściciel czyta wpisy akceptacji nowego salonu. Wynik bez identyfikatora
konta i bez danych osobowych:

```sql
BEGIN READ ONLY;
SELECT document, version, source, accepted_at
FROM legal_acceptances
WHERE salon_id = '<id salonu>'
ORDER BY document;
ROLLBACK;
```

Oczekiwane: **dokładnie 2 wiersze**, `dpa` i `terms`. W obu `version` równa
bieżącej wersji dokumentu z `src/lib/legal/documents.ts` na wdrożonej wersji
aplikacji. Inny wynik (0, 1 albo więcej niż 2 wiersze, wersja inna niż
bieżąca) = stop. Salon nie dostaje przedłużenia pilotażu, a sprawa idzie do
zespołu bezpieczeństwa tego samego dnia.

W tej samej sesji właściciel może sprawdzić, że salon nie włączył zadatku
w usługach (sekcja 3):

```sql
BEGIN READ ONLY;
SELECT count(*) FROM services WHERE salon_id = '<id salonu>' AND deposit_required;
ROLLBACK;
```

Oczekiwane: `0`.

### 4c. Zapis dnia 0

Dzień 0 to data założenia salonu, czyli początek 14-dniowego okresu
próbnego (regulamin pkt 12.1). Zespół zapisuje go w prywatnym systemie zadań,
w zgłoszeniu salonu, razem z:

- datą 14. dnia (koniec okresu próbnego bez przedłużenia),
- datą końca pilotażu ustaloną z salonem e-mailem (regulamin pkt 12.2),
- wynikami z 4a i 4b.

Do repozytorium nie trafia ani data powiązana z salonem, ani jego
identyfikator.

---

## 5. Przedłużenie pilotażu przed 14. dniem

Po 14. dniu panel salonu przechodzi w tryb tylko do odczytu. Przedłużenie
musi więc wejść **przed 14. dniem**. Najlepiej od razu po ustaleniu daty końca
pilotażu e-mailem, żeby salon nigdy nie zobaczył blokady.

Procedura: runbook kroku D, sekcja 9a („Przedłużenie okresu próbnego
salonu pilotażowego”). Stamtąd obowiązuje wszystko: kopia na żądanie przed
zmianą, data w UTC, jedna transakcja, odczyt przed zmianą i po zmianie, wpis
w dzienniku audytu bez danych salonu.

Krok kontrolny przed blokiem właściciela z sekcji 9a. Właściciel wpisuje
najpierw:

```bash
echo "P=${P:-BRAK}"
```

Jeśli wynik to `BRAK`, zmienna nie jest ustawiona i **bloku nie wklejamy.**
Najpierw ustawiamy zmienną, potem ponawiamy krok kontrolny. Dopiero wynik bez
`BRAK` pozwala wkleić blok.

---

## 6. Szablon treści zaproszenia

Krótko, po polsku. Bez cen. Bez obietnic funkcji zamrożonych (opinie,
faktury, program lojalnościowy ani inne moduły wyłączone w
`src/lib/features.ts`). Adres w szablonie to przykład.

> **Temat:** Zaproszenie do pilotażu MyHelper
>
> Dzień dobry,
>
> zapraszamy Państwa salon do pilotażu MyHelper: kalendarz wizyt, kartoteka
> klientów, usługi, pracownicy i rezerwacja online z potwierdzeniem SMS.
>
> **Ważne: konto proszę założyć wyłącznie na adres salon@example.com, na który
> przyszło to zaproszenie.** Na inny adres nie da się założyć salonu. Po
> rejestracji przyjdzie e-mail z linkiem potwierdzającym adres. Salon można
> założyć dopiero po kliknięciu tego linku.
>
> W pilotażu nie pobieramy żadnych opłat. Plan jest jeden i prosty. Termin
> końca pilotażu ustalimy z Państwem w osobnej wiadomości.
>
> **Prosimy na razie nie włączać zadatków** ani w usługach, ani u klientów.
> Napiszemy, kiedy będzie to możliwe.
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
   - bramka nadal wymaga potwierdzonego adresu, więc zaproszony musi
     kliknąć link potwierdzający na nowy adres.
4. Zmianę adresu zapisujemy w zgłoszeniu salonu w prywatnym systemie zadań
   (bez adresów w repozytorium). Dalej sekcja 4 bez zmian.
5. Jeśli zaproszony nie potwierdzi tożsamości kanałem z punktu 1, adresu nie
   dopisujemy. Konto na inny adres traktujemy jak każde konto spoza bety.
