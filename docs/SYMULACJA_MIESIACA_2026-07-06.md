# Symulacja miesiąca działania salonu + audyt endpointów (2026-07-06)

Po zmergowaniu napraw z UAT (`docs/UAT_2026-07-06.md`) przeprowadzono symulację
miesiąca operacji salonu "Salon Darek Testowy" (`3c0b7926-…`): zasianie historii
wizyt za okres 2026-06-08…07-05, a następnie przejście przez wszystkie domeny
API i kluczowe przyciski panelu na żywo (Playwright).

## Zakres i skala

- **60 wizyt** w bazie (38 completed, 11 cancelled, 8 scheduled, 3 no_show) — realistyczny mix statusów
- **10 klientów**, 3 pracowników, 4 usługi, 3 produkty, 1 promocja + 1 kod promo
- Przychód zrealizowany: **5150 PLN** (37 wizyt w oknie raportu), wskaźnik anulacji **19%**
- Metoda: bulk-historia zasiana przez SQL (limiter anty-abuse — patrz S-1), pojedyncze flow mutacji testowane przez UI/API w normalnym tempie

## Co zweryfikowano jako działające

**Raporty (14/14)** — wszystkie zwracają poprawne dane na zasianym miesiącu:
przychody (breakdown wg usług/pracowników), popularność usług i pracowników,
obłożenie, wynagrodzenia, rentowność usług, materiały, materiały P&L, promocje,
anulacje (19%), porównanie miesięczne (czerwiec 4130 PLN vs lipiec) i roczne.
Eksporty **PDF (`%PDF-1.3`), XLSX (zip/PK), CSV (BOM+PL)** — pobrane i zweryfikowane binarnie.

**AI biznesowy (8/8)** — analytics, alerts (wykrył krytyczny wskaźnik anulacji),
daily/weekly recommendations, suggestions, trends, review-alerts, usage. Wszystkie 200.

**AI content** — chat biznesowy (renderuje po naprawie B-1), social-post, opis usługi,
kategoryzacja, wyszukiwanie NL, newsletter, baner (Imagen 4 po B-2), **AI Insights klienta**
(churn 2/10, 9 wizyt/24 dni, sugestie akcji z danych).

**Rdzeń operacyjny** — CRUD klientów, tworzenie wizyt, **zakończenie wizyty z auto-odliczeniem
magazynu** (Szampon 1→0), zapis receptury do historii zabiegu, prowizja pracownika (50%→60 PLN),
alert niskiego stanu (typ `system`). Kody promocyjne (create+validate), lojalność, lista oczekujących.

**38/38 podstron dashboardu** zwraca 200, **konsola: 0 błędów** (globalny efekt naprawy CSP z B-10/B-11).

**Tracking AI** — licznik zużycia pokazuje 7 zapytań (przed naprawą B-9 było 0).

---

## Znalezione bugi (nowe, z symulacji)

### S-1 — Limit 5 żądań/min blokuje właściciela przy zapełnianiu kalendarza [WYSOKI]

`POST /api/appointments` woła `strictRateLimit.check(ip)` (5 żądań/min per IP)
**przed** sprawdzeniem sesji — ten sam limit obowiązuje anonimowego gościa i
zalogowanego właściciela/recepcję. W symulacji batch 48 wizyt padł po 4 z
komunikatem "Zbyt wiele żądań".

**Wpływ:** salon lub recepcja umawiający rano kilkanaście wizyt (albo kilka walk-inów
pod rząd) z jednego IP dostanie 429 po piątej wizycie w ciągu minuty. To blokuje
podstawowy przepływ pracy panelu.

**Plik:** `src/app/api/appointments/route.ts:135-136` (limiter przed `getOptionalSession()`).

**Fix:** rozróżnić ścieżkę uwierzytelnioną (owner/employee/recepcja → `apiRateLimit`
60/min lub bez limitu) od gościa portalu (`strictRateLimit` 5/min). Sprawdzić sesję
przed limitem albo dobrać limiter po stronie roli.

### S-2 — Koszt automatycznie zużytych materiałów niewidoczny w raportach [ŚREDNI-WYSOKI]

Zakończenie wizyty odlicza produkty powiązane z usługą i zapisuje zużycie do tabeli
**`productUsage`**. Ale **wszystkie trzy raporty materiałowe** — `materials`,
`materials-profitloss`, `service-profitability` — czytają z **`appointmentMaterials`**,
która jest zapisywana wyłącznie ręcznie przez `/api/appointments/[id]/materials`.
`productUsage` nie jest czytane przez żaden raport.

**Dowód:** po odliczeniu Szampon 1→0 (2 wpisy w `productUsage`) raport materiałów
pokazuje `totalUsages: 0, totalCost: 0.00`, a rentowność usług `totalMaterialCost: 0.00`
przy przychodzie 5270 PLN.

**Wpływ:** właściciel realnie zużywa magazyn na każdej wizycie, ale raport kosztów
materiałów i marża usług wiecznie pokazują zerowy koszt materiału — zafałszowana
rentowność, brak wglądu w realne koszty.

**Pliki:** zapis `src/app/api/appointments/[id]/complete/route.ts` (productUsage);
odczyt `src/app/api/reports/{materials,materials-profitloss,service-profitability}/route.ts` (appointmentMaterials).

**Fix (do decyzji):** ujednolicić na jedną tabelę — albo complete zapisuje też do
`appointmentMaterials`, albo raporty czytają z `productUsage` (lub UNION obu źródeł).
Rekomendacja: raporty jako źródło prawdy powinny sumować oba (auto + ręczne).

### S-3 — Sekcja "Użyte materiały" w dialogu zakończenia jest tylko do odczytu [NISKI]

Dialog "Zakończ wizytę" pokazuje "Użyte materiały (0) — brak dodanych materiałów",
ale nie ma przycisku dodania materiału. Ręczne materiały (jedyne źródło danych dla
raportów — patrz S-2) można dodać tylko osobnym endpointem, bez ścieżki w UI dialogu.
Powiązane z S-2 — jeśli raporty zostaną przepięte na `productUsage`, ta sekcja i tak
wymaga przycisku "Dodaj materiał" dla przypadków spoza auto-odliczenia.

---

## Obserwacje (nie bugi / decyzje produktowe)

- **API przyjmuje wizyty z datą w przeszłości** (201) — panel blokuje to tylko walidacją
  klienta (`appointmentDate < todayStr` w dialogu). Portal/booking używa available-slots
  (naprawione w B-5). Rozważyć twardą walidację serwerową dla spójności, jeśli tworzenie
  wizyt wstecz nie jest celowe (np. rejestracja historycznej wizyty).
- **Email z polskim znakiem** (`jan.bąk@example.com`) odrzucony (400 "Wprowadź poprawny
  adres email"). Zgodne z większością systemów (IDN to edge case) — akceptowalne.
- **Generator postów social**: endpoint `/api/ai/content/social-post` działa i daje
  wysokiej jakości treść, ale UI `/dashboard/content-generator/social-posts` jest za
  wyłączonym modułem "Publikacja postów social" (status "Wkrótce"). Rozjazd między gotową
  zdolnością backendu a zablokowanym frontem — decyzja produktowa, kiedy odsłonić.

---

## Plan naprawy

| # | Zadanie | Znalezisko | Priorytet | Effort |
|---|---------|-----------|-----------|--------|
| 1 | Limiter wizyt zależny od roli (owner/staff vs gość) | S-1 | Wysoki | S |
| 2 | Ujednolicić źródło materiałów w raportach (productUsage + appointmentMaterials) | S-2 | Śr-wys | M |
| 3 | Przycisk "Dodaj materiał" w dialogu zakończenia | S-3 | Niski | S |
| 4 | (opcjonalnie) serwerowa walidacja daty wizyty | obserwacja | Niski | S |

Zasady jak w audycie: każdy bug od testu reprodukującego (S-1: test że zalogowany owner
tworzy >5 wizyt/min; S-2: test że raport materiałów widzi auto-odliczenie), po każdej
naprawie `pnpm typecheck && pnpm test`, atomowe commity.

## Stan po symulacji

- Naprawy UAT (B-1…B-11) zmergowane do lokalnego `main` (12 commitów; push odrzucony —
  wymaga uprawnień właściciela).
- Dane symulacji zostały w bazie Neon (60 wizyt itd.) — do ewentualnego wyczyszczenia.
- Nieprzetestowane świadomie: realne płatności Stripe/zadatki (wymaga `stripe listen`),
  wysyłka SMS/email (brak kluczy lokalnie), voice AI i video (moduły hardOff), cron jobs
  (chronione CRON_SECRET).
