# Lista oczekujących — zasady przetwarzania danych

Dotyczy funkcji „Lista oczekujących” w MyHelper. Opisuje wyłącznie to, co robi kod aplikacji. Administratorem danych klientów jest salon, który korzysta z aplikacji. MyHelper przetwarza te dane w imieniu salonu i na jego polecenie.

## Cel
Powiadomienie klienta, że zwolnił się termin pasujący do jego prośby, i umożliwienie mu przyjęcia albo odrzucenia tego terminu.

## Podstawa prawna
Art. 6 ust. 1 lit. b RODO: działania podejmowane na żądanie osoby przed zawarciem umowy. Powiadomienie wychodzi wyłącznie z wpisu, przy którym zapisano potwierdzenie, że klient sam poprosił o informację o wolnym terminie. Powiadomienie ma charakter informacyjny i nie zawiera treści promocyjnych.

## Moduł salonu
Lista oczekujących jest modułem, który salon włącza w ustawieniach; domyślnie jest wyłączony. Przy wyłączonym module aplikacja nie wysyła powiadomień, nie przyjmuje proponowanych terminów, a personel salonu nie może dodawać, przeglądać ani zmieniać wpisów; panel salonu nie pokazuje wtedy listy oczekujących. Usunięcie wpisu własnego salonu zlecone przez zalogowany personel salonu aplikacja wykonuje także przy wyłączonym module.

## Zakres danych wpisu
- klient z kartoteki salonu; do powiadomienia aplikacja używa numeru telefonu (SMS) i adresu e-mail (ustalenie konta klienta dla powiadomienia push);
- preferencje: usługa, pracownik, preferowana data;
- przebieg: czas powiadomienia, zaproponowany termin i pracownik, powiązana z propozycją zaplanowana albo potwierdzona wizyta klienta na tę samą usługę, zaczynająca się później niż zaproponowany termin, przyjęcie albo odrzucenie terminu;
- źródło wpisu, czas potwierdzenia prośby klienta i identyfikator konta personelu, z którego dodano wpis.

Po usunięciu konta personelu identyfikator konta jest usuwany z wpisu, a źródło i czas potwierdzenia zostają.

Wysyłka powiadomień jest zapisywana w historii powiadomień salonu. Zapis zawiera rodzaj (SMS albo push), treść, status i powiązanie z klientem, a czas wysyłki — jak niżej:
- SMS wysłany: status „wysłane” i czas wysyłki. SMS, którego nie udało się wysłać (także z powodu nieprawidłowego numeru): aplikacja próbuje zapisać go ze statusem „nieudane”, bez czasu wysyłki.
- Push: zapis powstaje, gdy klient ma co najmniej jedno zarejestrowane urządzenie — ze statusem „wysłane”, gdy powiadomienie dotarło do co najmniej jednego urządzenia, w przeciwnym razie „nieudane”; w obu przypadkach z czasem próby. Przy błędzie wysyłki aplikacja próbuje zapisać powiadomienie ze statusem „nieudane”, bez czasu wysyłki. Zapisywany jest tytuł i treść powiadomienia, bez dołączonych do niego identyfikatorów i adresu strony.
- Wiadomość, która nie jest wysyłana (pora, w której SMS nie wychodzi, brak urządzeń klienta, kanał push nieudostępniony), nie jest zapisywana.

Przyjęcie terminu dodaje do tej historii wpis systemowy ze statusem „wysłane”, czasem zapisu i powiązaniem z klientem; jego treść zawiera identyfikator wizyty, informację, czy wizyta została przeniesiona, czy zarezerwowana, oraz datę i godzinę terminu (czas polski). Historia powiadomień nie jest powiązana z wpisem listy oczekujących i nie jest usuwana razem z nim.

## Źródło wpisu i potwierdzenie prośby
Wpis powstaje na dwa sposoby:
- **Personel salonu dodaje wpis w panelu** dla klienta z kartoteki salonu. Pracownik musi zaznaczyć w formularzu, że klient sam poprosił o zapis na listę oczekujących; bez tego wpis nie powstaje. Aplikacja zapisuje źródło wpisu, czas potwierdzenia i konto, z którego wpis dodano. Te wartości ustawia serwer; aplikacja nie pozwala podać ich w formularzu ani zmienić ich później.
- **Klient z kontem zapisuje się sam w portalu klienta.** Wymaga to potwierdzonego adresu e-mail. Jeśli w kartotece salonu nie ma klienta z tym adresem, aplikacja tworzy go z imienia, nazwiska, adresu e-mail i numeru telefonu z konta. Taki wpis nie ma zapisanego potwierdzenia prośby i nie jest używany do powiadomień.

Wpis bez zapisanego potwierdzenia prośby klienta nie jest używany do powiadomień.

## Kiedy wychodzi powiadomienie
Powiadomienie wychodzi, gdy wizyta zostaje odwołana (przez klienta w portalu albo przez salon), a jej termin jeszcze się nie rozpoczął. Termin, który już minął, nie jest proponowany.

Aplikacja wybiera wpisy tego salonu, które:
- mają zapisane potwierdzenie prośby klienta;
- nie zostały jeszcze powiadomione ani rozstrzygnięte (przyjęte albo odrzucone);
- dotyczą tej samej usługi co odwołana wizyta albo nie wskazują usługi (gdy odwołana wizyta nie ma usługi — tylko wpisy bez wskazanej usługi);
- wskazują tego samego pracownika co odwołana wizyta albo nie wskazują pracownika (gdy odwołana wizyta nie ma pracownika — tylko wpisy bez wskazanego pracownika).

Preferowana data nie wpływa na wybór wpisów.

Do jednego zwolnionego terminu aplikacja wybiera najwyżej 5 pasujących wpisów — najwcześniej dodane — i obsługuje je po kolei. Każdy z nich dostaje propozycję tego samego terminu.

## Kanały powiadomienia
- **SMS** na numer telefonu klienta zapisany w kartotece salonu. SMS nie wychodzi od 21:00 do 8:00 czasu polskiego (strefa Europe/Warsaw).
- **Powiadomienie push** — po udostępnieniu kanału powiadomień push w aplikacji: na urządzenia, na których klient włączył powiadomienia, wyłącznie gdy klient ma konto z potwierdzonym adresem e-mail równym adresowi e-mail w kartotece salonu.

Wpis, dla którego w danej chwili nie ma żadnego kanału (np. klient ma tylko numer telefonu, a jest pora, w której SMS nie wychodzi), jest pomijany bez zmian i pozostaje oczekujący.

Bezpośrednio przed wysyłką aplikacja oznacza wpis jako powiadomiony i zapisuje w nim propozycję (termin, pracownika, powiązaną wizytę). Od tej chwili wpis nie jest wybierany przy innych zwolnionych terminach, a propozycja jest widoczna w portalu klienta. Jeśli oznaczenie wpisu się nie powiedzie, wiadomość nie wychodzi i wpis pozostaje oczekujący.

Wpis pozostaje oznaczony jako powiadomiony, gdy co najmniej jedna wiadomość (SMS albo push) zostanie przyjęta do wysyłki. Jeśli żadna nie zostanie przyjęta, aplikacja usuwa z wpisu oznaczenie i propozycję, o ile wpis nie został w tym czasie przyjęty ani odrzucony, i wpis znów jest oczekujący. Wpis oczekujący może dostać propozycję przy następnym zwolnionym terminie. Jeśli usunięcie oznaczenia się nie powiedzie, wpis pozostaje oznaczony jako powiadomiony, z zapisaną propozycją, mimo że żadna wiadomość nie została przyjęta; aplikacja zapisuje błąd w dzienniku zdarzeń.

## Treść powiadomień
SMS zawiera wyłącznie: nazwę salonu, nazwę usługi, datę i godzinę terminu (czas polski), informację, że termin można przyjąć po zalogowaniu w aplikacji na liście oczekujących, oraz numer telefonu salonu, jeśli salon go podał. Treść SMS jest zapisywana bez polskich znaków.

Powiadomienie push zawiera wyłącznie: tytuł „Zwolnił się termin”, nazwę salonu, nazwę usługi, datę i godzinę terminu (czas polski) oraz informację, że termin można przyjąć albo odrzucić. Do powiadomienia dołączone są identyfikatory wpisu i salonu oraz adres strony listy oczekujących w aplikacji.

Nazwa salonu albo usługi, która wygląda na adres strony internetowej, jest pomijana. Zbyt długie nazwy są skracane.

Treść powiadomień nie zawiera imienia, nazwiska ani innych danych osobowych klienta, danych pracownika ani linków. Nie zawiera treści promocyjnych.

## Przyjęcie i odrzucenie terminu
Klient przyjmuje albo odrzuca zaproponowany termin w portalu klienta. Wymaga to konta z potwierdzonym adresem e-mail równym adresowi e-mail w kartotece salonu. Klient bez takiego konta może skontaktować się z salonem.

Przyjęcie jest możliwe tylko, gdy:
- moduł listy oczekujących jest włączony w salonie;
- wpis nie został wcześniej przyjęty ani odrzucony;
- zaproponowany termin jeszcze się nie rozpoczął i nadal jest wolny u zaproponowanego pracownika;
- zaproponowany pracownik nadal istnieje w salonie.

Propozycja jest powiązana z wizytą klienta w tym salonie, jeśli przy wysyłce propozycji klient miał zaplanowaną albo potwierdzoną wizytę na tę samą usługę, zaczynającą się później niż zaproponowany termin (przy kilku takich wizytach — z najwcześniejszą). Przy przyjęciu:
- jeśli powiązana wizyta jest nadal zaplanowana albo potwierdzona i zaczyna się później niż zaproponowany termin, przyjęcie przenosi ją na zaproponowany termin i do zaproponowanego pracownika;
- jeśli propozycja nie ma powiązanej wizyty albo powiązana wizyta nie istnieje lub została odwołana, przyjęcie tworzy nową wizytę;
- jeśli powiązana wizyta istnieje, nie jest odwołana, ale nie da się jej już przenieść (np. została zakończona albo zaczyna się nie później niż zaproponowany termin), przyjęcie jest odrzucane: żadna wizyta nie jest tworzona ani przenoszona, a wpis pozostaje nierozstrzygnięty.

Nowa wizyta nie powstaje, jeśli usługa albo klient wymagają zadatku; klient może wtedy zarezerwować termin w portalu z wpłatą zadatku, a wpis pozostaje nierozstrzygnięty.

Odrzucenie terminu jest możliwe, dopóki wpis nie został przyjęty ani odrzucony, także przy wyłączonym module. Odrzucenie kończy obsługę wpisu.

Propozycja nie ma osobnego terminu ważności. Przestaje być możliwa do przyjęcia, gdy zaproponowany termin się rozpocznie albo zostanie zajęty. Wpis powiadomiony, który nie został przyjęty ani odrzucony, nie dostaje kolejnych propozycji.

Personel salonu może w panelu zmienić preferencje wpisu (usługę, pracownika, preferowaną datę) i oznaczyć wpis jako przyjęty albo odrzucony. Takie oznaczenie nie tworzy ani nie przenosi wizyty.

## Wycofanie i usunięcie
Wycofanie prośby oznacza usunięcie wpisu. Po usunięciu wpis nie jest już używany i żadne powiadomienie z niego nie wychodzi.
- Klient z kontem (potwierdzony adres e-mail równy adresowi w kartotece salonu) usuwa wpis sam w portalu klienta.
- Każdy klient może poprosić salon o usunięcie wpisu, np. telefonicznie. Salon usuwa wpis w panelu, gdy moduł jest włączony; usunięcie wpisu zlecone przez personel salonu aplikacja wykonuje także przy wyłączonym module.

## Okres przechowywania
Wpis jest przechowywany do chwili, gdy usunie go klient albo salon. Wpis jest usuwany automatycznie razem z klientem z kartoteki salonu albo razem z salonem. Aplikacja nie usuwa wpisów automatycznie po upływie określonego czasu.

## Dostęp
- Personel salonu widzi i obsługuje wyłącznie wpisy własnego salonu. Każde zapytanie panelu i wysyłki powiadomień o wpisy listy oczekujących zawiera warunek salonu.
- Panel salonu pokazuje przy wpisie imię i nazwisko, numer telefonu i adres e-mail klienta.
- Klient z kontem widzi wyłącznie wpisy przypisane do klientów z kartotek salonów, których adres e-mail jest równy potwierdzonemu adresowi e-mail jego konta. Portal pokazuje mu nazwę salonu, usługę, pracowników, status wpisu i zaproponowany termin.

## Odbiorcy danych
Pełna lista odbiorców danych wynikająca z kodu aplikacji: [podprocesorzy.md](podprocesorzy.md). Dane wpisu listy oczekujących otrzymują:
- dostawca infrastruktury, na której działa aplikacja i baza danych;
- dostawca bramki SMS (SMSAPI) — otrzymuje numer telefonu i treść SMS;
- po udostępnieniu kanału powiadomień push: usługa powiadomień push przeglądarki, z której korzysta klient (Google, Apple albo Mozilla). Otrzymuje adres subskrypcji urządzenia i zaszyfrowaną treść powiadomienia; treści nie widzi.
