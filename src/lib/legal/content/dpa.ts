/**
 * Treść dokumentu „Umowa powierzenia przetwarzania danych” (prosty markdown, patrz `parseLegalMarkdown`).
 *
 * Znaczniki `[DO UZUPEŁNIENIA: …]` wypełnia właściciel produktu. Dopóki
 * zostają w treści, test bramki publikacji nie pozwoli włączyć flagi.
 */
export const DPA_CONTENT = `Wersja: 28.11.2026 · obowiązuje od: 28.11.2026

## § 1. Strony i zawarcie umowy

1. **Administrator**: salon, czyli przedsiębiorca, który założył w Aplikacji MyHelper konto właściciela (dalej „Salon”).
2. **Podmiot przetwarzający**: AMD Dariusz Gradzik, ul. T. Kościuszki 19, 72-200 Nowogard, NIP 8561293713, REGON 811103360, e-mail: **kontakt@nordsignal.cc** (dalej „MyHelper”).
3. Umowa jest załącznikiem do Regulaminu i jest umową, o której mowa w art. 28 ust. 3 RODO. Strony zawierają ją w formie elektronicznej (art. 28 ust. 9 RODO).
4. Salon akceptuje umowę przy zakładaniu salonu **osobnym polem wyboru**, niezależnym od akceptacji Regulaminu. Bez akceptacji umowy nie da się założyć salonu.
5. MyHelper zapisuje przy koncie Salonu **wersję umowy, datę i godzinę akceptacji** oraz konto, które ją złożyło. Ten zapis jest dowodem zawarcia umowy.
6. Salon, który założył konto przed wprowadzeniem pola wyboru, akceptuje umowę odpowiedzią e-mail na wiadomość z jej treścią, wysłaną z adresu konta właściciela. MyHelper zapisuje wersję, datę i kopię wiadomości.
7. Nowa wersja umowy wiąże Salon po ponownej akceptacji albo w trybie zmiany Regulaminu (Regulamin, pkt 19), z prawem wypowiedzenia bez kosztów.

## § 2. Przedmiot, charakter i cel przetwarzania

1. Salon powierza MyHelper przetwarzanie danych osobowych w zakresie potrzebnym do świadczenia usługi opisanej w Regulaminie (pkt 3): kalendarz i rezerwacja wizyt, kartoteka klientów, powiadomienia SMS i e-mail, zadatki BLIK (obecnie niedostępne, Regulamin, pkt 8.2), lista oczekujących, opinie, pracownicy i moduły dodatkowe włączone przez Salon.
2. Charakter przetwarzania: zbieranie przez formularze Aplikacji, przechowywanie, porządkowanie, wyświetlanie uprawnionym osobom Salonu, wysyłka powiadomień, usuwanie danych.
3. MyHelper nie przetwarza powierzonych danych do własnych celów, nie sprzedaje ich i nie łączy z danymi innych salonów.
4. Funkcje AI są wyłączone i nie dostają powierzonych danych. Ich włączenie wymaga zmiany tej umowy i listy podprocesorów (§ 7).
5. Czas przetwarzania: czas trwania umowy o korzystanie z Aplikacji, a po jej zakończeniu okres z § 12.

## § 3. Kategorie osób i danych

| Kategoria osób | Kategorie danych |
|---|---|
| Klienci Salonu z kartoteką | imię i nazwisko, telefon, e-mail, data urodzin, notatki, preferencje, ulubiony pracownik, ustawienia zadatku, zgody marketingowe z datą, historia wizyt |
| Klienci Salonu: **informacje o zdrowiu** (dane szczególnej kategorii, art. 9 RODO) | alergie i inne informacje o zdrowiu wpisane do kartoteki, wraz z polem zgody klienta (§ 4) |
| Goście rezerwujący bez konta | imię i nazwisko, telefon, opcjonalnie e-mail, uwagi do wizyty; zapisane przy wizycie, bez kartoteki |
| Osoby rezerwujące (z kontem i bez) | termin, usługa, pracownik, status wizyty, kwota zadatku i informacja o wpłacie, treść i status wysłanych SMS-ów i e-maili |
| Osoby na liście oczekujących | dane z kartoteki założonej automatycznie przy zapisie (imię i nazwisko, e-mail, telefon z konta klienta), preferowane terminy |
| Autorzy opinii | ocena, komentarz, powiązanie z wizytą, pracownikiem i Salonem, odpowiedź Salonu |
| Pracownicy Salonu | dane wpisane przez Salon: imię i nazwisko, kontakt, grafik, usługi, tymczasowe uprawnienia |
| Właściciel Salonu | numer BLIK w treści SMS-ów zapisanych w historii powiadomień Salonu (§ 5) |

Zadatki są obecnie niedostępne (Regulamin, pkt 8.2). Dopóki ich nie włączymy, Aplikacja nie przyjmuje nowych zadatków i nie wysyła SMS-ów z numerem BLIK. Kategorie dotyczące zadatku obejmują do tego czasu wyłącznie dane zapisane wcześniej.

Dane kont użytkowników (logowanie, sesje), zapisy akceptacji dokumentów, dane techniczne ochrony przed nadużyciami (także te, które w imieniu MyHelper przetwarza Upstash, Inc.) i publiczne dane kontaktowe Salonu MyHelper przetwarza **jako administrator**, na zasadach Polityki prywatności. Ta umowa ich nie obejmuje.

## § 4. Informacje o zdrowiu w kartotece

1. Salon zapisuje informacje o zdrowiu klienta (np. alergie) **wyłącznie na podstawie wyraźnej zgody klienta** (art. 9 ust. 2 lit. a RODO) i zaznacza ją w polu zgody w kartotece. Salon kosmetyczny ani fryzjerski nie może opierać się na art. 9 ust. 2 lit. h RODO.
2. Salon odpowiada za odebranie zgody, jej treść, dowód i uwzględnienie jej wycofania (usunięcie informacji o zdrowiu z kartoteki).
3. MyHelper zapewnia dla tych danych: brak zapisu pól o zdrowiu, zgody i notatek w szkicach formularzy w przeglądarce; szyfrowanie transmisji i bazy; dostęp tylko dla personelu danego Salonu.
4. Gdy liczba salonów wzrośnie, MyHelper przeprowadzi ocenę skutków dla tych danych (art. 35 RODO) i udostępni Salonowi jej wnioski.

## § 5. Numer BLIK właściciela: dwie role

Zadatki są obecnie niedostępne (Regulamin, pkt 8.2). Dopóki ich nie włączymy, numer zapisany w ustawieniach nie trafia do osób rezerwujących ani do nowych SMS-ów. Pokazywanie numeru z ust. 1 zacznie się dopiero po włączeniu zadatków. Zapis numeru w ustawieniach (ust. 1) i SMS-y wysłane wcześniej (ust. 2) podlegają temu paragrafowi już dziś.

1. **MyHelper jest administratorem** numeru BLIK właściciela, gdy zapisuje go w ustawieniach i pokazuje osobom rezerwującym wizytę z zadatkiem, na ekranie po rezerwacji i w SMS-ie z danymi wpłaty. MyHelper sam określa, jak ta funkcja działa (Polityka prywatności, pkt 1a i 2).
2. **MyHelper jest podmiotem przetwarzającym** numer BLIK zapisany w treści wysłanych SMS-ów, które tworzą historię powiadomień Salonu. Historia powiadomień jest dokumentacją Salonu, a Salon jest jej administratorem. Dotyczy jej ta umowa.
3. Usunięcie numeru w ustawieniach kończy przetwarzanie z ust. 1 dla nowych rezerwacji. Nie usuwa numeru z SMS-ów już wysłanych ani z historii powiadomień.

## § 6. Polecenia Salonu, w tym okresy przechowywania

1. MyHelper przetwarza dane wyłącznie na udokumentowane polecenie Salonu (art. 28 ust. 3 lit. a RODO), także przy przekazywaniu danych do państw trzecich (§ 8). Poleceniem jest: ta umowa, Regulamin, konfiguracja i działania Salonu w Aplikacji oraz polecenia wysłane z adresu konta właściciela na kontakt@nordsignal.cc. Jeśli prawo UE albo polskie nakłada na MyHelper obowiązek przetwarzania, MyHelper informuje o nim Salon przed rozpoczęciem przetwarzania, chyba że prawo tego zabrania.
2. **Domyślne okresy przechowywania.** Akceptując umowę, Salon poleca stosować poniższe okresy. Salon może je zmienić poleceniem e-mail z ust. 1. Jeśli zmiany nie da się wykonać w Aplikacji, MyHelper informuje o tym Salon w ciągu 7 dni od polecenia i wykonuje zmianę ręcznie. Jeśli nie może jej wykonać także ręcznie, Salon może wypowiedzieć umowę o korzystanie z Aplikacji bez kosztów.
   1. **wizyty z danymi klienta:** 3 lata od końca roku kalendarzowego, w którym odbyła się wizyta; po tym czasie MyHelper usuwa dane osobowe przy wizycie, a zostają data, usługa i kwota. Ten okres obejmuje też rekordy, które zostały po usunięciu klienta (ust. 3): po jego upływie znika z nich także pracownik;
   2. **dane gościa bez konta zapisane przy wizycie:** jak w pkt 1;
   3. **historia powiadomień SMS:** 12 miesięcy od wysłania SMS-a, po tym czasie MyHelper ją usuwa;
   4. **kartoteka klienta:** do usunięcia przez Salon, najpóźniej do końca umowy (§ 12);
   5. **wpis na liście oczekujących:** do usunięcia przez klienta albo Salon, razem z kartoteką albo z kontem Salonu;
   6. **opinie i odpowiedzi:** do usunięcia przez Salon, najpóźniej do końca umowy.
3. **Usunięcie klienta.** Gdy Salon usuwa klienta z kartoteki, MyHelper w tej samej operacji usuwa jego dane kontaktowe i wolny tekst powiązany z nim poza kartoteką: uwagi i dane kontaktowe w jego wizytach, treść powiadomień, komentarze opinii, notatki z zabiegów, a także powiązanie wizyt z kontem klienta w portalu. Zostają wyłącznie: data i godzina wizyty, usługa, wariant, pracownik, status, kwoty (cena, rabat, zadatek i jego status) i ocena w opinii, najdłużej przez okres z ust. 2 pkt 1. Operacja nie obejmuje rezerwacji gościa bez konta, które nie są połączone z kartoteką, bo dopasowanie po telefonie albo e-mailu groziłoby usunięciem danych innej osoby. Takie rezerwacje Salon wskazuje poleceniem z ust. 1.
4. Gdy klient ma przyszłe wizyty albo wpłacony i niezwrócony zadatek, Aplikacja nie pozwala go usunąć, dopóki Salon nie odwoła wizyt albo nie rozliczy zadatku.
5. MyHelper niezwłocznie informuje Salon, jeśli jego zdaniem polecenie narusza RODO albo inne przepisy o ochronie danych (art. 28 ust. 3 zd. 2 RODO), i może wstrzymać jego wykonanie do wyjaśnienia.

## § 7. Dalsze powierzenie (podprocesorzy)

1. Salon udziela **ogólnej zgody** na korzystanie przez MyHelper z dalszych podmiotów przetwarzających (art. 28 ust. 2 RODO). Aktualna lista jest pod stałym adresem [/podprocesorzy](/podprocesorzy), z datą ostatniej zmiany. Lista na dzień zawarcia umowy jest w załączniku A.
2. **Powiadomienie o zmianie.** O zamiarze dodania albo zastąpienia podprocesora oraz o zmianie miejsca przetwarzania danych u obecnego podprocesora MyHelper informuje Salon e-mailem na adres konta właściciela co najmniej **14 dni** przed zmianą. Podaje nazwę, siedzibę, zakres danych i podstawę transferu.
3. **Prawo sprzeciwu.** Salon może w tym terminie zgłosić sprzeciw z uzasadnieniem na kontakt@nordsignal.cc. MyHelper odpowiada przed wprowadzeniem zmiany. Jeśli nie da się uwzględnić sprzeciwu, Salon może wypowiedzieć umowę o korzystanie z Aplikacji ze skutkiem na dzień zmiany, bez kosztów.
4. Wyjątek: w nagłym przypadku bezpieczeństwa (np. awaria albo naruszenie u podprocesora) MyHelper może zmienić podprocesora przed upływem terminu z ust. 2. Może to zrobić wyłącznie na czas potrzebny do usunięcia zagrożenia i wyłącznie na podmiot, który przetwarza dane w EOG i daje te same gwarancje ochrony danych. MyHelper informuje o tym Salon w ciągu 48 godzin od zmiany. Prawo sprzeciwu z ust. 3 przysługuje wtedy od otrzymania informacji.
5. MyHelper nakłada na każdego podprocesora w umowie te same obowiązki ochrony danych co w tej umowie, w szczególności co do bezpieczeństwa (art. 28 ust. 4 RODO), i odpowiada wobec Salonu za jego działania jak za własne.

## § 8. Przekazywanie danych poza EOG

1. Dane przechowujemy w EOG: serwery, baza danych i pliki w Google Cloud, region europe-central2 (Warszawa); SMS-y przez SMSAPI (Polska).
2. Salon poleca przekazywanie danych do USA w zakresie załącznika A: e-maile z Aplikacji przez Resend (Plus Five Five, Inc.).
3. Podstawą przekazania jest decyzja wykonawcza Komisji Europejskiej (UE) 2023/1795 w sprawie **EU-U.S. Data Privacy Framework**. Resend (Plus Five Five, Inc.) jest na oficjalnej liście tego programu. Gdyby odbiorca przestał być na tej liście, MyHelper zmienia podstawę przekazania na **standardowe klauzule umowne, moduł 3 (podmiot przetwarzający → podmiot przetwarzający)**, przyjęte decyzją wykonawczą Komisji (UE) 2021/914, dokumentuje ocenę skutków transferu i informuje Salon w trybie § 7 ust. 2.
4. MyHelper nie przekazuje danych do innych państw trzecich bez zmiany listy w trybie § 7.

## § 9. Obowiązki MyHelper (art. 28 ust. 3 lit. b–h RODO)

1. **Poufność (lit. b).** Dostęp do danych mają wyłącznie osoby upoważnione przez MyHelper i zobowiązane do zachowania poufności. Narzędzia automatyczne używane przy rozwoju Aplikacji łączą się z produkcyjną bazą danych wyłącznie w trybie tylko do odczytu, na czas kontroli po wdrożeniu uruchamianej przez MyHelper, i nie zmieniają w niej danych.
2. **Bezpieczeństwo (lit. c, art. 32).** MyHelper stosuje środki z załącznika B i aktualizuje je, gdy zmienia się ryzyko.
3. **Podprocesorzy (lit. d).** Zgodnie z § 7.
4. **Pomoc przy prawach osób (lit. e).** Gdy osoba, której dane dotyczą, zwróci się do MyHelper w sprawie danych Salonu, MyHelper przekazuje żądanie Salonowi **bez zbędnej zwłoki, nie później niż w ciągu 2 dni roboczych**, i sam nie odpowiada na nie co do istoty. Na polecenie Salonu MyHelper wykonuje czynności, których Salon nie może wykonać w Aplikacji (np. kopia danych), **w ciągu 7 dni** od polecenia, tak żeby Salon zmieścił się w terminie miesiąca (art. 12 ust. 3 RODO).
5. **Pomoc przy art. 32–36 (lit. f).** MyHelper pomaga Salonowi w zapewnieniu bezpieczeństwa, zgłaszaniu naruszeń, ocenie skutków i konsultacjach z organem, w zakresie informacji, którymi dysponuje (§ 10).
6. **Zakończenie (lit. g).** Zgodnie z § 12.
7. **Informacje i audyty (lit. h).** MyHelper udostępnia Salonowi informacje potrzebne do wykazania zgodności z art. 28 RODO, w pierwszej kolejności w formie dokumentów i odpowiedzi na pytania w ciągu 14 dni. Salon albo upoważniony przez niego audytor zobowiązany do poufności może przeprowadzić audyt po zapowiedzi z wyprzedzeniem co najmniej 14 dni, nie częściej niż raz w roku i na koszt Salonu, chyba że doszło do naruszenia albo żąda tego organ. Audyt nie obejmuje danych innych salonów ani infrastruktury podprocesorów poza ich własnymi raportami.

## § 10. Naruszenia ochrony danych

1. MyHelper zgłasza Salonowi naruszenie ochrony powierzonych danych **bez zbędnej zwłoki, nie później niż w ciągu 48 godzin od jego stwierdzenia**, e-mailem na adres konta właściciela, a przy wysokim ryzyku także telefonicznie albo SMS-em.
2. Zgłoszenie zawiera, w miarę dostępności (art. 33 ust. 3 RODO): charakter naruszenia, kategorie i przybliżoną liczbę osób i wpisów, możliwe skutki, podjęte i proponowane środki, kontakt do osoby udzielającej informacji. Informacje niedostępne od razu MyHelper uzupełnia etapami, bez zbędnej zwłoki.
3. O zgłoszeniu do Prezesa UODO (72 godziny, art. 33 ust. 1) i o zawiadomieniu osób (art. 34) decyduje Salon jako administrator. MyHelper nie zawiadamia osób ani organu w imieniu Salonu bez jego polecenia, chyba że wymaga tego prawo.
4. MyHelper dokumentuje każde naruszenie i podjęte działania oraz udostępnia Salonowi tę dokumentację.

## § 11. Obowiązki Salonu

1. Salon ma podstawę prawną do przetwarzania danych wpisywanych do Aplikacji i informuje o nim swoich klientów i pracowników (art. 13–14 RODO).
2. Salon wpisuje do Aplikacji tylko dane potrzebne do celu. W szczególności nie wpisuje informacji o zdrowiu do pól, które nie są na nie przeznaczone, ani bez zgody klienta (§ 4).
3. Salon nadaje pracownikom role i uprawnienia adekwatne do ich zadań i odbiera dostęp osobom, które przestały pracować w Salonie.
4. Salon niezwłocznie przekazuje MyHelper polecenia potrzebne do realizacji żądań osób (§ 9 ust. 4).

## § 12. Zakończenie umowy: zwrot i usunięcie danych

1. Umowa trwa tak długo jak umowa o korzystanie z Aplikacji i kończy się razem z nią.
2. **Zwrot.** Przez 30 dni od zakończenia umowy Salon może zażądać na kontakt@nordsignal.cc kopii swoich danych (kartoteka, wizyty, historia powiadomień) w formacie CSV. MyHelper przekazuje ją w ciągu 14 dni od żądania, bezpiecznym kanałem.
3. **Usunięcie.** Po upływie okresu z ust. 2 MyHelper usuwa wszystkie powierzone dane w ciągu 30 dni. Z kopii zapasowych dane znikają najpóźniej po upływie okresu ich przechowywania (załącznik B pkt 9). Do tego czasu kopie zapasowe służą wyłącznie do odtworzenia po awarii.
4. Na żądanie Salonu MyHelper potwierdza usunięcie e-mailem.
5. Obowiązek usunięcia nie dotyczy danych, które MyHelper przechowuje jako administrator (zapis akceptacji tej umowy i korespondencja w jej sprawie, § 13 ust. 5), ani danych, których przechowywania wymaga prawo UE albo polskie.

## § 13. Postanowienia końcowe

1. Odpowiedzialność stron wobec osób, których dane dotyczą, określa art. 82 RODO. Odpowiedzialność między stronami, w tym za roszczenia Salonu z art. 82 ust. 5 RODO, określa Regulamin, pkt 17. Limit z pkt 17.5 Regulaminu wynosi co najmniej 500 zł i nie dotyczy szkód wyrządzonych umyślnie ani z rażącego niedbalstwa. Wobec salonów z pkt 17.4 Regulaminu limit nie obowiązuje.
2. W sprawach nieuregulowanych stosuje się RODO, Regulamin i prawo polskie.
3. Jeśli ta umowa i Regulamin różnią się w sprawie ochrony danych, pierwszeństwo ma ta umowa.
4. Kontakt w sprawach umowy: **kontakt@nordsignal.cc**. MyHelper nie wyznaczył inspektora ochrony danych.
5. Zapis akceptacji (§ 1 ust. 5) i korespondencję dotyczącą umowy MyHelper przechowuje przez czas trwania umowy i 3 lata od końca roku, w którym umowa się zakończyła.

---

## Załącznik A. Podprocesorzy (stan na 28.11.2026)

Ci sami podprocesorzy są na stronie [/podprocesorzy](/podprocesorzy). Strona wymienia też Upstash, Inc., który przetwarza wyłącznie dane techniczne ochrony przed nadużyciami w imieniu MyHelper jako administratora (§ 3), a nie dane powierzone przez Salon.

| Podprocesor | Siedziba / miejsce przetwarzania | Zakres powierzonych danych | Cel | Podstawa transferu poza EOG |
|---|---|---|---|---|
| Google Cloud (Google Cloud Poland sp. z o.o., Warszawa) | region europe-central2 (Warszawa) | wszystkie powierzone dane, w tym pliki i kopie zapasowe | serwery, baza danych, przechowywanie plików, logi | brak transferu |
| SMSAPI (LINK Mobility Poland sp. z o.o., Gliwice) | Polska | numer telefonu odbiorcy, treść SMS-a | wysyłka SMS (potwierdzenia, lista oczekujących, a po włączeniu zadatków (obecnie niedostępne) także dane wpłaty) | brak transferu |
| Resend (Plus Five Five, Inc.) | USA | adres e-mail odbiorcy, temat, treść wiadomości | e-maile z Aplikacji | EU-U.S. DPF (decyzja (UE) 2023/1795); odbiorca jest na oficjalnej liście (§ 8 ust. 3) |

Płatności kartą i funkcje AI są wyłączone, więc ich dostawcy nie przetwarzają powierzonych danych. Ich włączenie wymaga zmiany listy w trybie § 7.

## Załącznik B. Środki bezpieczeństwa (art. 32 RODO)

1. Szyfrowanie transmisji (HTTPS) w całej Aplikacji.
2. Szyfrowanie bazy danych, plików i kopii zapasowych u dostawcy infrastruktury (Google Cloud), kluczami zarządzanymi przez Google.
3. Rozdzielenie danych salonów: personel ma dostęp tylko do danych własnego Salonu. Numer BLIK w ustawieniach widzi tylko właściciel.
4. Hasła wyłącznie jako skrót (hash). Sesja wygasa po 15 minutach bezczynności.
5. Ochrona formularzy przed podszyciem (token CSRF) oraz limity żądań i prób logowania, a po włączeniu zadatków (obecnie niedostępne) także limity rezerwacji z zadatkiem.
6. Numery BLIK i numery telefonów klientów nie są zapisywane w logach aplikacji. Linki z jednorazowymi tokenami (potwierdzenie e-mail, reset hasła) są wyłączone z logów serwera.
7. Pola o zdrowiu, zgoda i notatki nie trafiają do szkiców formularzy w przeglądarce. Szkice starsze niż 24 godziny nie są odtwarzane i są usuwane.
8. Sekrety (klucze dostawców) są przechowywane poza kodem, w menedżerze sekretów, a odczyty sekretów są zapisywane w dzienniku audytu.
9. Kopie zapasowe bazy: kopie automatyczne codziennie, przechowywane 7 dni, z możliwością odtworzenia stanu z dowolnej chwili w tym okresie; kopie wykonywane przed zmianami w systemie najdłużej 30 dni. Dane usunięte z Aplikacji znikają ze wszystkich kopii zapasowych najpóźniej po 30 dniach. Odtworzenie kopii zostało przećwiczone.
10. Dostęp administracyjny do produkcji ma wyłącznie właściciel MyHelper. Narzędzia automatyczne używane przy rozwoju Aplikacji działają na jego polecenie i pod jego nadzorem, z ograniczeniem z § 9 ust. 1. Każda zmiana kodu przechodzi recenzję i testy automatyczne przed wdrożeniem, a wdrożenie na produkcję, w tym zmiany struktury bazy danych, zatwierdza właściciel MyHelper.
`;
