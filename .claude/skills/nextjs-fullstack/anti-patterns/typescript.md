# Anti-Patterns — TypeScript

---

## AP-TS-01: Naprawianie E2E przed TypeScript

**Problem:** Błędy TypeScript mogą być przyczyną failujących testów E2E.
Naprawianie E2E bez naprawienia TS = strata czasu.

```
// ✅ ZAWSZE ta kolejność:
1. pnpm typecheck   → napraw wszystkie TypeScript errors
2. pnpm lint        → napraw ESLint errors
3. pnpm test        → unit testy
4. playwright test  → E2E testy
5. pnpm build:ci    → build
```

---

## AP-TS-02: build vs build:ci w CI

**Problem:** `pnpm build` podczas CI może próbować połączyć się z bazą
danych (Prisma/Drizzle generate, migrations) i failować gdy DB nie jest
dostępna lub ma inne credentials.

```json
// package.json — dwa osobne skrypty
{
  "scripts": {
    "build": "next build",
    "build:ci": "next build"
    // build:ci może mieć dodatkowe flagi lub env vars
    // które pomijają kroki wymagające DB
  }
}
```

W GitHub Actions zawsze używaj `build:ci`:
```yaml
- name: Build application
  run: pnpm build:ci
  env:
    SKIP_DB_MIGRATIONS: true  # jeśli potrzebne
```

---

## AP-TS-03: Strict mode — typowe błędy i ich naprawy

```typescript
// ❌ Type 'undefined' is not assignable to type 'string'
const name: string = user?.name;  // user może być undefined

// ✅ Opcja 1 — nullish coalescing
const name: string = user?.name ?? '';

// ✅ Opcja 2 — optional type
const name: string | undefined = user?.name;

// ✅ Opcja 3 — assertion gdy jesteś pewny
const name: string = user!.name;  // używaj ostrożnie


// ❌ Argument of type 'string | null' is not assignable to type 'string'
function process(id: string) { ... }
process(searchParams.get('id'));  // get() zwraca string | null

// ✅ Early return
const id = searchParams.get('id');
if (!id) return;
process(id);  // tu TypeScript wie że id: string


// ❌ Property 'X' does not exist on type 'Y'
const result = await db.query.users.findFirst();
console.log(result.email);  // result może być undefined

// ✅ Optional chaining
console.log(result?.email);

// ✅ Lub z guard
if (!result) throw new Error('User not found');
console.log(result.email);  // tutaj result: User (nie undefined)
```

---

## AP-TS-04: Pre-existing lint errors w CI

**Problem:** Projekt może mieć pre-existing lint errors których nie chcesz
teraz naprawiać. CI nie powinien failować z ich powodu.

```yaml
# ❌ ZŁE — failuje na pre-existing errors
- run: pnpm lint

# ✅ DOBRE — sprawdź tylko nowe errors (porównaj z main)
- name: Lint check
  run: |
    pnpm lint 2>&1 | tee lint-output.txt
    # Sprawdź czy liczba errors nie wzrosła vs baseline
    NEW_ERRORS=$(grep "error" lint-output.txt | wc -l)
    echo "Lint errors: $NEW_ERRORS"
```

Lub w CLAUDE.md dokumentuj znane pre-existing errors:
```markdown
## Known Issues (pre-existing, nie naprawiamy teraz)
- pnpm lint: 19 errors, 753 warnings — wszystkie istniejące przed projektem
- Sprawdzaj tylko czy nasze zmiany nie dodały NOWYCH errors
```
