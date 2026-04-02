# MyHelper — Instrukcja użytkownika

> Wersja dokumentacji: marzec 2026
> Dotyczy: Panel właściciela salonu, Portal klienta, Asystent AI

---

## Spis treści

1. [Czym jest MyHelper?](#1-czym-jest-myhelper)
2. [Pierwsze kroki — rejestracja i konfiguracja salonu](#2-pierwsze-kroki)
3. [Dashboard — główny ekran](#3-dashboard)
4. [Kalendarz i wizyty](#4-kalendarz-i-wizyty)
5. [Klienci](#5-klienci)
6. [Pracownicy](#6-pracownicy)
7. [Usługi](#7-uslugi)
8. [Magazyn (produkty)](#8-magazyn)
9. [Promocje i kody rabatowe](#9-promocje)
10. [Raporty i statystyki](#10-raporty)
11. [Faktury i paragony](#11-faktury-i-paragony)
12. [Galeria zdjęć](#12-galeria)
13. [Powiadomienia](#13-powiadomienia)
14. [Lista oczekujących](#14-lista-oczekujacych)
15. [Asystent AI (plan Pro)](#15-asystent-ai)
16. [Generator treści (plan Pro)](#16-generator-tresci)
17. [Portal klienta](#17-portal-klienta)
18. [Ustawienia](#18-ustawienia)
19. [Subskrypcja i plany](#19-subskrypcja)
20. [Aplikacja mobilna (PWA)](#20-pwa)
21. [Najczęściej zadawane pytania (FAQ)](#21-faq)

---

## 1. Czym jest MyHelper?

MyHelper to kompleksowy system zarządzania salonem — alternatywa dla Booksy przeznaczona dla małych i średnich firm usługowych: salonów kosmetycznych, fryzjerów, gabinetów SPA i innych.

**Co możesz zrobić z MyHelper:**

- Prowadzić kalendarz wizyt pracowników w czasie rzeczywistym
- Przyjmować rezerwacje online od klientów (bez pośredników)
- Pobierać zadatki przed wizytą (Stripe, Blik)
- Zarządzać bazą klientów z historią wizyt i notatkami
- Śledzić zużycie produktów i stan magazynu
- Tworzyć promocje, kody rabatowe i program lojalnościowy
- Generować raporty finansowe, kadrowe i marketingowe
- Wystawiać faktury i paragony fiskalne
- Korzystać z AI do analizy biznesowej i tworzenia treści (plan Pro)

---

## 2. Pierwsze kroki

### 2.1 Rejestracja

1. Wejdź na stronę główną MyHelper i kliknij **Zarejestruj się**.
2. Wypełnij formularz: imię, nazwisko, adres e-mail, hasło.
3. Możesz również zalogować się przez konto Google (przycisk **Kontynuuj z Google**).
4. Po rejestracji zostaniesz przekierowany do dashboardu.

### 2.2 Tworzenie salonu

Przy pierwszym logowaniu pojawi się formularz **Utwórz salon**. Wypełnij:

- **Nazwa salonu** — wyświetlana klientom w portalu
- **Typ działalności** — np. salon fryzjerski, kosmetyczny, SPA
- **Adres** — miasto, ulica, kod pocztowy
- **Telefon** — numer kontaktowy

Po zapisaniu zostaniesz właścicielem salonu i uzyskasz pełny dostęp do panelu.

### 2.3 Wybór planu

Po utworzeniu salonu możesz wybrać plan subskrypcji:

| Plan | Cena | Opis |
|------|------|------|
| **Basic** | 49 PLN/mies. | Pełne zarządzanie salonem bez AI |
| **Pro** | 149 PLN/mies. | Basic + Asystent AI, Generator treści, Rekomendacje |

Oba plany mają **14-dniowy okres próbny bez zobowiązań**. Możesz zacząć bezpłatnie i wybrać plan w dowolnym momencie.

---

## 3. Dashboard

Po zalogowaniu trafiasz na stronę główną — dashboard. Wyświetla ona:

### 3.1 Rekomendacje AI (tylko Pro)

Na górze dashboardu (plan Pro) widoczne są dwa widgety:

- **Rekomendacje dzienne** — sugestie działań na dziś (np. zadzwoń do klienta, który nie odwiedził Cię od 3 miesięcy)
- **Rekomendacje tygodniowe** — analizy trendów i prognoz na bieżący tydzień

### 3.2 Szybkie akcje

Przyciski skrótów do najczęstszych działań:
- Nowa wizyta
- Nowy klient
- Nowa usługa
- Otwórz kalendarz

### 3.3 Statystyki dnia

Karty z danymi bieżącego dnia:
- Liczba wizyt zaplanowanych na dziś
- Przychód dnia
- Liczba klientów obsłużonych w tym miesiącu
- Wskaźnik anulacji

### 3.4 Wizyty na dziś

Lista wszystkich wizyt zaplanowanych na bieżący dzień z możliwością szybkiego przejścia do szczegółów.

### 3.5 Pracownicy na dziś

Przegląd dostępności i harmonogramu pracowników na bieżący dzień.

---

## 4. Kalendarz i wizyty

### 4.1 Widok kalendarza

Przejdź do **Dashboard → Kalendarz** lub kliknij skrót na dashboardzie.

Kalendarz pokazuje:
- Wizyty wszystkich pracowników w widoku tygodniowym
- Kolorowe oznaczenia per pracownik
- Blokady czasu (urlopy, przerwy)
- Status wizyty: zaplanowana, zakończona, anulowana

**Nawigacja:**
- Strzałki `<` `>` — poprzedni/następny tydzień
- Przycisk **Dziś** — powrót do bieżącego tygodnia
- Kliknij na slot w kalendarzu — utwórz nową wizytę

### 4.2 Tworzenie wizyty

Kliknij wolny slot w kalendarzu lub przycisk **+ Nowa wizyta**. Wypełnij:

1. **Klient** — wybierz z bazy lub wpisz nowego
2. **Pracownik** — kto wykona usługę
3. **Usługa** — wybierz z listy (z wariantami cenowymi)
4. **Data i godzina** — ustaw termin
5. **Notatki** — opcjonalne uwagi

Kliknij **Zapisz**.

### 4.3 Szczegóły wizyty

Kliknij wizytę na kalendarzu lub listę wizyt, by otworzyć szczegóły. Znajdziesz tu:

- **Informacje podstawowe** — klient, pracownik, usługa, czas, cena
- **Status zadatku** — czy wpłacono zadatek i jaka kwota
- **Notatki** — możesz dodać notatki przed i po wizycie
- **Zużyte materiały** — produkty użyte podczas wizyty (do rozliczenia kosztów)
- **Karta zabiegu** — dokumentacja wykonanego zabiegu
- **Prowizja pracownika** — automatycznie obliczona na podstawie ustawień
- **Faktura / Paragon fiskalny** — możliwość wystawienia dokumentu

### 4.4 Zakończenie wizyty

Kliknij przycisk **Zakończ wizytę** na stronie szczegółów. W oknie dialogowym:

1. Potwierdź użyte materiały (produkty ze stanu magazynu)
2. Opcjonalnie dodaj notatkę zabiegową
3. AI może automatycznie wygenerować podsumowanie wizyty (plan Pro)
4. Zatwierdź — status wizyty zmienia się na **Zakończona**

### 4.5 Edycja i anulowanie wizyty

- **Edycja** — kliknij ikonę ołówka, zmień datę/godzinę/usługę/pracownika
- **Anulowanie** — zmień status na **Anulowana**. Jeśli wpłacono zadatek, pojawi się opcja zwrotu.

### 4.6 Rezerwacja online przez panel właściciela

Przejdź do **Dashboard → Rezerwacja** aby umówić wizytę w imieniu klienta krok po kroku przez uproszczony kreator.

---

## 5. Klienci

### 5.1 Lista klientów

**Dashboard → Klienci** — pełna baza klientów salonu.

Możliwości:
- **Wyszukiwanie** — po imieniu, nazwisku, telefonie, emailu
- **Filtry** — data dodania, data ostatniej wizyty, flaga alergii
- **Sortowanie** — po nazwisku, dacie dodania

### 5.2 Dodawanie klienta

Kliknij **+ Nowy klient** i wypełnij:
- Imię i nazwisko (wymagane)
- Telefon
- Email
- Notatki (np. alergie, preferencje)

System automatycznie odzyskuje niezapisany formularz (crashguard) — jeśli okno zostało zamknięte podczas wypełniania, formularz zostanie przywrócony.

### 5.3 Profil klienta

Kliknij na klienta z listy, aby otworzyć jego profil. Dostępne zakładki:

- **Informacje** — dane kontaktowe, data urodzin, notatki
- **Historia wizyt** — wszystkie wizyty z filtrami
- **Punkty lojalnościowe** — saldo punktów i historia transakcji
- **Analiza AI** (plan Pro) — ocena ryzyka churnu, trendy, sugestie działań

### 5.4 Wiadomości i powiadomienia

Z poziomu profilu klienta możesz ręcznie wysłać:
- Przypomnienie o wizycie
- Wiadomość urodzinową
- Ofertę powitalną (dla klientów po dłuższej nieobecności — "Tęsknimy za Tobą")

---

## 6. Pracownicy

### 6.1 Lista pracowników

**Dashboard → Pracownicy** — zarządzanie zespołem.

Każdy pracownik ma:
- Imię i nazwisko
- Rolę (Pracownik / Właściciel / Recepcja)
- Status (Aktywny / Nieaktywny)
- Kolor identyfikacyjny (widoczny w kalendarzu)
- Przypisane usługi

### 6.2 Dodawanie pracownika

Kliknij **+ Dodaj pracownika** i wypełnij formularz. Po zapisaniu pracownik pojawia się w kalendarzu.

### 6.3 Edycja pracownika

Kliknij ikonę ołówka przy pracowniku. W oknie edycji możesz:
- Zmienić dane osobowe i kontaktowe
- Zmienić rolę
- Aktywować / dezaktywować konto
- Przypisać usługi, które pracownik może wykonywać

### 6.4 Harmonogram pracy

Kliknij **Harmonogram** przy pracowniku. Tu możesz:
- Ustawić standardowe godziny pracy per dzień tygodnia
- Dodać wyjątki (urlopy, nieobecności)
- Przeglądać zajętość

### 6.5 Role i uprawnienia

| Rola | Co może robić |
|------|--------------|
| **Właściciel** | Pełny dostęp: dashboard, ustawienia, raporty, pracownicy, promocje, finanse |
| **Pracownik** | Własny kalendarz, podgląd swojego harmonogramu, galeria, własne statystyki |
| **Recepcja** | Umawianie wizyt, kartoteka klientów, podgląd kalendarza wszystkich pracowników |

---

## 7. Usługi

### 7.1 Zarządzanie usługami

**Dashboard → Usługi** — lista wszystkich oferowanych usług.

Każda usługa ma:
- Nazwę i opis
- Kategorię
- Czas trwania
- Warianty cenowe (np. krótkie / długie włosy, podstawowy / premium)
- Produkty zużywane podczas wykonywania (do śledzenia kosztów)
- Ilustrację (można wygenerować AI — plan Pro)

### 7.2 Dodawanie usługi

Kliknij **+ Nowa usługa**:
1. Wpisz nazwę i wybierz kategorię
2. Ustaw czas trwania
3. Dodaj warianty cenowe
4. Przypisz produkty zużywane podczas zabiegu
5. Opcjonalnie dodaj opis (AI może go wygenerować — plan Pro)

### 7.3 Kategorie usług

Usługi można grupować w kategorie (np. Strzyżenie, Koloryzacja, Pedicure). AI może automatycznie zaproponować kategorię dla nowej usługi.

---

## 8. Magazyn

### 8.1 Lista produktów

**Dashboard → Produkty** — zarządzanie stanem magazynowym.

Każdy produkt ma:
- Nazwę i kategorię
- Aktualny stan magazynowy
- Próg minimalny (poniżej tego system wyśle alert)
- Cenę jednostkową (do kalkulacji kosztów zabiegów)
- Jednostkę miary (ml, szt., g itp.)

### 8.2 Alerty niskiego stanu

System automatycznie wysyła powiadomienie gdy stan produktu spadnie poniżej ustawionego progu. Widoczne w sekcji Powiadomienia.

### 8.3 Zużycie produktów przy wizycie

Podczas kończenia wizyty można odnotować zużyte produkty. System automatycznie:
- Odejmuje ilość od stanu magazynu
- Kalkuluje koszt materiałów dla wizyty
- Uwzględnia to w raporcie rentowności usług

### 8.4 Historia zużycia

Na stronie szczegółów produktu widoczna jest historia zużycia z podziałem na wizyty i pracowników.

---

## 9. Promocje

### 9.1 Promocje

**Dashboard → Promocje** — tworzenie i zarządzanie rabatami.

Typy promocji:
- **Procentowa** — np. -20% na wszystkie usługi
- **Kwotowa** — np. -50 PLN od wartości koszyka
- **Happy Hours** — zniżka w określonych godzinach i dniach tygodnia

Każda promocja może być ograniczona do:
- Konkretnych usług
- Przedziału dat (np. tylko w lutym)
- Konkretnych godzin (Happy Hours)

### 9.2 Kody promocyjne

**Dashboard → Kody promocyjne** — jednorazowe lub wielokrotne kody zniżkowe.

Klient może użyć kodu podczas rezerwacji online w portalu klienta.

### 9.3 Generator banerów AI (plan Pro)

W sekcji Promocje dostępny jest **Generator banerów AI**:
1. Wpisz tekst promocji
2. Wybierz styl (nowoczesny, vintage, luksusowy)
3. Wybierz format (Instagram, Facebook Post, Facebook Cover)
4. AI generuje tło (Google Imagen), nakłada tekst
5. Pobierz gotowy baner

### 9.4 Program lojalnościowy

Skonfiguruj w **Ustawienia → Program lojalnościowy**:
- Ile punktów przyznawać za każdą złotówkę wydaną
- Nagrody za określoną liczbę punktów
- Komunikacja o zdobytych punktach

Klienci widzą swoje punkty w portalu klienta.

---

## 10. Raporty

**Dashboard → Raporty** — kompleksowe analizy biznesowe.

### 10.1 Raporty finansowe

| Raport | Opis |
|--------|------|
| **Przychody** | Analiza przychodów w wybranym okresie, z podziałem na usługi, pracowników i dni tygodnia |
| **Materiały** | Zużycie produktów i koszty materiałów w ujęciu wartościowym |
| **Rentowność usług** | Marża na każdej usłudze po odjęciu kosztów materiałów |
| **Zysk/Strata materiałów** | Porównanie kosztów zakupu produktów z przychodem z usług, w których były użyte |

### 10.2 Raporty kadrowe

| Raport | Opis |
|--------|------|
| **Obciążenie pracowników** | Procent zajętości każdego pracownika w wybranym okresie |
| **Popularność pracowników** | Ranking pracowników według liczby wizyt i ocen klientów |
| **Wynagrodzenia** | Raport wynagrodzeń i prowizji — do wypłat i rozliczeń |

### 10.3 Raporty marketingowe

| Raport | Opis |
|--------|------|
| **Popularność usług** | Ranking najczęściej rezerwowanych usług |
| **Efektywność promocji** | Jak wiele wizyt/przychodów wygenerowały poszczególne promocje |
| **Anulacje** | Statystyki odwołań — kiedy, przez kogo i jakie usługi są najczęściej anulowane |

### 10.4 Porównania

| Raport | Opis |
|--------|------|
| **Porównanie miesięczne** | Zestawienie wyników miesiąc do miesiąca (np. luty vs marzec) |
| **Porównanie roczne** | Zestawienie wyników rok do roku (np. 2025 vs 2026) |

Wszystkie raporty można **eksportować do Excel** (przycisk w prawym górnym rogu każdego raportu).

---

## 11. Faktury i paragony

### 11.1 Wystawianie faktury

Na stronie szczegółów wizyty kliknij **Wystaw fakturę**:
1. System pobierze dane klienta (można uzupełnić NIP dla faktur firmowych)
2. Pozycje faktury są generowane automatycznie z usługi i materiałów
3. Zatwierdź i pobierz PDF

### 11.2 Paragon fiskalny

Na stronie szczegółów wizyty kliknij **Drukuj paragon**:
1. System wymaga skonfigurowanej drukarki fiskalnej (Ustawienia → Drukarka fiskalna)
2. Paragon jest generowany i wysyłany do drukarki
3. Zapis paragonu pozostaje w systemie

### 11.3 Lista faktur

**Dashboard → Faktury** — archiwum wszystkich wystawionych dokumentów z możliwością ponownego pobrania PDF.

---

## 12. Galeria

**Dashboard → Galeria** — zarządzanie zdjęciami salonu.

Możliwości:
- Dodawanie zdjęć (prac, wnętrza, efektów zabiegów)
- Organizacja w albumy
- Zdjęcia wyświetlają się klientom na profilu salonu w portalu
- Ulepszanie zdjęć przez AI (plan Pro) — 7 presetów ulepszenia

**Ulepszenie zdjęcia AI (plan Pro):**
1. Kliknij na zdjęcie w galerii
2. Wybierz **Ulepsz zdjęcie**
3. Wybierz preset (np. rozjaśnienie, wyostrzenie, korekcja kolorów)
4. AI (Sharp + model Google) przetworzy obraz
5. Nowe zdjęcie zastępuje oryginał lub jest zapisywane jako osobna wersja

---

## 13. Powiadomienia

**Dashboard → Powiadomienia** — centrum zarządzania komunikacją z klientami.

### 13.1 Automatyczne powiadomienia

System automatycznie wysyła:
- **Potwierdzenie rezerwacji** — zaraz po umówieniu wizyty
- **Przypomnienie** — 24h przed wizytą (SMS i/lub email)
- **Wiadomość urodzinowa** — w dniu urodzin klienta (jeśli podał datę)
- **Alert "Tęsknimy za Tobą"** — po określonej liczbie dni bez wizyty
- **Alert niskiego stanu magazynu** — gdy produkt spada poniżej progu

### 13.2 Konfiguracja powiadomień

**Ustawienia → Powiadomienia** — tu możesz:
- Edytować szablony wiadomości SMS i email
- Włączyć/wyłączyć poszczególne typy powiadomień
- Ustawić czas wyprzedzenia dla przypomnień
- Konfigurować powiadomienia push (web push)

### 13.3 Personalizacja AI (plan Pro)

System może personalizować treść powiadomień na podstawie historii klienta — np. przypomnienie wspominające konkretną usługę z poprzedniej wizyty.

---

## 14. Lista oczekujących

**Dashboard → Lista oczekujących** — klienci czekający na wolny termin.

Gdy klient w portalu klienta nie znajdzie wolnego terminu, może dołączyć do listy oczekujących na daną usługę. Gdy pojawi się wolne miejsce (anulacja lub nowy slot), system powiadomi oczekujących.

---

## 15. Asystent AI (plan Pro)

> Ta sekcja dostępna jest wyłącznie dla użytkowników planu **Pro (149 PLN/mies.)**.

**Dashboard → Asystent AI** — cztery narzędzia AI.

### 15.1 Asystent głosowy

Konfiguracja automatycznego odbierania połączeń przez AI:

1. Przejdź do **Asystent AI → Asystent głosowy**
2. Skonfiguruj numer Twilio (lub użyj istniejącego)
3. AI (głos ElevenLabs) odbiera połączenia, gdy jesteś niedostępny
4. Może umawiać, przekładać i anulować wizyty przez telefon
5. Nagrania rozmów i podsumowania dostępne w panelu

### 15.2 Asystent biznesowy

Chat AI z pełnym kontekstem Twojego salonu:

1. Przejdź do **Asystent AI → Asystent biznesowy**
2. Zadawaj pytania po polsku, np.:
   - "Który pracownik zarobił najwięcej w zeszłym miesiącu?"
   - "Jakie usługi są najpopularniejsze w piątki?"
   - "Ilu klientów nie było u mnie od ponad 2 miesięcy?"
3. AI analizuje dane Twojego salonu i odpowiada z konkretnymi liczbami
4. Możesz też pisać na czacie: **Dashboard → Chat AI**

### 15.3 Analiza trendów

**Asystent AI → Analiza trendów** — identyfikacja wzorców:
- Porównania tygodniowe i miesięczne
- Trendy w popularności usług
- Prognozy przychodu na najbliższy miesiąc
- Analiza sezonowości

### 15.4 Chat AI

**Chat** — swobodna rozmowa z asystentem AI, który zna kontekst Twojego salonu. Dostępny z dowolnego miejsca w aplikacji (pływający przycisk mikrofonu na dole ekranu).

### 15.5 Rekomendacje na dashboardzie

Automatycznie wyświetlane na głównym ekranie dashboardu:
- **Rekomendacje dzienne** — priorytety na dziś
- **Rekomendacje tygodniowe** — cele na ten tydzień

### 15.6 Analiza klienta AI

Na profilu klienta zakładka **Analiza AI** pokazuje:
- Ryzyko churnu (czy klient może zrezygnować)
- Rekomendowane działania (np. "Zadzwoń z ofertą powitalną")
- Trendy wydatków

### 15.7 Monitorowanie kosztów AI

**Dashboard → Użycie AI** — podgląd kosztów i zużycia tokenów AI. Możesz ustawić limity miesięczne.

---

## 16. Generator treści (plan Pro)

> Ta sekcja dostępna jest wyłącznie dla użytkowników planu **Pro (149 PLN/mies.)**.

**Dashboard → Generator treści** — AI tworzy treści marketingowe.

### 16.1 Posty social media

1. Kliknij **Posty social media**
2. Wybierz platformę (Instagram, Facebook, TikTok)
3. Podaj temat lub wybierz usługę
4. AI generuje angażujący post z hashtagami
5. Skopiuj lub zaplanuj publikację

### 16.2 Opisy usług

AI generuje profesjonalne opisy usług przyciągające klientów. Użyj podczas tworzenia lub edytowania usługi.

### 16.3 Newslettery

1. Kliknij **Newslettery**
2. Wybierz temat (promocja, nowość, sezonowy)
3. AI tworzy treść newslettera
4. Edytuj i wyślij do bazy klientów

### 16.4 Szablony treści

Gotowe szablony do szybkiego tworzenia treści:
- Szablony ogłoszeń
- Szablony wiadomości powitalnych
- Szablony podziękowań po wizycie

### 16.5 Klipy wideo AI

Krótkie klipy promocyjne (4–8 sekund) generowane przez Google Veo 3.1:
1. Opisz klip (np. "Modelowanie brwi w nowoczesnym salonie")
2. Wybierz styl
3. AI generuje wideo (proces trwa 2–5 minut)
4. Pobierz i opublikuj na social media

### 16.6 Animowane Stories

Animowane stories 9:16 do Instagram/Facebook:
1. Wybierz zdjęcia z galerii salonu
2. Dodaj tekst i styl animacji
3. AI generuje gotowe story

### 16.7 Testimoniale wideo

Skrypty i pytania do nagrywania testimoniali wideo z klientami. AI generuje scenariusz rozmowy, który możesz przeprowadzić z zadowolonym klientem.

### 16.8 Zaplanowane posty

**Generator treści → Zaplanowane posty** — harmonogram publikacji:
- Lista zaplanowanych postów z datą i platformą
- Możliwość edycji przed publikacją
- Status: zaplanowany / opublikowany

---

## 17. Portal klienta

Portal klienta to osobna część aplikacji dla klientów końcowych (dostępna pod `/salons`).

### 17.1 Przeglądanie salonów

Klient wchodzi na portal i widzi listę dostępnych salonów. Może:
- Przeglądać profile salonów (zdjęcia, usługi, pracownicy, opinie)
- Filtrować salony według lokalizacji i usług
- Dodawać ulubione salony

### 17.2 Rezerwacja online

1. Klient wybiera salon
2. Klika **Zarezerwuj**
3. Wybiera usługę i wariant cenowy
4. Wybiera pracownika (lub "Dowolny")
5. Wybiera termin z dostępnych slotów
6. Podaje dane kontaktowe
7. Opcjonalnie wpłaca zadatek (Stripe lub Blik)
8. Otrzymuje potwierdzenie na email/SMS

### 17.3 Moje wizyty

Zalogowany klient widzi:
- Nadchodzące wizyty z możliwością anulowania
- Historię odbytych wizyt
- Opinie wystawione po wizytach

### 17.4 Opinie

Po wizycie klient otrzymuje zaproszenie do wystawienia opinii. Ocena (1–5 gwiazdek) i komentarz są widoczne na profilu salonu.

### 17.5 Lista oczekujących

Jeśli nie ma wolnych terminów, klient może dołączyć do listy oczekujących na wybraną usługę i pracownika.

### 17.6 Ulubione salony

Zalogowany klient może oznaczać salony jako ulubione i szybko do nich wracać.

### 17.7 Logowanie klienta

Klient tworzy osobne konto w portalu klienta (nie używa konta właściciela salonu):
- Rejestracja przez email (z weryfikacją)
- Lub przez Google

---

## 18. Ustawienia

**Dashboard → Ustawienia** — centrum konfiguracji.

### 18.1 Dane salonu

**Ustawienia → Dane salonu** — edycja podstawowych informacji:
- Nazwa salonu
- Adres (ulica, miasto, kod pocztowy)
- Telefon i email kontaktowy
- Typ działalności
- Opis dla klientów
- Logo i zdjęcie główne

### 18.2 Płatności Stripe

**Ustawienia → Płatności Stripe** — konfiguracja bramki płatności:
- Podłączenie konta Stripe
- Ustawienie kwot zadatków (procentowo lub kwotowo)
- Polityka zwrotów zadatków

### 18.3 Powiadomienia

**Ustawienia → Powiadomienia** — szablony i reguły:
- Szablony SMS (potwierdzenie, przypomnienie, urodziny)
- Szablony email
- Powiadomienia push (web push)
- Ustawienia przypomnień urodzinowych

### 18.4 Program lojalnościowy

**Ustawienia → Program lojalnościowy**:
- Przelicznik punktów (np. 1 PLN = 1 punkt)
- Progi nagród (np. 500 punktów = 50 PLN rabatu)
- Komunikacja o punktach

### 18.5 Drukarka fiskalna

**Ustawienia → Drukarka fiskalna**:
- Typ drukarki (producent, model)
- Konfiguracja połączenia
- Test wydruku

### 18.6 Subskrypcja

Zarządzanie planem — przejdź do [sekcji 19](#19-subskrypcja).

---

## 19. Subskrypcja

**Dashboard → Subskrypcja** — zarządzanie planem i płatnościami.

### 19.1 Zmiana planu

- Z Basic na Pro: kliknij **Przejdź na Pro**, zostaniesz przekierowany do Stripe
- Z Pro na Basic: dostępne w panelu Stripe (od następnego okresu rozliczeniowego)

### 19.2 Anulowanie subskrypcji

W panelu Stripe możesz anulować subskrypcję. Dostęp do funkcji pozostanie do końca opłaconego okresu.

### 19.3 Historia płatności

**Subskrypcja → Historia płatności** — lista faktur za subskrypcję z możliwością pobrania PDF.

### 19.4 Okres próbny

Przez pierwsze 14 dni od rejestracji masz dostęp do funkcji wybranego planu bez opłat. Po zakończeniu okresu próbnego musisz podać dane płatności, aby kontynuować.

---

## 20. Aplikacja mobilna (PWA)

MyHelper działa jako **Progressive Web App** — możesz zainstalować go na telefonie jak zwykłą aplikację.

### 20.1 Instalacja na telefonie

**Android (Chrome):**
1. Otwórz MyHelper w przeglądarce Chrome
2. Dotknij menu (trzy kropki)
3. Wybierz **Dodaj do ekranu głównego**
4. Zatwierdź

**iPhone (Safari):**
1. Otwórz MyHelper w przeglądarce Safari
2. Dotknij przycisku **Udostępnij** (ikona ze strzałką)
3. Wybierz **Dodaj do ekranu głównego**
4. Zatwierdź

### 20.2 Tryb offline

MyHelper działa częściowo offline:
- Przeglądanie zapisanych danych (klientów, kalendarza)
- Zapis nowych danych jest kolejkowany i synchronizowany po powrocie online
- Ikona alertu w górnym pasku informuje o braku połączenia

### 20.3 Powiadomienia push

Po zainstalowaniu aplikacji możesz włączyć powiadomienia push:
1. Wejdź w **Ustawienia → Powiadomienia**
2. Włącz **Powiadomienia push**
3. Przeglądarka poprosi o zgodę

---

## 21. FAQ

### Jak zresetować hasło?

1. Na stronie logowania kliknij **Zapomniałem hasła**
2. Podaj adres email
3. Sprawdź skrzynkę — otrzymasz link do resetowania (ważny 15 minut)

### Czy mogę mieć kilka salonów?

Aktualnie jedno konto obsługuje jeden salon. Kontakt z supportem w sprawie wielu lokalizacji.

### Jak wyeksportować dane klientów?

Z poziomu listy klientów kliknij przycisk **Eksportuj do Excel** (dostępny w prawym górnym rogu). Pobierasz plik `.xlsx` ze wszystkimi danymi.

### Klient nie może zarezerwować — co zrobić?

Sprawdź:
- Czy pracownik ma uzupełniony harmonogram pracy (Pracownicy → Harmonogram)
- Czy usługa jest przypisana do pracownika
- Czy nie ma blokad czasu na dany dzień

### Jak zmienić walutę lub język?

Aplikacja działa w języku polskim i obsługuje walutę PLN. Inne języki i waluty są planowane w kolejnych wersjach.

### Zadatek nie został zwrócony — co robić?

Wejdź w szczegóły wizyty → sekcja **Status zadatku** → przycisk **Zwróć zadatek**. Zwrot jest realizowany przez Stripe (1–5 dni roboczych na koncie klienta).

### Jak działa asystent głosowy AI?

Asystent (plan Pro) odbiera połączenia telefoniczne na numer Twilio w Twoim imieniu. Rozpoznaje zamiar rozmówcy (rezerwacja, anulowanie, pytanie o cennik), odpowiada głosem ElevenLabs i zarządza terminarzem w systemie. Konfiguracja w **Asystent AI → Asystent głosowy**.

### Sesja wygasa zbyt szybko?

Z powodów bezpieczeństwa sesja wygasa po 15 minutach nieaktywności. To zamierzone zachowanie. W przyszłości planowane jest wydłużenie tego limitu lub opcja "Zapamiętaj mnie".

### Jak skontaktować się z supportem?

Wyślij email na adres wsparcia (dostępny w stopce aplikacji). Użytkownicy planu Pro mają priorytetowe wsparcie techniczne.

---

*Dokumentacja MyHelper v1.0 — marzec 2026*
