# Anti-Patterns — Database

Źródło: MyHelper v2

---

## AP-DB-01: N+1 Queries w pętlach

**Problem:** Każda iteracja pętli wykonuje osobne zapytanie do bazy.
Przy 10 pracownikach = 31 zapytań. Przy 100 = 301 zapytań.

```typescript
// ❌ ZŁE — N+1 (1 + N queries)
const employees = await db.select().from(employeesTable);
for (const emp of employees) {
  const appointments = await db.select()
    .from(appointmentsTable)
    .where(eq(appointmentsTable.employeeId, emp.id));
  // każda iteracja = osobny round-trip do bazy
}

// ✅ DOBRE — 2 queries total, niezależnie od liczby pracowników
const employees = await db.select().from(employeesTable);
const employeeIds = employees.map(e => e.id);

const appointments = await db.select()
  .from(appointmentsTable)
  .where(inArray(appointmentsTable.employeeId, employeeIds));

// Grupowanie w JS — zero dodatkowych queries
const appointmentsByEmployee = appointments.reduce((acc, apt) => {
  if (!acc[apt.employeeId]) acc[apt.employeeId] = [];
  acc[apt.employeeId].push(apt);
  return acc;
}, {} as Record<string, typeof appointments>);
```

**Wynik z MyHelper v2:**
```
employee-occupancy:  31 queries → 4 queries (87% redukcja)
employee-popularity: 21 queries → 3 queries (86% redukcja)
```

---

## AP-DB-02: Brak idempotentności w seed

**Problem:** Czysty `insert` failuje gdy dane już istnieją.
CI uruchamia seed przed każdym testem → po drugim uruchomieniu: błąd.

```typescript
// ❌ ZŁE — failuje przy ponownym uruchomieniu
await db.insert(users).values({ email: 'test@test.com', ... });

// ✅ DOBRE — bezpieczne wielokrotne uruchomienie
await db.insert(users)
  .values({ email: 'test@test.com', emailVerified: true, ... })
  .onConflictDoUpdate({
    target: users.email,
    set: { emailVerified: true, updatedAt: new Date() }
  });
```

---

## AP-DB-03: Better Auth — brak wpisu w tabeli verification

**Problem:** Better Auth z `requireEmailVerification: true` sprawdza
osobną tabelę `verification`, nie tylko pole `emailVerified` w tabeli `user`.
Seed który ustawia tylko `emailVerified: true` nie wystarczy.

```typescript
// ❌ ZŁE — samo pole emailVerified nie wystarczy dla Better Auth
await db.insert(users).values({
  email: 'test@test.com',
  emailVerified: true, // Better Auth to ignoruje!
});

// ✅ DOBRE — wpis w tabeli verification jest wymagany
await db.insert(users).values({
  email: 'test@test.com',
  emailVerified: true,
}).onConflictDoUpdate({ target: users.email, set: { emailVerified: true } });

// KRYTYCZNE: dodaj też wpis verification
await db.insert(verifications).values({
  identifier: 'test@test.com',
  value: 'verified',
  expiresAt: new Date('2099-12-31'),
}).onConflictDoNothing();
```

---

## AP-DB-04: Brak composite indexes dla często odpytywanych kolumn

**Problem:** Bez indeksów PostgreSQL robi Seq Scan (przegląda całą tabelę).
Przy 10k+ rekordach → dramatyczne spowolnienie.

```sql
-- ❌ ZŁE — brak indeksów na często filtrowanych kolumnach
SELECT * FROM appointments 
WHERE salon_id = $1 AND status = $2 AND start_time > $3;
-- → Seq Scan: ~50ms

-- ✅ DOBRE — composite index dla tego konkretnego zapytania
CREATE INDEX CONCURRENTLY idx_appointments_salon_status_time 
ON appointments(salon_id, status, start_time);
-- → Index Scan: 0.15ms
```

**W Drizzle ORM:**
```typescript
// schema.ts
export const appointmentsTable = pgTable('appointments', {
  // ... kolumny
}, (table) => ({
  // Composite index dla zapytań po salonie
  salonStatusTimeIdx: index('idx_apt_salon_status_time')
    .on(table.salonId, table.status, table.startTime),
  // Composite index dla zapytań po pracowniku  
  employeeStatusTimeIdx: index('idx_apt_emp_status_time')
    .on(table.employeeId, table.status, table.startTime),
}));
```

**Kiedy dodawać indeksy:**
- Kolumny w `WHERE` + `ORDER BY` → composite index
- Foreign keys używane w JOIN → single index
- Kolumny z wysoką selektywnością (uuid, email) → single index
- Kolumny z niską selektywnością (status: 3 wartości) → tylko w composite

---

## AP-DB-05: Podatności w zależnościach — pnpm overrides

**Problem:** Tranzytywne zależności (paczka zależna od paczki)
często mają podatności których nie możesz naprawić przez direct update.

```json
// ✅ DOBRE — wymuś bezpieczną wersję przez overrides
// package.json
{
  "pnpm": {
    "overrides": {
      "bn.js": ">=4.12.3",
      "qs": ">=6.14.2",
      "esbuild": ">=0.25.0",
      "dompurify": ">=3.3.2"
    }
  }
}
```

**Po dodaniu overrides:**
```bash
pnpm install
pnpm audit  # powinno pokazać 0 vulnerabilities
pnpm test   # sprawdź czy nic nie zepsuło
```

**Uwaga:** Nie dodawaj override dla paczek które nie są podatne —
możesz zepsuć ESLint lub inne narzędzia (jak było z minimatch w MyHelper).
