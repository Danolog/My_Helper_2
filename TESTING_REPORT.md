# Testing Report — MyHelper

Generated: 2026-03-05

---

## Test Tiers Summary

| Tier | Count | Trigger | Target Time | Workers | Retries |
|------|-------|---------|-------------|---------|---------|
| @smoke | 10 | Every PR | <2 min | 4 | 0 |
| @full | 151 | Push to main (after smoke) | <15 min | 4 | 1 |
| @production | 6 | Post-deploy (Vercel) | <5 min | 2 | 1 |

---

## @smoke Tests (10)

| # | File | Test Name |
|---|------|-----------|
| 1 | `tests/auth/authentication.spec.ts` | should display login form |
| 2 | `tests/auth/authentication.spec.ts` | should register a new owner account |
| 3 | `tests/auth/authentication.spec.ts` | should login with valid credentials and redirect to dashboard |
| 4 | `tests/auth/authentication.spec.ts` | should show error for invalid credentials |
| 5 | `tests/dashboard/employees.spec.ts` | should display employees page with header and add button |
| 6 | `tests/dashboard/services.spec.ts` | should display services page with tabs |
| 7 | `tests/dashboard/appointments.spec.ts` | should display calendar page with controls |
| 8 | `tests/dashboard/reports.spec.ts` | should display finance overview page |
| 9 | `tests/client-portal/client-flows.spec.ts` | should display salon browsing page (public, no auth) |
| 10 | `tests/client-portal/client-flows.spec.ts` | should browse salons without authentication |

---

## @production Tests (6)

| # | File | Test Name |
|---|------|-----------|
| 1 | `tests/production/health.spec.ts` | should load the home page |
| 2 | `tests/production/health.spec.ts` | should load the login page with form |
| 3 | `tests/production/health.spec.ts` | should load the registration page |
| 4 | `tests/production/health.spec.ts` | should return 200 from health endpoint |
| 5 | `tests/production/health.spec.ts` | should load salon browsing page |
| 6 | `tests/production/health.spec.ts` | should load forgot password page |

All @production tests are **read-only** — no data creation, no authentication, no side effects.

---

## @full Tests — 151 total

Distributed across 9 test files:

| File | Count |
|------|-------|
| `tests/client-portal/client-flows.spec.ts` | 21 |
| `tests/ai-tools/ai-features.spec.ts` | 20 |
| `tests/dashboard/subscriptions.spec.ts` | 18 |
| `tests/dashboard/services.spec.ts` | 17 |
| `tests/dashboard/reports.spec.ts` | 16 |
| `tests/dashboard/appointments.spec.ts` | 16 |
| `tests/auth/authentication.spec.ts` | 15 |
| `tests/dashboard/inventory.spec.ts` | 15 |
| `tests/dashboard/employees.spec.ts` | 13 |

---

## CI Pipeline Stages

### quality-gate.yml (PR + main)

| Job | Trigger | Estimated Time | Depends On |
|-----|---------|---------------|------------|
| `typecheck` | PR + main | ~1 min | — |
| `unit-tests` | PR + main | ~2 min | — |
| `security` | PR + main | ~1 min | — |
| `e2e-smoke` | PR + main | ~2 min | — |
| `e2e-full` | main only | ~10 min | e2e-smoke |

**PR total: ~2 min** (typecheck + unit + security + smoke run in parallel)
**Main total: ~12 min** (parallel stage + smoke + full sequential)

### e2e-production.yml (post-deploy)

| Job | Trigger | Estimated Time |
|-----|---------|---------------|
| `e2e-production` | Vercel deploy success | ~1 min |

---

## Environment Variables Added

File: `.env.example` — 18 variables total

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_URL` | Yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Yes | Auth signing secret (min 32 chars) |
| `BETTER_AUTH_URL` | Yes | Base URL for auth callbacks |
| `NEXT_PUBLIC_APP_URL` | Yes | Public-facing app URL |
| `BASE_URL` | Yes | Playwright base URL |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `OPENROUTER_API_KEY` | No | AI via OpenRouter (Pro plan) |
| `OPENROUTER_MODEL` | No | AI model ID |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob storage |
| `STRIPE_SECRET_KEY` | No | Stripe secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing |
| `STRIPE_PRICE_BASIC` | No | Stripe Price ID for Basic plan |
| `STRIPE_PRICE_PRO` | No | Stripe Price ID for Pro plan |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | No | VAPID public key for push |
| `VAPID_PRIVATE_KEY` | No | VAPID private key |
| `VAPID_SUBJECT` | No | VAPID subject (mailto:) |

---

## Secrets to Add Manually

### GitHub Actions (Settings > Secrets > Actions)

The CI workflows use hardcoded safe defaults for most variables. You only need to add:

| Secret | Used By | Notes |
|--------|---------|-------|
| `BETTER_AUTH_BASE_URL_PROD` | `e2e-production.yml` | Your Vercel production URL (e.g. `https://myhelper.vercel.app`) |

All other CI env vars (POSTGRES_URL, BETTER_AUTH_SECRET) are hardcoded in the workflow for the CI PostgreSQL service container.

### Vercel Dashboard (Settings > Environment Variables)

These should already be set for your deployment. Verify:

| Variable | Environment |
|----------|-------------|
| `POSTGRES_URL` | Production, Preview |
| `BETTER_AUTH_SECRET` | Production, Preview |
| `BETTER_AUTH_URL` | Production (your domain) |
| `NEXT_PUBLIC_APP_URL` | Production, Preview |
| `STRIPE_SECRET_KEY` | Production |
| `STRIPE_WEBHOOK_SECRET` | Production |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Production, Preview |
| `STRIPE_PRICE_BASIC` | Production |
| `STRIPE_PRICE_PRO` | Production |

---

## Files Created / Modified

### New files
- `.env.example` — environment variable template
- `scripts/seed-test.ts` — idempotent test database seed
- `tests/production/health.spec.ts` — 6 production health checks
- `.github/workflows/e2e-production.yml` — post-deploy workflow

### Modified files
- `package.json` — added `db:seed:test` script
- `playwright.config.ts` — BASE_URL support, remote detection, CI-only single browser
- `.github/workflows/quality-gate.yml` — split e2e into smoke/full, added seed step
- `tests/auth/authentication.spec.ts` — tags, diacritic fixes, seeded user
- `tests/dashboard/employees.spec.ts` — tags, link selector fix
- `tests/dashboard/services.spec.ts` — tags, diacritic fixes
- `tests/dashboard/appointments.spec.ts` — tags, diacritic fixes
- `tests/dashboard/reports.spec.ts` — tags, diacritic fixes
- `tests/dashboard/inventory.spec.ts` — tags, diacritic fixes
- `tests/dashboard/subscriptions.spec.ts` — tags, diacritic fixes
- `tests/client-portal/client-flows.spec.ts` — tags, diacritic fixes
- `tests/ai-tools/ai-features.spec.ts` — tags, diacritic fixes

---

## Local Verification Status

| Check | Status | Details |
|-------|--------|---------|
| @smoke tests (10) | PASS | 10/10 passed, 0 retries, 34.5s |
| TypeScript check | PASS | `pnpm typecheck` — no errors |
| Security audit | PASS | `pnpm audit` — 0 high/critical vulnerabilities |

---

## Key Decisions & Notes

1. **Single browser in CI**: Only Chromium is installed/used in CI to save time. Locally, tests run on Desktop Chrome + Mobile Safari + iPad Pro.

2. **`pnpm start` in CI**: The CI webServer uses `pnpm start` (production build) instead of `pnpm dev` for stability and speed.

3. **Diacritics handling**: All test selectors use character classes (e.g. `[oó]`, `[eę]`, `[lł]`) or ASCII-only text to match the UI which renders Polish text without diacritics.

4. **`domcontentloaded` over `networkidle`**: All tests use `waitForLoadState('domcontentloaded')` because Next.js dev server's HMR WebSocket prevents `networkidle` from ever firing.

5. **`expect(page).toHaveURL()` over `waitForURL()`**: Navigation assertions use Playwright's `toHaveURL` matcher with timeout for more reliable URL checks.

6. **Seed script is idempotent**: Uses `onConflictDoUpdate` for all inserts, safe to run multiple times.
