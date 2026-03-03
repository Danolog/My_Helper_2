# Komenda: /faza3
# Lokalizacja: .claude/commands/faza3.md
# Użycie: wpisz /faza3 w Claude Code

## Cel: Napisać testy E2E dla WSZYSTKICH przepływów użytkownika

Przeczytaj TYLKO sekcję 5 ("Faza 3") z docs/TESTING_PLAN.md. NIE czytaj innych sekcji.

## Warunek wstępny
Sprawdź w docs/TESTING_STATUS.md czy Faza 2 jest zakończona (✅). Jeśli NIE — powiedz użytkownikowi żeby najpierw uruchomił /faza2.

## WAŻNE: Kolejność flowów

Testuj przepływy w kolejności priorytetów. KAŻDY flow musi mieć:
- ✅ Happy path (wszystko działa poprawnie)
- ❌ Error path (co gdy coś się psuje)
- 🔲 Edge cases (granice, puste dane, timeouty)

## Flow 1 (P0): Autentykacja — tests/auth/authentication.spec.ts

Przeczytaj sekcję 5.1 z docs/TESTING_PLAN.md.
Scenariusze: rejestracja, logowanie email, logowanie Google OAuth, błędne hasło, reset hasła, timeout sesji 15min, dostęp bez logowania.

## Flow 2 (P0): Pracownicy — tests/dashboard/employees.spec.ts

Przeczytaj sekcję 5.2 z docs/TESTING_PLAN.md.
Scenariusze: dodanie, edycja, przypisanie usług, grafik, usuwanie, dostęp czasowy.

## Flow 3 (P0): Usługi — tests/dashboard/services.spec.ts

Przeczytaj sekcję 5.3 z docs/TESTING_PLAN.md.
Scenariusze: kategorie, usługa z wariantami, produkty do usługi, ceny per pracownik.

## Flow 4 (P0): Rezerwacje — tests/dashboard/appointments.spec.ts

Przeczytaj sekcję 5.4 z docs/TESTING_PLAN.md.
Scenariusze: nowa wizyta, z depozytem, z promo kodem, zakończenie, anulowanie, kolizja, pakiet.

## Flow 5 (P1): Magazyn — tests/dashboard/inventory.spec.ts

Przeczytaj sekcję 5.5 z docs/TESTING_PLAN.md.
Scenariusze: dodanie produktu, zużycie przy wizycie, alert niskiego stanu, ręczne zużycie, raport.

## Flow 6 (P1): Raporty — tests/dashboard/reports.spec.ts

Przeczytaj sekcję 5.8 z docs/TESTING_PLAN.md.
Raporty: przychody, obłożoność, wynagrodzenia, popularność usług, rentowność, materiały, anulowania, porównania.

## Flow 7 (P1): Subskrypcje — tests/dashboard/subscriptions.spec.ts

Przeczytaj sekcję 5.9 z docs/TESTING_PLAN.md.
Scenariusze: aktywacja Basic, upgrade Pro, downgrade, anulowanie, trial 14 dni, webhook Stripe.

## Flow 8 (P2): Narzędzia AI — tests/ai-tools/ai-features.spec.ts

Przeczytaj sekcję 5.6 z docs/TESTING_PLAN.md.
MOCKUJ OpenRouter API — nie wysyłaj prawdziwych requestów.
Scenariusze: chat, analytics, social post, newsletter, voice, bramka Basic, suggestions.

## Flow 9 (P2): Portal klienta — tests/client-portal/client-flows.spec.ts

Przeczytaj sekcję 5.7 z docs/TESTING_PLAN.md.
Scenariusze: przeglądanie salonów, rezerwacja, depozyt, anulowanie, opinie, ulubione, lista oczekujących.

## Po każdym flow — weryfikacja

Po napisaniu testów dla każdego flow uruchom:
```bash
npx playwright test tests/[katalog]/[plik].spec.ts
```

## Końcowa weryfikacja

```bash
npx playwright test              # wszystkie E2E
npx playwright test --reporter=html   # raport HTML
```

## Kryterium sukcesu
- Wszystkie 9 flowów ma testy
- Testy P0 (autentykacja, pracownicy, usługi, rezerwacje) — 100% zielone
- Testy P1 i P2 — minimum 80% zielone (reszta do naprawy w Fix Loop)

## Po zakończeniu
Zaktualizuj docs/TESTING_STATUS.md — zmień Fazę 3 na ✅ ZAKOŃCZONA.
W uwagach: ile flowów zielonych, ile failing.
Powiedz: "Faza 3 zakończona. Uruchom /orchestrator żeby przejść dalej."
