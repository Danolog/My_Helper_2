## Aktywny Audit (marzec 2026)

Pełny raport: docs/AUDIT_2026-03.md

### Ocena
| Obszar | Ocena |
|--------|-------|
| Architektura | 8/10 |
| Bezpieczeństwo | 3/10 — 91 endpointów bez auth |
| Performance | 6/10 — N+1 w cron jobs |
| Code Quality | 7/10 — console.log, memory leaks |
| Testy | 7/10 — brakują edge cases |

### Priorytet 0: BLOKERY (przed produkcją)
1. Auth middleware → stwórz requireAuth(role?) w src/lib/auth-middleware.ts → dodaj do 91 API routes
2. TypeScript errors → napraw waiting-list.ts, subscriptions/cancel
3. Brakujące FK → schema.ts (fiscalReceipts, appointmentMaterials, appointments)
4. N+1 queries → batch insert w newsletter send, batch update w push reminders cron

### Priorytet 1: Stabilność
5. Dodaj 6 brakujących indeksów (appointments.serviceId, pushSubscriptions.userId, clients.birthday)
6. Unique constraints (favoriteSalons, employeeServices, loyaltyPoints)
7. Zod validation na 62 endpointach POST/PUT/PATCH
8. Update vulnerable deps (xlsx, jsPDF, minimatch)

### Priorytet 2: Jakość
9. Usuń 254 console.log → structured logging
10. Cleanup useEffect (5 bez cleanup, 11 bez AbortController)
11. Napraw 20 unused variables + 15 null checks
12. Error states w komponentach (calendar, employees)
13. Brakujące testy (transactions, load, error scenarios)

### Zasady napraw
- Po każdej naprawie: pnpm typecheck && pnpm test
- Nie commituj z czerwonymi testami
- Jeden commit = jedna naprawa (atomic commits)
- Czytaj docs/AUDIT_2026-03.md przed każdym zadaniem
