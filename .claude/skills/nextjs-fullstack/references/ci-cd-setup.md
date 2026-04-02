# CI/CD Setup — GitHub Actions

## Architektura trzech warstw

```
Każdy PR/commit  →  @smoke   →  < 4 minuty   (obowiązkowy)
Merge to main    →  @full    →  < 20 minut   (obowiązkowy)
Po deploy Vercel →  @production → < 1 minuta (informacyjny)
```

---

## .github/workflows/quality-gate.yml

```yaml
name: Quality Gate

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  # ─── 1. TypeScript ───────────────────────────────────────────
  typecheck:
    name: TypeScript Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  # ─── 2. Unit Tests ───────────────────────────────────────────
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/

  # ─── 3. Security ─────────────────────────────────────────────
  security:
    name: Security Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level=critical

  # ─── 4. E2E Smoke ────────────────────────────────────────────
  e2e-smoke:
    name: E2E Smoke Tests
    runs-on: ubuntu-latest
    needs: [typecheck, unit-tests, security]  # czeka na poprzednie
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: dev_user
          POSTGRES_PASSWORD: dev_password
          POSTGRES_DB: pos_dev
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://dev_user:dev_password@localhost:5432/pos_dev
      BETTER_AUTH_BASE_URL: http://localhost:3000
      BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
      # Dodaj inne wymagane env vars tutaj
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium --with-deps

      - name: Build application
        run: pnpm build:ci

      - name: Run DB migrations
        run: pnpm db:migrate

      - name: Seed test data
        run: pnpm db:seed:test

      - name: Start server
        run: pnpm start &
        
      - name: Wait for server
        run: npx wait-on http://localhost:3000 --timeout 60000

      - name: Run smoke tests
        run: pnpm exec playwright test --grep @smoke --workers=4 --retries=1

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-smoke-report
          path: |
            test-results/
            playwright-report/

  # ─── 5. E2E Full (tylko main) ────────────────────────────────
  e2e-full:
    name: E2E Full Tests
    runs-on: ubuntu-latest
    needs: [e2e-smoke]
    if: github.ref == 'refs/heads/main'
    timeout-minutes: 35
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: dev_user
          POSTGRES_PASSWORD: dev_password
          POSTGRES_DB: pos_dev
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgresql://dev_user:dev_password@localhost:5432/pos_dev
      BETTER_AUTH_BASE_URL: http://localhost:3000
      BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium --with-deps
      - run: pnpm build:ci
      - run: pnpm db:migrate
      - run: pnpm db:seed:test
      - run: pnpm start &
      - run: npx wait-on http://localhost:3000 --timeout 60000

      - name: Run full E2E tests
        # GitHub Actions runner ma 2 CPU — więcej workers = wolniej
        run: pnpm exec playwright test --grep @full --workers=2 --retries=1

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-full-report
          path: playwright-report/
```

---

## .github/workflows/e2e-production.yml

```yaml
name: E2E Production Tests

on:
  # Uruchamia się automatycznie po każdym deploy na Vercel
  deployment_status:

jobs:
  e2e-production:
    name: Production Health Check
    # Tylko gdy deploy się powiódł
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium --with-deps

      - name: Run production tests
        run: pnpm exec playwright test --grep @production --workers=2
        env:
          # URL pobierany z GitHub Secret — nigdy nie hardcoduj
          PRODUCTION_URL: ${{ secrets.BETTER_AUTH_BASE_URL_PROD }}
          BASE_URL: ${{ secrets.BETTER_AUTH_BASE_URL_PROD }}

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: production-test-report
          path: playwright-report/
```

---

## Sekrety do ustawienia w GitHub

Idź do: GitHub repo → Settings → Secrets → Actions

```
BETTER_AUTH_SECRET         → klucz do podpisywania sesji
BETTER_AUTH_BASE_URL_PROD  → https://twoja-domena.vercel.app
DATABASE_URL               → (opcjonalnie, jeśli testy łączą się z zewnętrzną DB)
```

**Zasada:** lokalne URL (localhost) — bezpieczne w kodzie.
Produkcyjne URL i sekrety — tylko przez GitHub Secrets.

---

## package.json — wymagane skrypty

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "build:ci": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "db:migrate": "drizzle-kit migrate",
    "db:seed:test": "tsx scripts/seed-test.ts"
  }
}
```

> Uwaga: `build:ci` może być identyczny z `build` lub
> pomijać kroki wymagające połączenia z DB podczas kompilacji.
> Zależy od konfiguracji projektu.

---

## Optymalizacja czasu CI

```
Problem: 173 testy × 30s timeout × 2 retry = 3h
Rozwiązanie:

@smoke w CI:
  workers: 4, timeout: 10s, retries: 0 → < 4 min

@full w CI:
  workers: 2 (GitHub runner ma 2 CPU — więcej = wolniej!)
  timeout: 30s, retries: 1 → < 20 min

@production:
  workers: 2, timeout: 15s, retries: 1 → < 1 min
```

> ⚠️ GitHub Actions free runner ma 2 vCPU.
> Ustawianie workers > 2 paradoksalnie SPOWALNIA testy przez
> context switching. Zawsze testuj lokalnie z `workers=2`
> przed pushem do CI.
