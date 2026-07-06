# Katalog edge case'ów + wyniki testów na żywo (2026-07-06)

Systematyczny przegląd przypadków brzegowych dla SaaS bookingowego (MyHelper),
testowany na żywo (Playwright + API + DB) na koncie `darek.salon.test@example.com`,
salon `3c0b7926-…`. Wszystkie zanieczyszczenia testowe (w tym cross-tenant) posprzątane.

**Legenda:** ✅ zachowuje się poprawnie · ⚠️ obserwacja/decyzja · 🐛 bug

---

## Podsumowanie znalezisk

| ID | Waga | Skrót |
|----|------|-------|
| **X-1** | 🔴 KRYTYCZNY | Broken access control / IDOR — cross-tenant odczyt raportów i zapis (owner omija dopasowanie salonu) |
| **X-2** | 🟠 ŚREDNI | Niewalidowany input → 500 zamiast 400 (zły UUID, nieistniejący FK, zły format daty, cena poza zakresem) |
| **X-3** | 🟡 NISKI | Promocja z datą końca < startu przyjmowana (brak walidacji krzyżowej) |
| **X-4** | 🟡 NISKI | Brak limitu długości nazw klienta/usługi (300 znaków przechodzi) |
| — | ⚪ obserwacje | Wizyty w przeszłości dozwolone przez API; brak górnego limitu długości wizyty; XSS przechowywany surowo (bezpieczny dzięki escapingowi React) |

---

## X-1 — Broken access control / multi-tenancy [KRYTYCZNY]

Zalogowany właściciel salonu A może czytać dane i pisać do salonu B, podając cudze
`salonId`. Zweryfikowane na żywo (dane po teście usunięte):

- **Zapis cross-tenant:** `POST /api/clients` i `POST /api/appointments` z `salonId`
  innego salonu → **201, rekord zapisany do cudzego salonu** (potwierdzone w DB:
  klient "Intruz" i wizyta wylądowały pod `salon_id` Beauty Studio Demo).
- **Odczyt cross-tenant:** raporty (`/api/reports/*`) używają tylko `requireAuth()`
  + ufają parametrowi `salonId` — **zero sprawdzenia właściciela**. Dowolny zalogowany
  użytkownik czyta przychody/wynagrodzenia/anulacje dowolnego z 31 salonów.
  (Endpoint `/salons` publicznie listuje ID salonów.)

**Root cause (zapis):** `src/app/api/clients/route.ts` POST —
```js
if (ctx.role === "employee" || (ctx.role !== "owner" && salonId !== ctx.salonId)) → 403
```
Dla ownera cały warunek jest fałszywy → przechodzi z **dowolnym** `salonId`.
Recepcja jest ograniczona do własnego salonu, właściciel nie. Ten sam wzorzec w
`appointments` POST.

**Root cause (odczyt):** raporty (`reports/revenue`, `cancellations`,
`employee-payroll`, … — sprawdzone, 0 wystąpień `getSalonContext`/`ctx.salonId`)
biorą `salonId` z query bez weryfikacji, że należy do sesji.

**Uwaga:** odczyty przez `GET /api/clients` i `/api/appointments` SĄ bezpieczne —
używają `getSalonContext()` i ignorują parametr `salonId` (zwracały moje dane, nie
cudze). Luka dotyczy raportów (odczyt) i POST-ów (zapis).

**Fix:** wszędzie ignorować `salonId` z body/query i używać `ctx.salonId` z sesji,
albo twardo weryfikować `salonId === ctx.salonId` (także dla ownera). Raporty muszą
przejść na `getSalonContext()`.

---

## Wyniki szczegółowe wg grup

### A. Rezerwacje i kalendarz
| # | Edge case | Wynik |
|---|-----------|-------|
| A1 | Kolizja terminu (overlap) | ✅ 409 |
| A2 | Poza godzinami pracy | ✅ ostrzeżenie (fix B-4) |
| A4 | Wizyta w przeszłości (API) | ⚠️ 201 (panel blokuje tylko client-side) |
| A5 | endTime < startTime | ✅ 400 |
| A6 | endTime == startTime (0 czasu) | ✅ 400 |
| A7 | Wizyta 26h | ⚠️ 201 (brak górnego limitu) |
| A8 | Wizyta przez północ | ✅ 201 spójnie |
| A9 | Nieistniejący employeeId (poprawny UUID) | 🐛 500 (FK → powinno 400/404) |
| A9b | Nieistniejący serviceId | 🐛 500 |
| A9c | Malformed UUID `not-a-uuid` | 🐛 500 (brak walidacji formatu) |
| A10 | Anulowanie już anulowanej | ✅ 400 "już anulowana" |
| A11 | Zakończenie już zakończonej | ✅ 400 "już zakończona" |
| A12 | Zakończenie anulowanej | ✅ 400 "nie można zakończyć anulowanej" |

### B. Klienci
| # | Edge case | Wynik |
|---|-----------|-------|
| B2 | Imię 300 znaków | 🐛 201 (brak limitu długości — X-4) |
| B3 | XSS `<script>` w imieniu/notatce | ✅ zapis surowy, render escapowany (React) — nieaktywne |
| B4 | SQL injection `'; DROP TABLE` | ✅ zapisane jako literał (parametryzacja) |
| B5 | Emoji/unicode `Zoë 🎨 Łódź` | ✅ 201 |
| B6 | Puste firstName/lastName | ✅ 400 |
| B7 | Zły email (bez @) | ✅ 400 |

### C. Usługi i magazyn
| # | Edge case | Wynik |
|---|-----------|-------|
| C1 | Cena ujemna | ✅ 400 (fix z pierwszego UAT) |
| C2 | Cena 0 (usługa darmowa) | ✅ 201 |
| C3 | Cena 999 999 999 (poza numeric(10,2)) | 🐛 500 (przepełnienie kolumny → powinno 400) |
| C4 | Czas trwania 0 | ✅ 400 |
| C4b | Czas trwania ujemny | ✅ 400 |
| C5 | Odliczenie > stan (complete) | ✅ clamp do 0 (`Math.max`) |
| C6 | Ujemna ilość produktu | ✅ 400 |

### D. Promocje / kody
| # | Edge case | Wynik |
|---|-----------|-------|
| D1 | Validate nieistniejącego kodu | ✅ 200 valid:false, errorType:not_found |
| D3 | Rabat > 100% | ✅ 400 "między 1 a 100" |
| D4 | Rabat ujemny | ✅ 400 |
| D5 | Data końca < data startu | 🐛 201 (brak walidacji krzyżowej — X-3) |

### E. Bezpieczeństwo / multi-tenancy → patrz X-1 (KRYTYCZNY)
| # | Edge case | Wynik |
|---|-----------|-------|
| E1 | Cross-tenant odczyt clients/appointments | ✅ bezpieczne (session-scoped) |
| E1c | Cross-tenant odczyt raportu revenue | 🐛 param-scoped → wyciek |
| E2 | Cross-tenant zapis client | 🐛 201 zapis do cudzego salonu |
| E2b | Cross-tenant zapis appointment | 🐛 201 zapis do cudzego salonu |

### F. Raporty / walidacja dat
| # | Edge case | Wynik |
|---|-----------|-------|
| F1 | dateFrom > dateTo | ✅ 200 rev=0 (puste, bezpieczne) |
| F2 | Zły format daty `garbage` | 🐛 500 (powinno 400 — X-2) |
| F3 | Zakres w przyszłości | ✅ 200 rev=0 |
| F4 | Brak salonId | ✅ 400 |

---

## Plan naprawy (proponowana kolejność wg wagi)

| # | Zadanie | Znalezisko | Priorytet |
|---|---------|-----------|-----------|
| 1 | Tenancy: ignorować salonId z body/query, używać ctx.salonId — POST clients/appointments + wszystkie raporty na getSalonContext() | X-1 | 🔴 KRYTYCZNY |
| 2 | Walidacja wejścia → 400 zamiast 500: UUID format (employeeId/serviceId/clientId), istnienie FK (404), format daty w raportach, zakres ceny ≤ numeric(10,2) | X-2, A9/A9b/A9c, F2, C3 | 🟠 Średni |
| 3 | Walidacja krzyżowa dat promocji (end ≥ start) | X-3 | 🟡 Niski |
| 4 | Limit długości nazw (np. 120 zn.) w schematach Zod | X-4 | 🟡 Niski |
| 5 | (decyzja) serwerowa walidacja daty wizyty w przeszłości; górny limit długości wizyty | obserwacje | 🟡 Niski |

Zasady: każdy bug od testu reprodukującego; X-1 wymaga testów cross-tenant
(owner salonu A ↔ salon B) dla POST i raportów; po każdej naprawie
`pnpm typecheck && pnpm test`.
