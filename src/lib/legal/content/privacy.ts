/**
 * Treść dokumentu „Polityka prywatności” (prosty markdown, patrz `parseLegalMarkdown`).
 *
 * Znaczniki `[DO UZUPEŁNIENIA: …]` wypełnia właściciel produktu. Dopóki
 * zostają w treści, test bramki publikacji nie pozwoli włączyć flagi.
 */
export const PRIVACY_CONTENT = `Wersja: [DO UZUPEŁNIENIA: data publikacji] · obowiązuje od: [DO UZUPEŁNIENIA: data publikacji]

## 1. Kto odpowiada za Twoje dane

MyHelper to aplikacja do rezerwacji wizyt i prowadzenia salonu usługowego. Twoje dane trafiają do nas w dwóch rolach. Od roli zależy, kto za nie odpowiada.

**a) Sami decydujemy o danych (jesteśmy administratorem):**
- konta w aplikacji: właściciele salonów, pracownicy salonów i klienci z kontem w portalu klienta;
- konto salonu i jego okres próbny;
- numer BLIK właściciela salonu, gdy pokazujemy go osobom rezerwującym (pkt 2, „Numer BLIK”);
- dane salonu publikowane na liście salonów;
- dane techniczne: pliki cookie, logi serwera i adres IP używany do ochrony przed nadużyciami.

Administrator: AMD Dariusz Gradzik, ul. T. Kościuszki 19, 72-200 Nowogard, NIP 8561293713, REGON 811103360, e-mail: **kontakt@nordsignal.cc**.

**b) Przetwarzamy dane w imieniu salonu.** Gdy umawiasz wizytę albo salon prowadzi Twoją kartotekę, za Twoje dane odpowiada **ten salon**. MyHelper przechowuje je i przetwarza tylko na polecenie salonu, na podstawie [umowy powierzenia przetwarzania danych](/dpa). Salon akceptuje tę umowę przy zakładaniu salonu. Dotyczy to:
- kartoteki klienta,
- wizyt, także rezerwacji gościa bez konta,
- historii powiadomień SMS, także SMS-ów z numerem BLIK właściciela,
- listy oczekujących,
- zgód marketingowych zapisanych przez salon,
- opinii o wizytach i odpowiedzi salonu,
- danych pracowników wpisanych przez salon.

W sprawie tych danych (dostęp, poprawienie, usunięcie) najlepiej napisz do salonu. Jeśli napiszesz do nas, przekażemy prośbę salonowi bez zbędnej zwłoki.

## 2. Jakie dane przetwarzamy

### Konto w aplikacji (odpowiada MyHelper)
- imię i nazwisko, adres e-mail, numer telefonu (jeśli go podasz), rola w aplikacji;
- hasło: **nie przechowujemy go.** Zapisujemy tylko jego skrót (hash), z którego nie da się odtworzyć hasła;
- dane sesji: czas logowania, adres IP i informacja o przeglądarce. Sesja wygasa po 15 minutach bezczynności;
- dane salonu podane przy rejestracji i w ustawieniach: nazwa, adres, telefon i e-mail salonu, branża. Te dane kontaktowe są widoczne publicznie na liście salonów, bo na tym polega usługa zamówiona przez salon;
- przy zakładaniu salonu: zapis akceptacji regulaminu i umowy powierzenia (wersja dokumentu, data i konto, które go zaakceptowało).

Logowanie kontem Google jest dziś wyłączone. Konto zakładasz adresem e-mail i hasłem.

Bez imienia i nazwiska, adresu e-mail i hasła nie założysz konta. Numer telefonu w koncie jest dobrowolny.

### Numer BLIK właściciela salonu (odpowiada MyHelper)
Właściciel salonu może podać numer telefonu, na który klienci wpłacają zadatek BLIK-iem. Numer zapisujemy dopiero wtedy, gdy właściciel potwierdzi, że rozumie zasady jego pokazywania i chce włączyć wpłaty BLIK. Zapisujemy datę i wersję tego potwierdzenia. Zalecamy numer służbowy, nie prywatny. Gdy numer jest zapisany:
- **pokazujemy go każdej osobie, która zarezerwuje w tym salonie wizytę z zadatkiem, także gościowi bez konta.** Nie sprawdzamy, kim jest ta osoba;
- numer pojawia się na ekranie po rezerwacji i **w SMS-ie z danymi wpłaty**;
- treść tego SMS-a, razem z numerem, zostaje w historii powiadomień salonu, którą widzi personel salonu.

Właściciel może usunąć numer w ustawieniach. Od tej chwili numer nie trafia do nowych rezerwacji. Zostaje jednak w SMS-ach już wysłanych i w historii powiadomień salonu.

Pieniądze z zadatku płyną bezpośrednio na telefon właściciela, poza MyHelper. MyHelper nie widzi tych płatności i nie bierze w nich udziału. Wpłatę oznacza w aplikacji salon.

Podanie numeru jest dobrowolne. Bez niego salon nie przyjmie zadatku BLIK przez MyHelper.

### Rezerwacja wizyty (odpowiada salon)
- imię i nazwisko, numer telefonu, adres e-mail (u gościa opcjonalnie), uwagi do wizyty;
- termin, usługa, pracownik, status wizyty, kwota zadatku i informacja, czy salon oznaczył go jako wpłacony;
- historia SMS-ów wysłanych w związku z wizytą: treść (z imieniem i danymi wizyty), status i czas wysyłki.

Rezerwacja gościa bez konta **nie zakłada kartoteki klienta.** Dane gościa są zapisane tylko przy wizycie i w treści wysłanych SMS-ów. Do kartoteki trafiasz dopiero, gdy salon sam Cię do niej doda.

Bez imienia i numeru telefonu gość nie zarezerwuje wizyty. Na ten numer idzie potwierdzenie i, jeśli salon wymaga zadatku, dane wpłaty.

### Kartoteka klienta (odpowiada salon)
- dane kontaktowe, notatki, preferencje, data urodzin, ulubiony pracownik, ustawienia zadatku;
- **informacje o zdrowiu (np. alergie).** Salon może je zapisać tylko za Twoją wyraźną zgodą. Kartoteka ma pole na tę zgodę. Informacji o zdrowiu i notatek nie zapisujemy w szkicach formularzy w przeglądarce (pkt 8);
- zgody marketingowe (e-mail, SMS, telefon) z datą udzielenia, które zapisuje salon.

### Lista oczekujących (odpowiada salon)
Gdy jako klient z kontem zapiszesz się na listę oczekujących w salonie, w którym nie masz jeszcze kartoteki, **aplikacja sama zakłada Ci kartotekę w tym salonie.** Trafiają do niej imię i nazwisko, adres e-mail i telefon z Twojego konta. Od tej chwili salon widzi Cię wśród swoich klientów.

### Opinie (odpowiada salon)
Opinię o wizycie może wystawić tylko zalogowany klient, który zarezerwował tę wizytę ze swojego konta. Może to zrobić dopiero wtedy, gdy salon oznaczy wizytę jako zrealizowaną. Do jednej wizyty można wystawić jedną opinię. Opinia zawiera ocenę od 1 do 5 i może zawierać komentarz. Jest przypisana do salonu i do pracownika z tej wizyty.

Opinia jest publiczna dopiero po akceptacji przez salon. **Publicznie widać ją z Twoim imieniem i pierwszą literą nazwiska.** Salon może na opinię odpowiedzieć.

### Funkcje AI
Funkcje sztucznej inteligencji są w tej wersji aplikacji wyłączone i nie dostają żadnych danych. Jeśli je włączymy, najpierw zmienimy tę politykę.

### Dane techniczne (odpowiada MyHelper)
- adres IP osoby, która sprawdza wolne terminy albo rezerwuje wizytę, oraz numer telefonu gościa (porównywany po ostatnich 9 cyfrach). Służą jako klucze liczników, które chronią salony przed nadużyciami;
- logi serwera: adres IP, czas, adres strony, kod odpowiedzi i informacja o przeglądarce.

## 3. Po co przetwarzamy dane i na jakiej podstawie

| Cel | Podstawa (RODO) | Kto decyduje |
|---|---|---|
| Założenie i prowadzenie konta, logowanie, potwierdzenie adresu e-mail, reset hasła | art. 6 ust. 1 lit. b (umowa o korzystanie z aplikacji) | MyHelper |
| Prowadzenie konta salonu, w tym okresu próbnego | art. 6 ust. 1 lit. b (umowa) | MyHelper |
| Zapis akceptacji regulaminu i umowy powierzenia | art. 6 ust. 1 lit. f (prawnie uzasadniony interes: dowód zawarcia umowy) | MyHelper |
| Publikacja danych kontaktowych salonu na liście salonów | art. 6 ust. 1 lit. b (usługa zamówiona przez salon) | MyHelper |
| Pokazanie numeru BLIK właściciela osobom rezerwującym (ekran, SMS) | art. 6 ust. 1 lit. b (funkcja usługi, którą właściciel sam włącza) | MyHelper |
| Ochrona przed nadużyciami (limity żądań, prób logowania i rezerwacji z zadatkiem), logi serwera | art. 6 ust. 1 lit. f (prawnie uzasadniony interes: bezpieczeństwo usługi i ochrona salonów przed fałszywymi rezerwacjami) | MyHelper |
| Obsługa reklamacji, zgłoszeń treści i żądań dotyczących danych | art. 6 ust. 1 lit. c (obowiązki z prawa konsumenckiego, aktu o usługach cyfrowych i RODO) | MyHelper |
| Ustalenie, dochodzenie i obrona roszczeń | art. 6 ust. 1 lit. f (prawnie uzasadniony interes: ochrona przed roszczeniami) | MyHelper |
| Rezerwacja wizyty, SMS z potwierdzeniem i danymi wpłaty | określa salon (zwykle art. 6 ust. 1 lit. b, umowa o usługę salonu) | salon |
| Kartoteka klienta | określa salon (zwykle art. 6 ust. 1 lit. b lub f) | salon |
| Informacje o zdrowiu w kartotece | art. 9 ust. 2 lit. a (wyraźna zgoda klienta odebrana przez salon) | salon |
| Lista oczekujących | art. 6 ust. 1 lit. b, na prośbę klienta | salon |
| Opinie i ich moderacja | określa salon | salon |

**Decyzje automatyczne.** Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywołują skutki prawne albo podobnie istotnie na Ciebie wpływają (art. 22 RODO). Aplikacja stosuje proste limity bezpieczeństwa. Ogranicza liczbę niewpłaconych rezerwacji z zadatkiem z jednego numeru telefonu albo konta w salonie w ciągu doby oraz łączną liczbę takich rezerwacji w salonie w ciągu doby. Po przekroczeniu limitu nowej rezerwacji z zadatkiem nie da się złożyć do końca doby. Możesz wtedy skontaktować się z salonem bezpośrednio.

**Marketing.** MyHelper nie wysyła klientom salonów wiadomości marketingowych. Newslettery, życzenia urodzinowe i wiadomości „Tęsknimy” są w aplikacji wyłączone. Salon może zapisać zgody marketingowe klienta, ale aplikacja na ich podstawie niczego nie wysyła.

## 4. Komu przekazujemy dane

Pełna, aktualna lista dostawców, którzy przetwarzają dane w naszym imieniu, jest na stronie [Podprocesorzy](/podprocesorzy).

| Odbiorca | Gdzie przetwarza dane | Co dostaje | Po co |
|---|---|---|---|
| Google Cloud (Google Cloud Poland sp. z o.o., Warszawa) | region europe-central2 (Warszawa, Polska) | wszystkie dane w aplikacji, w tym wgrane zdjęcia, oraz logi serwera | serwery, baza danych, przechowywanie plików, logi |
| SMSAPI (LINK Mobility Poland sp. z o.o., Gliwice) | Polska | numer telefonu odbiorcy i treść SMS-a, **w tym numer BLIK właściciela w SMS-ie z danymi wpłaty** | wysyłka SMS-ów |
| Resend (Plus Five Five, Inc.) | USA | adres e-mail odbiorcy, temat i treść wiadomości | e-maile z aplikacji, np. potwierdzenie adresu e-mail i reset hasła |
| Upstash, Inc. | dane w regionie eu-central-1 (Frankfurt, Niemcy); spółka z siedzibą w USA | adres IP, numer telefonu gościa albo identyfikator salonu jako klucz licznika | ochrona przed nadużyciami |
| **Każda osoba rezerwująca wizytę z zadatkiem w danym salonie** | — | **numer BLIK właściciela salonu** | wpłata zadatku |
| Personel salonu | — | dane klientów i wizyt własnego salonu, historia powiadomień, opinie | obsługa klientów |
| Każdy odwiedzający listę salonów | — | dane kontaktowe salonu, zdjęcia z galerii salonu, zaakceptowane opinie z imieniem i pierwszą literą nazwiska autora | wybór salonu |

Skrypty aplikacji, w tym obsługę trybu offline, oraz czcionki serwujemy z własnej domeny. Przeglądarka nie pobiera ich z serwerów innych firm. Zdjęcia z galerii przeglądarka pobiera z przechowalni plików Google Cloud.

Nie korzystamy z narzędzi analitycznych ani reklamowych. Funkcje AI, generowanie grafik i wideo, powiadomienia push i płatności kartą są wyłączone i nie dostają danych.

Organy publiczne dostają dane tylko wtedy, gdy wymaga tego prawo.

## 5. Przekazywanie danych poza Europejski Obszar Gospodarczy

Serwery i baza danych (Google Cloud, Warszawa), SMS-y (SMSAPI, Polska) i liczniki nadużyć (Upstash, Frankfurt) przetwarzają dane w EOG.

Do USA mogą trafić dane przekazywane:
- **Resend (Plus Five Five, Inc.)**: e-maile z aplikacji;
- **Upstash, Inc.**: tylko gdy spółka z USA ma dostęp do danych przechowywanych we Frankfurcie, np. przy wsparciu technicznym.

Podstawą przekazania jest decyzja Komisji Europejskiej o odpowiednim stopniu ochrony w ramach **EU-U.S. Data Privacy Framework**, jeśli odbiorca jest na oficjalnej liście tego programu. W przeciwnym razie podstawą są **standardowe klauzule umowne** przyjęte decyzją Komisji (UE) 2021/914, zawarte w umowie powierzenia z dostawcą. Kopię zabezpieczeń dostaniesz, pisząc na kontakt@nordsignal.cc.

## 6. Jak długo przechowujemy dane

**Dane, za które odpowiadamy:**
- **Konto użytkownika:** do usunięcia konta. Usuwamy je na Twoją prośbę wysłaną na kontakt@nordsignal.cc, w ciągu miesiąca od jej otrzymania.
- **Sesja logowania:** wygasa po 15 minutach bezczynności i od tej chwili nie działa. Zapis wygasłej sesji (adres IP, informacja o przeglądarce) oraz wygasłe kody i linki weryfikacyjne (z adresem e-mail) usuwamy automatycznie raz na dobę.
- **Numer BLIK właściciela:** do usunięcia przez właściciela w ustawieniach albo do usunięcia salonu. Kopie w treści wysłanych SMS-ów należą do historii powiadomień salonu (niżej).
- **Zapis akceptacji regulaminu i umowy powierzenia:** przez czas trwania umowy i 3 lata od końca roku, w którym umowa się zakończyła (okres przedawnienia roszczeń).
- **Logi serwera:** 30 dni, potem usuwa je automatycznie Google Cloud.
- **Kopie zapasowe bazy:** kopie automatyczne powstają codziennie i są przechowywane 7 dni, z możliwością odtworzenia stanu z dowolnej chwili w tym okresie. Kopie wykonywane przed zmianami w systemie przechowujemy najdłużej 30 dni. Dane usunięte z aplikacji znikają ze wszystkich kopii zapasowych najpóźniej po 30 dniach.
- **Dane salonu po zakończeniu umowy:** salon może zażądać kopii swoich danych przez 30 dni od zakończenia umowy. Potem usuwamy je w ciągu 30 dni.
- **Korespondencja w sprawie reklamacji, zgłoszeń treści i żądań dotyczących danych:** 3 lata od końca roku, w którym zamknęliśmy sprawę (okres przedawnienia roszczeń).

**Dane, za które odpowiada salon.** Okresy niżej to domyślne polecenia z umowy powierzenia. Salon może je zmienić.
- **Kartoteka klienta:** do usunięcia przez salon, najpóźniej do końca umowy z salonem. Gdy salon usuwa klienta, usuwamy też jego dane kontaktowe i wolny tekst z jego wizyt, powiadomień i opinii, a także powiązanie wizyt z kontem w portalu klienta. Zostają dane potrzebne salonowi do rozliczeń: data i godzina wizyty, usługa, pracownik, status, kwoty, a przy opinii sama ocena, bez komentarza i bez danych autora. Rezerwacji gościa bez konta, której salon nie połączył z kartoteką, ta operacja nie obejmuje.
- **Wizyty z danymi klienta:** 3 lata od końca roku kalendarzowego, w którym odbyła się wizyta. Potem usuwamy dane osobowe przy wizycie. Zostają data, usługa i kwota.
- **Rezerwacja gościa bez konta:** tak samo jak wizyty z danymi klienta.
- **Historia powiadomień SMS:** 12 miesięcy od wysłania SMS-a, potem ją usuwamy.
- **Lista oczekujących:** do usunięcia wpisu przez klienta albo salon, razem z kartoteką klienta albo z salonem.
- **Opinie i odpowiedzi salonu:** do usunięcia przez salon, najpóźniej do końca umowy z salonem.
- **Tymczasowe uprawnienia personelu:** przestają działać w ustawionym terminie.

## 7. Twoje prawa

Masz prawo do:
- dostępu do swoich danych i otrzymania ich kopii,
- poprawienia danych,
- usunięcia danych,
- ograniczenia przetwarzania,
- przeniesienia danych,
- sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie (art. 6 ust. 1 lit. f),
- wycofania zgody w dowolnej chwili. Wycofanie nie wpływa na zgodność z prawem przetwarzania przed wycofaniem. Dotyczy to zgody na zapis informacji o zdrowiu w kartotece; wycofujesz ją u salonu,
- skargi do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).

Jak to załatwić:
- Jako klient z kontem sam usuwasz w aplikacji swój wpis z listy oczekujących. Właściciel salonu sam zmienia albo usuwa numer BLIK i dane salonu w ustawieniach.
- Pozostałe sprawy (usunięcie konta, kopia danych, poprawienie imienia, e-maila albo telefonu w koncie) załatwiamy na prośbę wysłaną na **kontakt@nordsignal.cc**. Aplikacja nie ma dziś przycisku usunięcia konta ani eksportu danych, więc prośby wykonujemy ręcznie, **w ciągu miesiąca** od otrzymania. Przy dużej liczbie albo złożoności żądań termin może się wydłużyć o kolejne dwa miesiące. Wtedy poinformujemy Cię o tym w ciągu pierwszego miesiąca.
- Możemy poprosić o potwierdzenie tożsamości, np. wiadomością z adresu e-mail przypisanego do konta.

W sprawie danych, które prowadzi salon (wizyty, kartoteka, lista oczekujących, opinie), napisz do salonu (pkt 1b). Jeśli napiszesz do nas, przekażemy prośbę salonowi.

## 8. Pliki cookie i pamięć przeglądarki

Nie używamy cookie reklamowych ani narzędzi analitycznych. Wszystko, co zapisujemy w przeglądarce, jest niezbędne do działania usługi, której chcesz użyć. Dlatego nie prosimy o zgodę (art. 399 ust. 3 pkt 2 Prawa komunikacji elektronicznej).

**Cookie niezbędne:**
- cookie sesji logowania, ważne do wylogowania albo 15 minut bezczynności;
- \`csrf-token\`, czyli zabezpieczenie formularzy przed podszyciem.

**Pamięć przeglądarki (localStorage)** na Twoim urządzeniu:
- szkice niewysłanych formularzy, żeby nie zginęły przy odświeżeniu strony: rejestracja (imię, e-mail), dodanie klienta (imię, nazwisko, telefon, e-mail), dodanie pracownika, usługi, produktu, rabatu. **Informacji o zdrowiu (alergie), zgody na ich zapis i notatek nie zapisujemy w szkicach.** Szkic znika po wysłaniu albo odrzuceniu formularza. Szkicu starszego niż 24 godziny aplikacja już nie odtwarza i usuwa go przy następnym otwarciu aplikacji, a przy otwartej aplikacji w ciągu kilkunastu minut. Limit dotyczy kopii w przeglądarce, nie formularza, który masz otwarty na ekranie;
- \`pwa-install-dismissed\`, czyli informacja, kiedy zamknięto propozycję instalacji aplikacji;
- wybrany motyw (jasny albo ciemny).

Te dane nie są wysyłane do nas. Usuniesz je, czyszcząc dane strony w przeglądarce. Na wspólnym komputerze w salonie szkic formularza może zobaczyć następna osoba. Wylogowuj się i nie zostawiaj niewysłanych formularzy.

## 9. Bezpieczeństwo

- Całą komunikację z aplikacją szyfrujemy (HTTPS).
- Baza danych, pliki i kopie zapasowe są szyfrowane u dostawcy infrastruktury (Google Cloud), kluczami zarządzanymi przez Google.
- Hasła przechowujemy wyłącznie jako skrót (hash).
- Personel każdego salonu ma dostęp tylko do danych własnego salonu. Numer BLIK w ustawieniach widzi tylko właściciel salonu.
- Numerów BLIK i numerów telefonów klientów nie zapisujemy w logach.

## 10. Kontakt i zmiany polityki

Kontakt w sprawie danych osobowych: **kontakt@nordsignal.cc**. Nie wyznaczyliśmy inspektora ochrony danych.

O zmianie polityki informujemy w aplikacji i e-mailem do właścicieli salonów co najmniej 14 dni przed jej wejściem w życie. Zmiana zasad pokazywania numeru BLIK wymaga ponownego potwierdzenia przez właściciela.
`;
