# Odbiorcy danych wynikający z kodu aplikacji

Ten plik to lista podmiotów, którym kod aplikacji MyHelper przekazuje dane, z kategoriami danych i celem. Opisuje wyłącznie to, co robi kod. Nie opisuje stanu żadnego wdrożenia ani umów zawartych z tymi podmiotami.

Zasada aktualizacji: zmiana kodu, która dodaje odbiorcę danych, zmienia jego zakres danych albo go usuwa, zmienia ten plik w tej samej zmianie.

Stan w produkcie: „aktywny w kodzie” oznacza, że kod wysyła dane, gdy dostawca jest skonfigurowany. „Wyłączony w kodzie” oznacza, że funkcja jest zablokowana w aplikacji dla wszystkich salonów i dane nie są wysyłane.

| Podmiot | Rola | Kategorie danych | Cel | Kraj siedziby | Stan w produkcie |
|---|---|---|---|---|---|
| Dostawca infrastruktury aplikacji i bazy danych, wskazany w umowie powierzenia | podmiot przetwarzający (hosting, baza danych, magazyn plików) | wszystkie dane przetwarzane przez aplikację, w tym pliki wgrane do aplikacji | utrzymanie usługi | wskazany w umowie powierzenia | aktywny w kodzie |
| SMSAPI | podmiot przetwarzający (bramka SMS) | numer telefonu odbiorcy, treść SMS | wysyłka SMS do klientów salonu (m.in. przypomnienia o wizytach) | Polska | aktywny w kodzie |
| Resend | podmiot przetwarzający (wysyłka e-mail) | adres e-mail odbiorcy, temat i treść wiadomości (w tym linki potwierdzenia adresu i resetu hasła) | wysyłka wiadomości e-mail z aplikacji | USA | aktywny w kodzie |
| Stripe | dostawca płatności | adres e-mail płacącego, kwota, nazwa usługi albo planu, identyfikatory techniczne płatności; dane karty i inne dane płatnicze podaje płacący bezpośrednio na stronie płatności dostawcy | płatność zadatku za wizytę, płatność subskrypcji salonu | do potwierdzenia | aktywny w kodzie |
| OpenRouter, a za jego pośrednictwem dostawca wybranego modelu językowego | podmiot przetwarzający (funkcje AI, plan Pro) | dane wybrane przez funkcję: imię i nazwisko klienta, informacja o alergiach (dane dotyczące zdrowia), preferencje, data urodzin, notatki z wizyt i zabiegów, opinie klienta, imiona i nazwiska pracowników, dane o usługach, wizytach i przychodach salonu | podsumowania wizyt, analiza klienta, rekomendacje i asystent dla salonu | USA | aktywny w kodzie |
| Google (generowanie grafik) | podmiot przetwarzający (funkcje AI) | treść polecenia opisującego grafikę | generowanie grafik promocyjnych i ilustracji usług | do potwierdzenia | wyłączony w kodzie |
| Upstash | podmiot przetwarzający (licznik limitu żądań) | adres IP albo inny identyfikator żądania użyty jako klucz limitu | ochrona przed nadużyciami | do potwierdzenia | aktywny w kodzie |
| Google (logowanie przez konto Google) | usługa logowania wybrana przez użytkownika | dane konta Google przekazane za zgodą użytkownika (imię, adres e-mail, zdjęcie profilowe); Google otrzymuje informację o logowaniu do MyHelper | logowanie bez osobnego hasła | do potwierdzenia | aktywny w kodzie |
| Google (sieć dystrybucji biblioteki Workbox) | dostawca skryptu ładowanego przez przeglądarkę | adres IP i nagłówki przeglądarki przy pobraniu skryptu | obsługa trybu offline aplikacji | do potwierdzenia | aktywny w kodzie |
| Usługa powiadomień push przeglądarki, z której korzysta użytkownik (Google, Apple albo Mozilla) | pośrednik dostarczenia powiadomienia, po udostępnieniu kanału powiadomień push | adres subskrypcji urządzenia, zaszyfrowana treść powiadomienia (usługa nie widzi treści) | dostarczenie powiadomienia push | do potwierdzenia | wyłączony w kodzie |
