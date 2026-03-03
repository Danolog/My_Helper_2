# Komenda: /faza4
# Lokalizacja: .claude/commands/faza4.md
# Użycie: wpisz /faza4 w Claude Code

## Cel: Analiza i testy wydajności

Przeczytaj TYLKO sekcję 6 ("Faza 4") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 3 jest zakończona (✅). Jeśli NIE — powiedz użytkownikowi żeby najpierw uruchomił /faza3.

## Krok 1: Statyczna analiza wydajności

### N+1 Queries
Przejrzyj src/app/api/ szukając zapytań Drizzle ORM wewnątrz pętli. Każde `db.select()` w pętli `for/map/forEach` to potencjalny N+1.

### Brakujące indeksy
Sprawdź src/lib/schema.ts — czy następujące kolumny mają indeksy:
- salonId (we WSZYSTKICH tabelach biznesowych)
- clientId (appointments, loyaltyPoints, depositPayments)
- employeeId (appointments, workSchedules, employeeCommissions)
- startTime (appointments — kluczowe dla kalendarza)
- status (appointments, salonSubscriptions)
- createdAt (wszędzie gdzie jest paginacja/sortowanie)

### Unnecessary re-renders
Sprawdź src/components/ pod kątem:
- Ciężkich komponentów BEZ React.memo (kalendarz, tabele raportów)
- Brakujących useMemo na obliczeniach w komponentach
- Brakujących useCallback na handlerach przekazywanych do children

### Memory leaks
Sprawdź src/components/ i src/hooks/ szukając:
- useEffect bez funkcji cleanup (return () => {...})
- addEventListener bez removeEventListener
- setInterval/setTimeout bez clearInterval/clearTimeout
- Subskrypcje WebSocket bez unsubscribe

## Krok 2: Bundle size
```bash
ANALYZE=true pnpm build 2>&1 | tee /tmp/bundle-analysis.log
```

## Krok 3: Skrypt k6 (opcjonalny — jeśli k6 jest dostępne)

Utwórz plik tests/performance/load-test.js zgodnie z sekcją 6.2 z docs/TESTING_PLAN.md.

## Krok 4: Wygeneruj raport

Utwórz plik PERFORMANCE_REPORT.md z sekcjami:
- **N+1 Queries** — lista znalezionych + sugerowana naprawa
- **Brakujące indeksy** — lista kolumn + SQL do dodania
- **Re-renders** — lista komponentów + sugerowana naprawa
- **Memory leaks** — lista + sugerowana naprawa
- **Bundle size** — aktualny rozmiar + sugestie redukcji

## Kryterium sukcesu
- PERFORMANCE_REPORT.md istnieje i jest kompletny
- Zidentyfikowane wszystkie N+1 queries
- Sprawdzone indeksy na kluczowych kolumnach

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 4 na ✅ ZAKOŃCZONA.
Powiedz: "Faza 4 zakończona. Uruchom /orchestrator żeby przejść dalej."
