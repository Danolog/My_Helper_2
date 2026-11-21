# ADR-002: Dostęp portalu klienta do danych wielu salonów (wariant U)

**Status:** Zaproponowany, po recenzji CRCO z poprawkami wprowadzonymi w v1.1. Czeka na sign-off COO. Nie zmienia schematu, polityk RLS ani infrastruktury, więc nie dotyka czerwonych linii.
**Data:** 2026-11-21
**Autor:** CTO
**Wersja:** v1.1
**Dotyczy:** #193 (zejście z surowego `db` w trasach), grupa „portal klienta”: `src/app/api/client/**`, `src/app/api/favorites/**`, `src/app/api/push/{subscribe,unsubscribe}`.
**Uzupełnia:** ADR-001 (warstwa repozytorium + RLS). Poprawia jedno nieaktualne ustalenie ADR-001 (sekcja 8).

**Zmiany v1.0 → v1.1 (po recenzji CRCO):**
- nowe ograniczenie O6 i warunek wstępny kroku anulowania: rezerwacja dodana przez personel nie zapisuje konta personelu jako rezerwującego;
- jawne kolumny obowiązują w każdym odczycie i każdym `returning` tras portalu, nie tylko w funkcjach S;
- test kluczy działa na odpowiedzi trasy, nie tylko na DTO;
- zamknięta lista odczytów pod kontekstem salonu-celu (2.3);
- tabela zakazanych kolumn (2.5);
- przypadki testu 9–11, odmiana dla warunku stanu i wyścig na dwóch połączeniach;
- odpowiedzi na pytania otwarte i kolejność kroków według decyzji COO.

> **Słowniczek**
> **portal klienta** to część aplikacji dla osoby, która rezerwuje wizyty. Jedno konto klienta może mieć wizyty w wielu salonach.
> **F** to `forSalon(salonId)` z `src/lib/server/repository.ts`: transakcja z rolą aplikacji (bez BYPASSRLS), kontekstem `app.current_salon_id` i jawnym `eq(salonId)`.
> **S** to funkcja systemowa w `src/lib/server/system/<domena>.ts`, wystawiona przez zamknięty rejestr `system/index.ts`. Chodzi przez pulę systemową, więc RLS jej nie zatrzyma. Ochroną jest to, że lista funkcji jest zamknięta i każdą widać w recenzji.
> **tożsamość z sesji** to `authResult.user.id` albo e-mail zweryfikowany przez `verifiedClientMatchEmail(authResult.user)`. Nigdy wartość z body, query ani nagłówka.
> **jawna lista kolumn** to `select({ pole: tabela.kolumna, … })` i `returning({ … })`, nigdy `select()`, puste `returning()` ani `{ salon: salons }`.
> **przełączenie puli** to zmiana roli, którą łączy się pula aplikacji, na rolę bez BYPASSRLS. Do tej chwili pula aplikacji omija RLS.

---

## 1. Kontekst

### Problem

Trasy portalu klienta czytają i zapisują przez surowe `db` z adnotacją „ścieżka user-scoped, świadomie surowe db”. Działają tylko dlatego, że pula aplikacji łączy się rolą właściciela tabel, a ta omija RLS (tryb ENABLE, nie FORCE). Są trzy skutki:

1. **Lista plików przejściowych nie dojdzie do zera.** Reguła lintu z ADR-001 nie przejdzie na `error`, dopóki portal ma surowe `db`.
2. **Po przełączeniu puli portal przestanie działać po cichu.** Polityka `tenant_isolation` bez ustawionego kontekstu salonu zwraca 0 wierszy. Lista wizyt będzie pusta, anulowanie dostanie 404, a INSERT na liście oczekujących zostanie odrzucony.
3. **Odczyt płatności przy anulowaniu robiony bez kontekstu salonu zmieni decyzję o zwrocie po cichu.** Trasa anulowania (`client/appointments/[id]/cancel`) pyta `selectSucceededDeposits` o płatności `succeeded`. Pod rolą aplikacji bez kontekstu dostanie pustą listę. Uzna wtedy, że zadatek rozlicza salon poza aplikacją, i klient nie dostanie zwrotu, choć mu się należy. Nie będzie przy tym żadnego błędu.

Do tego dochodzi wyciek przez kolumny, który istnieje już dziś, niezależnie od RLS:
- anulowanie zwraca w odpowiedzi cały zaktualizowany wiersz wizyty (puste `returning()`), razem z `notes`, danymi gościa, `booked_by_user_id`, `promo_code_id` i znacznikami przypomnień;
- szczegół wizyty dokleja cały wiersz `treatment_history` (z `notes` i `materials_json`) i cały wiersz `deposit_payments`;
- dopisanie do listy oczekujących czyta cały wiersz salonu (z `settings_json`), całą kartotekę klienta (z notatkami i alergiami) i zwraca cały nowy wpis.

### Czym portal różni się od panelu salonu

W panelu właściwy zakres to **jeden salon z sesji**, a `forSalon` pasuje do tego wprost. W portalu właściwy zakres to **jeden użytkownik w wielu salonach**. Lista wizyt klienta z natury obejmuje kilka salonów, więc nie ma jednego salonu, na który dałoby się ustawić kontekst RLS.

Z tego samego powodu nie dzieje się tu to, co jest błędem przy dostępach tymczasowych: tam konto z dwoma salonami widzi granty obu i to jest wada do naprawy. Dla klienta zakres „wszystkie moje salony” jest celem, nie wadą.

### Ograniczenia

| # | Ograniczenie | Konsekwencja |
|---|---|---|
| O1 | Migracja polityk RLS na produkcji jest czerwoną linią. Dopiero trwa przenosiny bazy. | Decyzja na betę nie może wymagać nowych polityk ani nowej zmiennej sesji. |
| O2 | Rejestr `system/` ma reguły: funkcje async, dane na wejściu i wyjściu, bez `tx`, puli i callbacków. Każdy nowy eksport zmienia migawkę testu rejestru. | Odczyty przez wiele salonów idą jako nazwane funkcje S z wąskim kontraktem, wzorem `resolveWaitingListToken` i `listPublicSalonCatalog`. |
| O3 | Limit 3 plików kodu na PR. `system/client-portal.ts` i `system/index.ts` są wspólne dla wszystkich kroków. | Kroki portalu scalają się po kolei, nie równolegle. |
| O4 | Pilotaż obejmuje jeden prawdziwy salon. Zadatki kartą są zamrożone, a AI uśpione. | W pilotażu wyciek między salonami jest mało prawdopodobny. **Realne ryzyko to wyciek między klientami tego samego salonu.** Tenant RLS go nie łapie w żadnym wariancie poza B (sekcja 6). |
| O5 | Lista oczekujących wiąże konto z kartoteką klienta przez **zweryfikowany e-mail**, nie przez `user_id`. | Tożsamość portalu to para `{userId, verifiedEmail}`, nie samo `userId`. |
| O6 | Tożsamość portalu dla wizyt to `appointments.booked_by_user_id`. Ten warunek wskazuje klienta tylko wtedy, gdy wizytę zarezerwował klient. Dziś `POST /api/appointments` zapisuje tam konto każdego zalogowanego, także personelu, który dodaje wizytę w panelu. | Rezerwacja dodana przez personel musi zapisywać `booked_by_user_id = null`. Bez tego osoba z personelu widzi w portalu wszystkie wizyty, które dodała innym klientom (także po odpięciu od salonu), i może je anulować „jako klient”, z pominięciem ograniczeń swojej roli i z decyzją o zadatku. To warunek wstępny kroku anulowania (sekcja 4). |

---

## 2. Decyzja: wariant U

**Odczyty, które obejmują wiele salonów, idą przez S z tożsamością z sesji. Zapisy do wierszy salonu idą przez F, z salonem ustalonym przez serwer.**

### 2.1 Odczyt: S `find…ForUser` zwraca `salonId`

- Moduł: **`src/lib/server/system/client-portal.ts`**. Moduł tylko czyta. Nie dostaje żadnej funkcji zapisującej, tak jak `system/waiting-list.ts`.
- Pierwszy argument każdej funkcji to tożsamość z sesji: `sessionUserId: string`, a dla listy oczekujących `verifiedEmail: string`. Funkcja rzuca wyjątek przy pustej wartości, tak samo jak `forSalon`.
- Każde zapytanie ma w `where` warunek tożsamości: `eq(appointments.bookedByUserId, sessionUserId)`, `eq(favoriteSalons.clientUserId, sessionUserId)` albo `eq(clients.email, verifiedEmail)`. Warunek siedzi w funkcji, nie u wołającego. Warunek po `bookedByUserId` jest poprawny dopiero po spełnieniu O6.
- Funkcja `find…ForUser(sessionUserId, id)` zwraca `null` albo mały obiekt z `salonId` i polami potrzebnymi do decyzji trasy, czyli statusem, czasem i zadatkiem. `null` oznacza 404 bez rozróżnienia między wierszem cudzym a nieistniejącym (ADR-001, sekcja 2.4).
- Wewnętrzne identyfikatory w DTO `find…` (`salonId`, `serviceId`, `employeeId`, `clientId`) służą tylko decyzji trasy i nie trafiają do odpowiedzi (2.5).

Przykład dla kroku anulowania, jako sygnatura referencyjna, nie kod:

```ts
export type ClientAppointmentForCancel = {
  appointmentId: string;
  salonId: string;
  serviceId: string | null;
  employeeId: string | null;
  status: string;
  startTime: Date;
  endTime: Date;
  depositAmount: string | null;
  depositPaid: boolean;
  salonName: string | null;
  salonPhone: string | null;
  serviceName: string | null;
  servicePrice: string | null;
  employeeName: string | null;
};
export async function findClientAppointmentForUser(
  sessionUserId: string,
  appointmentId: string
): Promise<ClientAppointmentForCancel | null>;
```

### 2.2 Zapis: F z ponownym warunkiem tożsamości

Zapis do wiersza salonu (`appointments`, `reviews`, `waiting_list`, `clients`, `favorite_salons`) robi się w `forSalon(found.salonId).raw(tx => …)`. W `where` zapisu powtarzamy **wszystkie** warunki:

```ts
and(
  eq(appointments.id, found.appointmentId),
  eq(appointments.salonId, found.salonId),
  eq(appointments.bookedByUserId, sessionUserId),        // ponownie, nie „bo S sprawdziło”
  notInArray(appointments.status, ["cancelled", "completed"]) // warunek stanu w zapisie
)
```

Do tego `.returning({ … jawne kolumny … })`. Puste `returning()` jest zakazane (2.7, zakaz 3). Odpowiedź trasy buduje się z jawnej listy pól dozwolonych w 2.5, nie z całego wiersza.

- **0 wierszy z `returning` oznacza 404 i brak skutków ubocznych.** Nie ma wtedy zwrotu, zatrzymania zadatku ani powiadomienia listy oczekujących. Skutki uboczne wolno uruchomić dopiero, gdy zapis zwrócił wiersz.
- Warunek stanu w zapisie zamyka wyścig dwóch równoległych anulowań. Dziś zapis ma tylko `where id`, więc oba żądania przechodzą sprawdzenie i oba uruchamiają skutki uboczne.
- Odczyt płatności, który decyduje o zwrocie, idzie **w kontekście salonu wizyty** (`forSalon(found.salonId)`). Musi użyć tego samego predykatu „płatność online `succeeded`” co `selectSucceededDeposits`, z jednego źródła, bez kopii warunku. Jeśli to wymaga zmiany `src/lib/refund.ts`, krok anulowania dzieli się na dwa:
  - najpierw obok starej funkcji powstaje wariant przyjmujący `tx`, a stara zostaje dla innych wołających;
  - potem przepinamy trasę.
- `refundAppointmentDeposits` w tym kroku się nie zmienia. Przejście zwrotu na `salonId` jako argument to osobny krok płatności, wymagany przed odmrożeniem zadatków kartą. W pilotażu ta ścieżka nie jest osiągalna, bo nie ma płatności kartą `succeeded`.
- `notifyWaitingList` dostaje `salonId` z wyniku S, nigdy z żądania.

**Dlaczego dwa kroki są tu dopuszczalne:** po stronie portalu nie ma niezmiennika „wiersz tworzony równolegle pod blokadą”. Wizyta istnieje, zanim klient może ją anulować. Między S a F stan może się zmienić, ale warunki w `where` zapisu wyłapują każdą taką zmianę.

### 2.3 Wiersze tworzone przez klienta w wybranym salonie

Ulubione i dopisanie do listy oczekujących tworzą **nowy** wiersz w salonie, który klient sam wybiera. Tutaj `salonId` z body albo query jest **celem** akcji, nie uprawnieniem. Reguła:

1. `salonId` walidujemy jako UUID przez `isValidUuid` albo schemat Zod z `.uuid()`. Zwykłe „wymagany napis” nie wystarcza.
2. Cała akcja biegnie w **jednej** transakcji `forSalon(salonId)`. `WITH CHECK` polityki gwarantuje, że wiersz nie trafi do innego salonu.
3. Atrybut własności nowego wiersza, czyli `clientUserId` albo kartoteka dopasowana po `verifiedEmail`, pochodzi wyłącznie z sesji.

**Zamknięta lista odczytów i zapisów pod kontekstem salonu-celu.** Pod `forSalon(salonId z żądania)` wolno wyłącznie:

- **(a) sprawdzić istnienie** salonu (`select id from salons where id = salonId`; polityka `tenant_self` przepuszcza własny wiersz), usługi i pracownika z `eq(salonId)`, z `select({ id })`. Wynik nie trafia do odpowiedzi. Jedyny wyjątek to pola katalogu publicznego salonu z tabeli w 2.5, jeśli trasa je zwraca.
- **(b) czytać, tworzyć i usuwać wyłącznie wiersz własny**, adresowany tożsamością z sesji: `favorite_salons.client_user_id = sessionUserId` albo `clients.email = verifiedEmail`. Odczyt kartoteki ma jawną listę kolumn potrzebnych do zapisu (co najmniej `id`), bez notatek, alergii i innych danych z kartoteki.
- **(c) zrobić INSERT nowego wiersza** z `salonId` celu i atrybutem własności z sesji, z `returning({ … })` o jawnych kolumnach.

Nic innego. Usunięcie ulubionego to `delete … where clientUserId = sessionUserId and salonId = salonId` pod `forSalon(salonId)`, bez S. Różnica 404/201 zdradza istnienie salonu o danym UUID. Przy UUID v4 to ryzyko akceptujemy.

To zmienia plan kroku ulubionych: **zapisy ulubionych idą przez F, nie przez S.** Do S trafia tylko lista ulubionych, bo obejmuje wiele salonów. Uzasadnienie: każda funkcja zapisująca przez pulę systemową poszerza obszar bez RLS, a tu F wystarcza. Warunek tej decyzji jest spełniony: `favorite_salons` ma na main politykę `tenant_isolation` z `USING` i `WITH CHECK` (`drizzle/0010_rls_policies_nullif.sql`, tabela na liście `direct_tables`).

### 2.4 Tabele bez `salon_id`

`push_subscriptions` nie ma `salon_id` ani polityki, więc `forSalon` nie ma tu zastosowania. Zapis i usunięcie po `user_id` z sesji idą przez S w istniejącym module `system/notifications.ts`, obok funkcji push, które już tam są. To jedyny dopuszczony zapis przez pulę systemową w zakresie portalu.

### 2.5 Jawne listy kolumn

Zasada obejmuje **każdy odczyt i każde `returning` w trasach portalu i w ich transakcjach F**, a nie tylko funkcje S.

- Każda funkcja S zwraca **typ DTO z wypisanymi polami**. Zapytanie ma `select({…})` z dokładnie tymi polami.
- Każda trasa portalu buduje odpowiedź z jawnej listy pól. Nie doklejamy całych wierszy z odczytów poza S (dziś: `treatment`, `depositPayment` w szczególe wizyty, cały wpis w odpowiedzi listy oczekujących, cały wiersz w odpowiedzi anulowania).
- Test kluczy (sekcja 3, przypadek 4) pilnuje **listy dozwolonych** pól odpowiedzi. Tabela niżej to minimum, które nie może się na niej znaleźć.

| Tabela | Zakazane w odpowiedzi portalu |
|---|---|
| `appointments` | `notes`, `client_id`, `booked_by_user_id`, `guest_name`, `guest_phone`, `guest_email`, `promo_code_id`, `reminder_sent_at`, `reminder_1h_sent_at`, `reminder_push_sent_at`, `reminder_push_1h_sent_at`. Wewnętrzne id (`employee_id`, `service_id`) tylko w DTO `find…` do decyzji trasy, nie w odpowiedzi. Dozwolone: `discount_amount`, bo to cena klienta. |
| `salons` | `settings_json` (numer BLIK i ustawienia), `owner_id`. Dozwolone tylko pola katalogu: `id`, `name`, `phone`, `email`, `address`, `industry_type`. |
| `employees` | wszystko poza `first_name`, `last_name`, `color`, czyli w szczególności `phone`, `email`, `user_id`, `role`, `commission_rate`, `is_active`, `photo_url` (zdjęcie do czasu osobnej decyzji). |
| `services` | `category_id`, `is_active`, `suggested_next_visit_days`. Dozwolone: `name`, `description`, `base_price`, `base_duration`, a przy zadatku `deposit_required` i `deposit_percentage`. |
| `reviews` | `client_id`. Opinie wyłącznie własne. Dozwolone: `rating`, `comment`, `status`, `owner_response`, `owner_response_at` (odpowiedź salonu jest skierowana do autora). |
| `waiting_list` | **`accept_token`** (sekret na okaziciela: nie może pojawić się w żadnej odpowiedzi API ani w logu, także dla właściciela wpisu), `client_id`, `created_by_user_id`, `client_request_confirmed_at`, `source`. |
| `deposit_payments` | `stripe_payment_intent_id`, `stripe_refund_id`, `refund_reason` (tekst salonu; klient dostaje `status`). `blik_phone_number` jest dozwolony tylko wtedy, gdy to numer odbiorcy z instrukcji płatności, który klient i tak dostaje. Wykonawca kroku listy i szczegółu wizyt sprawdza, czyj to numer. Jeśli to numer płacącego, pole jest zakazane. |
| `clients` | wszystkie kolumny. `id` tylko wewnętrznie w DTO `find…`, nie w odpowiedzi. |
| `treatment_history` | `notes`, `materials_json`. `recipe` i `techniques` nie są pokazywane do decyzji COO z właścicielem salonu, podjętej przed krokiem listy i szczegółu wizyt (fail-closed). |

`appointments.notes` jest notatką personelu: piszą ją klient przy rezerwacji i personel w panelu, który ją nadpisuje, a kolumna nie zapisuje autora. Portal jej nie zwraca. Prawo klienta do dostępu do danych (RODO, art. 15) realizuje się przez wniosek do salonu jako administratora, nie przez automatyczne pokazywanie w portalu. Zwrot `notes` w odpowiedzi 201 rezerwacji zostaje, bo to tekst, który rezerwujący właśnie wysłał.

### 2.6 Nazewnictwo i miejsce

| Funkcja (S, `system/client-portal.ts`) | Krok | Kontrakt |
|---|---|---|
| `findClientAppointmentForUser(sessionUserId, appointmentId)` | anulowanie | DTO z 2.1 albo `null` |
| `listClientAppointments(sessionUserId)` | lista i szczegół wizyt | lista DTO, limit 500, `orderBy startTime desc` |
| `getClientAppointment(sessionUserId, appointmentId)` | lista i szczegół wizyt | DTO szczegółu albo `null` |
| `listClientReviews(sessionUserId)` | opinie | lista DTO opinii z wizyt `bookedByUserId = sessionUserId` |
| `findReviewTargetForUser(sessionUserId, appointmentId)` | opinie | `{appointmentId, salonId, employeeId, clientId, status}` albo `null` |
| `listClientWaitingList(verifiedEmail)` | lista oczekujących | lista DTO, bez kolumn kartoteki klienta i bez `accept_token` |
| `findClientWaitingEntryForUser(verifiedEmail, entryId)` | lista oczekujących | `{entryId, salonId, clientId}` albo `null` |
| `listFavoriteSalons(sessionUserId)` | ulubione | lista DTO z kolumnami katalogu publicznego (jak `PublicSalonCatalogEntry`, bez statystyk) |
| `isFavoriteSalon(sessionUserId, salonId)` | ulubione | `boolean` |

Zasady:
- przedrostek `find…ForUser` dla funkcji, które zwracają `salonId` do zapisu;
- `list…` i `get…` dla odczytów, które wychodzą do odpowiedzi;
- w nazwie nie ma słowa „system”;
- typy DTO są eksportowane razem z funkcją.

Każdy nowy eksport oznacza trzy zmiany: `system/index.ts`, `REGISTRY_SOURCES` i migawkę testu rejestru, w tym samym commicie.

### 2.7 Co jest zakazane

1. **`salonId` z body, query, parametrów adresu albo nagłówka jako kontekst `forSalon` dla istniejącego wiersza.** Kontekst dla istniejących wierszy daje wyłącznie wynik `find…ForUser`. Jedyny wyjątek to zamknięta lista (a)–(c) z sekcji 2.3 dla salonu-celu nowego wiersza.
2. **Tożsamość spoza sesji.** `userId` i e-mail z body albo query nie trafiają do S ani do `where`. Nie wolno też dopasowywać kartoteki po e-mailu niezweryfikowanym.
3. **`select()` bez listy kolumn, puste `returning()` i wybór całej tabeli** (`{ salon: salons }`) w każdym odczycie i zapisie tras portalu, w ich transakcjach F i w `system/client-portal.ts`. Także tam, gdzie do odpowiedzi trafiają tylko dwa pola: pełny wiersz w pamięci łatwo jutro trafia do odpowiedzi albo do logu.
4. **Funkcje zapisujące w `system/client-portal.ts`.**
5. **Skutki uboczne (zwrot, zatrzymanie zadatku, powiadomienia) uruchomione przed zapisem albo przy 0 wierszy z `returning`.**
6. **Rozróżnianie „cudze” i „nie istnieje”** kodem statusu albo treścią odpowiedzi.
7. **Nowa trasa portalu z surowym `db`.** Po ostatnim kroku portalu pliki portalu schodzą z listy przejściowej lintu i wracają tylko przez zmianę tej listy, którą zatwierdza CTO.

Recenzja bezpieczeństwa każdego kroku sprawdza zakazy 1–6 wprost w diffie. Zakaz 3 pilnuje dodatkowo test kluczy odpowiedzi. Zakaz 7 egzekwuje lint.

---

## 3. Dowód: test na prawdziwej bazie

Każdy krok od anulowania do ulubionych dodaje przypadki do jednego pliku `__tests__/pg/client-portal.pg.test.ts`. Plik jest wspólny, a przypadki dopisuje kolejny krok. Dane startowe:

- **salon A i salon B**;
- **użytkownik X**: wizyty w A i w B, wpis na liście oczekujących w A (zweryfikowany e-mail), ulubiony salon B;
- **użytkownik Y**: wizyta **w tym samym salonie A** i kartoteka w A o innym e-mailu;
- **użytkownik P**: personel salonu A, który dodał w panelu wizytę dla innego klienta;
- płatność zadatku `succeeded` dla wizyty X w A, potrzebna w kroku anulowania.

Wymagane przypadki dla każdej funkcji S i każdej trasy:

1. X widzi swoje wiersze z A i z B, a nie widzi wierszy Y. Sprawdzamy dokładny zbiór identyfikatorów, nie samą liczbę.
2. Y nie widzi żadnego wiersza X, ani w A, ani w B.
3. `find…ForUser(Y, wizyta X)` zwraca `null`, a trasa odpowiada 404 bez zapisu. Po przypadku liczymy wiersze tabeli: bez zmian.
4. **Dokładny zbiór kluczy odpowiedzi trasy** (`Object.keys(...).sort()` przez `toEqual`, test jednostkowy na trasę, także dla obiektów zagnieżdżonych), a dla funkcji S dodatkowo dokładny zbiór kluczy DTO. Ten przypadek maszynowo pilnuje listy dozwolonych pól z sekcji 2.5. Sam test DTO nie wystarcza, bo trasa może dokleić dane spoza S.

Wymagane przypadki dla zapisu przez F, **pod rolą aplikacji**:

5. `forSalon(A)` z identyfikatorem wizyty z B daje 0 wierszy. RLS i filtr działają tu razem.
6. `forSalon(A)` z wizytą X i `sessionUserId = Y` daje 0 wierszy, bo zadziałał ponowny warunek tożsamości.
7. Dwa równoległe anulowania tej samej wizyty: dokładnie jedno zwraca wiersz. Test biegnie na **dwóch osobnych połączeniach** z barierą startu, tak że oba UPDATE są w locie jednocześnie. Wywołanie po kolei nie dowodzi wyścigu.
8. Tylko krok anulowania: odczyt płatności w kontekście salonu wizyty widzi płatność `succeeded`, a decyzja to „zwrot”, nie „rozlicza salon”. To jest dowód na skutek 3 z sekcji 1.
9. Wizyta dodana przez personel P w salonie A nie jest widoczna w portalu konta P i nie da się jej anulować przez portal: 404, liczba wierszy bez zmian. To dowód na O6.
10. Lista oczekujących: `salonId = A` z `serviceId` albo `preferredEmployeeId` z B daje 404 i 0 nowych wierszy w `waiting_list` i `clients`. INSERT pod `forSalon(A)` z `salonId = B` w wartościach zostaje odrzucony przez `WITH CHECK`.
11. Ulubione: Y usuwa ulubiony salon B użytkownika X i dostaje 0 wierszy. Ulubiony X zostaje.

**Odmiany obowiązkowe w opisie PR** (wykonawca pokazuje każdy czerwony przebieg):
- usunięcie warunku tożsamości z jednej funkcji S zaczerwienia co najmniej przypadek 1 albo 2;
- usunięcie ponownego warunku tożsamości w zapisie zaczerwienia przypadek 6;
- usunięcie warunku stanu z `where` zapisu anulowania zaczerwienia przypadek 7. Bez tej odmiany przypadek 7 może przechodzić z przypadku, a nie dzięki warunkowi.

Krok push nie ma polityki do dowodzenia. Wystarczy mu test jednostkowy z dwoma użytkownikami.

---

## 4. Kolejność kroków

| Krok (zakres) | Przed pilotażem? | Uzasadnienie |
|---|---|---|
| **ten ADR** | **tak** | Blokuje kroki od anulowania do ulubionych. |
| **rezerwacja przez personel bez rezerwującego**: w `api/appointments/route.ts` `bookedByUserId = isStaff ? null : session.user.id`, plus przypadek 9 testu; osobna poprawka, pełny proces, bo dotyczy rozdzielenia klientów | **tak**, warunek wstępny kroku anulowania | Bez tego warunek tożsamości po `booked_by_user_id` nie wskazuje klienta (O6). Przed prawdziwymi danymi jednorazowe sprawdzenie bazy pilotażu: liczba wizyt, w których `booked_by_user_id` należy do personelu salonu. Oczekiwane 0. Jeśli nie 0, decyzja o wyczyszczeniu idzie do właściciela firmy, bo to zapis na bazie. |
| **anulowanie przez klienta**: `client/appointments/[id]/cancel`, nowy `system/client-portal.ts`, `system/index.ts` | **tak** | Jedyna trasa portalu, w której klient zmienia dane salonu i uruchamia decyzję o zadatku. Dodaje warunek stanu w zapisie, jawne `returning` i odczyt płatności w kontekście salonu. Rusza dopiero po scaleniu poprawki rezerwacji przez personel. |
| **notatki personelu poza portalem**: bez `notes` w liście wizyt, bez `notes` w szczególe, `treatment` w szczególe ograniczone do jawnych kolumn bez `notes`, `materials_json`, `recipe` i `techniques`; test kluczy odpowiedzi | **tak** | `notes` to notatka personelu (2.5). 2 pliki kodu i test, lżejszy proces. |
| lista i szczegół wizyt klienta | nie | Odczyt. Dziś ma warunek `bookedByUserId`. Przed przełączeniem puli zmienia tylko kształt kodu, nie zachowanie. Przed tym krokiem COO rozstrzyga `recipe`, `techniques` i `photo_url`. |
| opinie (zapis przez `findReviewTargetForUser` i F, lista przez S) | nie | |
| lista oczekujących (tożsamość: zweryfikowany e-mail; zapis według 2.3) | nie | |
| ulubione (lista przez S, zapisy przez F według 2.3) | nie | Zmiana względem planu: zapisy przez F. Wykonawca najpierw sprawdza na main, czy trasy `favorites/salons/**` jeszcze istnieją. Plan wejścia na rynek chowa katalog salonów i razem z nim ulubione. Jeśli trasy są albo mają być usunięte, krok sprowadza się do usunięcia tras, bez funkcji S `listFavoriteSalons` i `isFavoriteSalon`. |
| push subscribe/unsubscribe (S w `system/notifications.ts`) | nie | Lżejszy proces: tabela użytkownika, bez danych salonu. |

Kroki od anulowania do ulubionych scalają się po kolei, bo dzielą `system/client-portal.ts` i `system/index.ts`.

**Termin dla kroków po pilotażu:** pierwsze z trzech zdarzeń:
- salon spoza pilotażu;
- publiczny katalog salonów z rezerwacją kont klientów;
- **przełączenie puli**. Ten termin jest twardy: bez tych kroków portal po przełączeniu po cichu przestanie działać, zgodnie z sekcją 1.

**Bramka przełączenia puli:** przełączenie puli nie rusza, dopóki wszystkie kroki portalu (od listy i szczegółu wizyt do push) nie są scalone. Sama zmiana bazy na nowego dostawcę tego terminu nie odpala, bo login aplikacji zostaje rolą właściciela tabel.

---

## 5. Odrzucone warianty

| Wariant | Opis | Dlaczego odrzucony |
|---|---|---|
| **A: bez zmian** | Surowe `db` z adnotacją „user-scoped” zostaje na stałe jako wyjątek lintu. | Lista przejściowa nigdy nie dojdzie do zera, a reguła lintu nie przejdzie na `error`. Po przełączeniu puli portal zepsuje się po cichu (sekcja 1). Zostaje jedna tama bez nazwanego kontraktu i bez testu na bazie. |
| **B: `forUser` + polityki RLS po użytkowniku** | Nowa zmienna `app.current_user_id` i polityki na `appointments`, `reviews`, `waiting_list`, `favorite_salons`, `clients` (`booked_by_user_id`, `client_user_id`, e-mail). | Wymaga migracji polityk na produkcji, czyli czerwonej linii w trakcie przenosin bazy. Druga oś polityk łączy się przez OR z `tenant_isolation`, więc błąd w jednej polityce może otworzyć odczyt personelowi albo klientowi. Trzeba by przejrzeć testy RLS wszystkich tabel. Dopasowanie po zweryfikowanym e-mailu w polityce oznacza zależność od tabeli `user` w RLS. Koszt jest nieproporcjonalny przy jednym salonie. Wariant B też wymaga spełnienia O6. **Wariant B to kierunek docelowy z progiem (sekcja 6).** |
| **C: pętla `forSalon` po salonach użytkownika** | Odczyt listy salonów użytkownika, potem osobna transakcja `forSalon` na każdy salon. | Pierwszy krok i tak jest odczytem przez wiele salonów (czyli S). Wychodzi N transakcji na jedno żądanie bez dodatkowej ochrony. Problem wycieku między klientami tego samego salonu zostaje bez zmian. |
| **D: funkcje `SECURITY DEFINER` albo widoki w bazie** | Logika odczytu portalu w SQL, wywoływana przez rolę aplikacji. | Wymaga migracji na produkcji, czyli czerwonej linii. Logika przenosi się do SQL, który gorzej się testuje i recenzuje. Funkcja `SECURITY DEFINER` z błędem w warunku to ten sam wyciek co błąd w S, tylko mniej widoczny w diffie. |
| **S dla zapisów** | Zapisy portalu, na przykład ulubionych, przez pulę systemową. | Zapis pod F ma RLS (`WITH CHECK`) za darmo. Zapis przez pulę systemową poszerza obszar bez RLS bez żadnego zysku. Dopuszczone tylko dla tabel bez `salon_id` (sekcja 2.4). |
| **Typ markowany tożsamości** (`PortalIdentity` budowany tylko z wyniku `requireAuth`) | Kompilator pilnuje, że do S trafia tylko tożsamość z sesji. | Wartościowy, ale wymaga zmiany `src/lib/auth-middleware.ts` (kod logowania, pełny proces) i funkcji synchronicznej poza regułami rejestru. Na betę wystarczy zakaz 2 i recenzja. Wraca razem z progiem wariantu B. |

---

## 6. Ryzyko szczątkowe i próg zmiany decyzji

**Ryzyko główne:** odczyt portalu nie ma RLS. Błąd warunku tożsamości w funkcji S oznacza wyciek. Dotyczy to wycieku między klientami **tego samego** salonu. Tenant RLS go nie łapie, bo obaj klienci są w jednym salonie. Łapie go tylko wariant B. Przypadki 1, 2, 9 i odmiany z sekcji 3 to jedyna maszynowa ochrona.

**Ryzyko przyjęte z progiem: lista oczekujących przyjmuje dowolny salon po UUID.** W kodzie nie ma warunku „salon przyjmuje rezerwacje”. Katalog filtruje tylko po kompletnym profilu, a sama rezerwacja przyjmuje dowolny salon po UUID, więc lista oczekujących nie jest słabsza od rezerwacji. Skutek: konto może wpisać imię, e-mail i telefon do kartoteki salonu, którego klient nie zna z katalogu, i potem dostawać stamtąd SMS. Jedyną ochroną jest dziś niezgadywalność UUID. Pilotażu to nie blokuje. Naprawa to jedna wspólna funkcja „salon przyjmuje rezerwacje” dla rezerwacji i listy oczekujących, nie kopia filtra katalogu. Próg: pierwsze z dwóch zdarzeń, czyli salon spoza pilotażu albo salon testowy lub demonstracyjny na produkcji.

**Przegląd decyzji w stronę wariantu B** (nowy ADR, recenzja CRCO, migracja polityk za zgodą właściciela firmy) następuje przy pierwszym z poniższych:
1. przełączenie puli (pula systemowa staje się wtedy jedyną drogą bez RLS, a portal jest jej największym użytkownikiem poza zadaniami cron);
2. salon spoza pilotażu z publicznym katalogiem i kontami klientów;
3. trzecia funkcja S portalu bez przypadków 1–4 w teście na bazie;
4. zgłoszenie albo log wskazujący, że klient zobaczył cudzy wiersz.

---

## 7. Rozstrzygnięcia pytań otwartych z v1.0

1. **`appointments.notes`** to notatka personelu. Krok „notatki personelu poza portalem” idzie przed pilotaż (sekcje 2.5 i 4).
2. **Warunek „salon przyjmuje rezerwacje” dla listy oczekujących** nie blokuje pilotażu. Ryzyko z progiem w sekcji 6.
3. **Lista zakazanych kolumn** potwierdzona i uzupełniona (tabela w 2.5).
4. **Kolejność wobec kont klientów w pilotażu.** Przy kontach i przy samych gościach wychodzi ten sam podział. Krok anulowania zostaje przed pilotażem: koszt to jeden PR, a jeśli konta istnieją, zamyka jedyny zapis portalu.
5. **Zapisy ulubionych przez F** zatwierdzone. Warunek polityki z `WITH CHECK` potwierdzony (sekcja 2.3).

**Decyzje, które zostają otwarte:** pokazywanie `treatment_history.recipe`, `treatment_history.techniques` i `employees.photo_url` w portalu. Właściciel: COO z właścicielem salonu. Termin: przed krokiem listy i szczegółu wizyt. Do decyzji pola nie są pokazywane.

---

## 8. Poprawka do ADR-001

ADR-001 (sekcja R2b, decyzja 2) zakładał, że polityka RLS tabeli `salons` działa po `owner_id`, i wymagał akcesora `forOwner`. To jest nieaktualne. Obecna polityka to `tenant_self` po `id = app.current_salon_id` (`drizzle/0010_rls_policies_nullif.sql`). Dlatego `forSalon(salonId)` czyta własny wiersz salonu, `forOwner` nie jest potrzebny, a sekcja 2.3 tego ADR korzysta z tej właściwości przy sprawdzaniu istnienia salonu-celu. Adnotacje w kodzie, które mówią o „polityce po owner_id”, poprawiamy przy pierwszej zmianie każdego pliku.

---

## 9. Do zleceń kroków (bez zmiany decyzji)

- **Anulowanie:** w zakresie są oba handlery trasy `client/appointments/[id]/cancel`. GET podejmuje tę samą decyzję o zadatku i pokazuje ją klientowi przed anulowaniem. Odczyt płatności idzie w obu przez ten sam predykat pod `forSalon(found.salonId)`. Inaczej po przełączeniu puli podgląd mówi „rozlicza salon”, a POST robi zwrot.
- **Lista oczekujących:** wpis z portalu zapisuje się dziś jako `source = 'legacy'`, bez autora. Krok ma zapisywać `source = 'client_portal'`, `clientRequestConfirmedAt = now()` i `createdByUserId = sessionUserId`. To ślad audytowy pochodzenia wpisu.
- **Lista oczekujących, ryzyko znane:** tożsamość po e-mailu zależy od danych wpisanych przez salon. Wspólny adres albo literówka w panelu sprawia, że właściciel adresu widzi i może usunąć wpis innej osoby. Weryfikacja e-maila tego nie zamyka. Próg: pierwsze zgłoszenie dotyczące listy oczekujących uruchamia przegląd tożsamości po `created_by_user_id` zamiast po e-mailu.

---

## Self-critique (rola: principal engineer po incydencie wycieku między klientami)

1. **Warunek tożsamości mógł nie wskazywać klienta.** v1.0 zakładała, że `booked_by_user_id` to zawsze klient. Tak nie jest, gdy wizytę dodaje personel. O6, poprawka rezerwacji przed krokiem anulowania i przypadek 9 zamykają to maszynowo. Przypadek 6 by tego nie wykrył, bo tożsamość formalnie się zgadza.
2. **Jawne kolumny obejmowały tylko S.** Najpoważniejsze wycieki kolumn są dziś w trasach (puste `returning()`, doklejone wiersze). Zakaz 3 obejmuje teraz każdy odczyt i zapis tras portalu, a przypadek 4 sprawdza klucze odpowiedzi trasy.
3. **Wyjątek „salon-cel” był sprzeczny z zakazem 1.** Sekcja 2.3 ma teraz zamkniętą listę (a)–(c), więc recenzent ma jednoznaczną miarę.
4. **Test wyścigu mógł przechodzić przypadkiem.** Przypadek 7 biegnie na dwóch połączeniach z barierą, a odmiana warunku stanu musi go zaczerwienić.
5. **Ten ADR mógł powiększyć obszar bez RLS.** Zapisy idą przez F wszędzie, gdzie tabela ma `salon_id`, także dla ulubionych. Moduł S portalu tylko czyta.

Pozostała niepewność. Nie uruchamiałem kodu. Nie sprawdziłem:
- czy obecny predykat `selectSucceededDeposits` da się użyć z `tx` bez zmiany `refund.ts` (reguła podziału kroku anulowania jest w sekcji 2.2);
- czy `notifyWaitingList` działa już pod `forSalon`;
- czyj numer jest w `deposit_payments.blik_phone_number` (sprawdza wykonawca kroku listy i szczegółu wizyt).

Wykonawca kroku anulowania sprawdza pierwsze dwa punkty przed napisaniem kodu.
