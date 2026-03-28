## Test Infrastructure

### Unit Tests (Vitest)
- `__tests__/api/` — testy API (appointments, clients, employees, services, products, health, work-schedules, appointment-materials, appointment-complete)
- `__tests__/lib/` — testy utilities (validations, utils, date-utils, session, stripe, refund, subscription, sms, push, storage, env, excel-export, fetch-with-retry, api-validation, content-templates, error-messages, notification-settings, temporary-access, web-push, get-user-salon)
- `__tests__/hooks/` — testy hooks (use-diagnostics, use-draggable, use-salon-id, use-unsaved-changes, use-subscription, use-form-recovery, use-network-status, use-tab-sync)
- `__tests__/api/ai-*.test.ts` — testy AI endpoints (categorize, auto-summary, search, notifications)
- `__tests__/hooks/use-ai-search.test.ts` — test AI search hook
- `__tests__/components/` — testy komponentow (Calendar*, DateRangeFilter, EmployeeFilter, auth forms, PWA, ProPlanGate, UnsavedChangesDialog)

### E2E Tests (Playwright)
- `tests/auth/authentication.spec.ts` — logowanie, rejestracja, reset hasla
- `tests/dashboard/` — services, inventory, appointments, employees, reports, subscriptions
- `tests/client-portal/client-flows.spec.ts` — flow klienta
- `tests/ai-tools/ai-features.spec.ts` — AI (plan Pro)
- `tests/ai-features/ai-smoke.spec.ts` — smoke testy stron AI
- `tests/production/health.spec.ts` — health checks produkcyjne (@production tag)
- Tags: `@smoke` (szybkie), `@full` (pelne), `@production` (health checks)
- Global auth: `tests/.auth/` — storageState dla zalogowanego uzytkownika

### CI/CD (GitHub Actions)
- **quality-gate.yml** (push/PR na main):
  - TypeScript Check
  - Unit Tests (z coverage)
  - E2E Smoke (@smoke, 4 workers, timeout 10min)
  - E2E Full (@full, 2 workers, timeout 35min — tylko push na main)
  - Security Audit (pnpm audit)
- **e2e-production.yml** (po deploy na Vercel):
  - Production Health Checks (@production, 2 workers, timeout 5min)
