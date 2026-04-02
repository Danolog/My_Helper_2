# Anti-Patterns — E2E Testy

Każdy wzorzec tutaj kosztował godziny debugowania. Źródło: MyHelper v2 (14+ commitów).

---

## AP-E2E-01: keyboard.press('Enter') do submitowania formularzy

**Problem:** Zawodne w CI gdy React nie jest w pełni hydrated.
SSR renderuje HTML (button widoczny), ale React nie zdążył jeszcze
podłączyć event handlerów → Enter nie triggeruje onSubmit.

```typescript
// ❌ ZŁE
await page.fill('#email', email);
await page.keyboard.press('Enter');

// ✅ DOBRE — czekaj na hydration, potem kliknij
await page.waitForFunction(() => {
  const btn = document.querySelector('button[type="submit"]');
  return btn !== null && !btn.hasAttribute('disabled');
}, { timeout: 15000 });
await page.fill('#email', email);
await page.fill('#password', password);
await page.locator('button[type="submit"]').click();
```

**Dotyczy:** Next.js App Router, Server Components, każdy framework z SSR

---

## AP-E2E-02: waitUntil 'networkidle' w Next.js production

**Problem:** Next.js production server utrzymuje otwarte połączenia
(keep-alive, SSE, polling). `networkidle` nigdy nie jest osiągane →
timeout po 60 sekundach.

```typescript
// ❌ ZŁE — timeout po 60s
await page.goto('/login', { waitUntil: 'networkidle' });
await page.waitForLoadState('networkidle');

// ✅ DOBRE
await page.goto('/login', { waitUntil: 'load' });
// Dla formularzy wystarczy szybsze:
await page.goto('/login', { waitUntil: 'domcontentloaded' });
```

**Hierarchia dla Next.js:**
```
commit          → za szybkie (tylko pierwsze bajty)
domcontentloaded → HTML sparsowany (OK dla formularzy)
load            → DOM + resources (bezpieczne, zalecane)
networkidle     → NIGDY w Next.js production
```

---

## AP-E2E-03: Logowanie przez UI w global-setup

**Problem:** global-setup uruchamia się przed testami i musi być
w 100% niezawodny. Login przez UI = React hydration race condition.
Jeden failed global-setup = 0 testów przechodzi.

```typescript
// ❌ ZŁE — flaky, zależy od React hydration
export default async function globalSetup() {
  const page = await browser.newPage();
  await page.goto('/login');
  await page.fill('#email', email);
  await page.keyboard.press('Enter'); // race condition!
  await page.waitForURL('**/dashboard/**');
}

// ✅ DOBRE — API call, deterministyczne, < 1 sekunda
export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  
  // Bezpośrednie wywołanie API — zero UI, zero race conditions
  const response = await context.request.post('/api/auth/sign-in/email', {
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    headers: { 'Content-Type': 'application/json' }
  });
  
  if (!response.ok()) throw new Error(`Login failed: ${response.status()}`);
  
  // Zapisz sesję — testy będą ją reużywać
  await context.storageState({ path: 'tests/.auth/owner.json' });
  await browser.close();
}
```

---

## AP-E2E-04: loginAsUser() w każdym teście dashboardu

**Problem:** 173 testy × login przez UI = 173 race conditions.
Każdy failed login = failed test. Kaskadowe failures.

```typescript
// ❌ ZŁE — logowanie w każdym teście
test('employee management', async ({ page }) => {
  await loginAsOwner(page); // potencjalny failure
  await page.goto('/dashboard/employees');
  // ...
});

// ✅ DOBRE — storageState aplikowany automatycznie przez Playwright
// W playwright.config.ts:
projects: [{
  name: 'dashboard',
  use: {
    storageState: 'tests/.auth/owner.json', // sesja raz, dla wszystkich
  },
  testMatch: '**/dashboard/**/*.spec.ts',
}]

// W teście — zero logowania, sesja jest już aktywna:
test('employee management', async ({ page }) => {
  await page.goto('/dashboard/employees'); // od razu zalogowany
  // ...
});
```

---

## AP-E2E-05: Workers > 2 w GitHub Actions CI

**Problem:** GitHub Actions free runner ma 2 vCPU.
Ustawienie workers=4 powoduje context switching między procesami
i paradoksalnie spowalnia testy.

```yaml
# ❌ ZŁE — więcej workerów ≠ szybciej na 2 CPU
- run: playwright test --workers=4

# ✅ DOBRE — dopasuj do sprzętu
- run: playwright test --workers=2  # GitHub runner = 2 CPU
```

**Benchmark z MyHelper v2:**
```
workers=1: 2.6h
workers=2: 4.6 min ✅
workers=4: ~8 min (context switching overhead)
```

---

## AP-E2E-06: Brak tagów @smoke/@full/@production od początku

**Problem:** Bez tagów wszystkie 173 testy lecą na każdym PR → 3h CI.
Tagi powinny być dodawane od pierwszego testu, nie retrofitowane.

```typescript
// ❌ ZŁE — brak tagów, wszystko leci zawsze
test('użytkownik może się zalogować', async ({ page }) => { ... });

// ✅ DOBRE — tagi od początku
test('użytkownik może się zalogować', { tag: '@smoke' }, async ({ page }) => { ... });
test('walidacja błędnego emaila', { tag: '@full' }, async ({ page }) => { ... });
test('strona główna się ładuje', { tag: '@production' }, async ({ page }) => { ... });
```

**Zasada tagowania:**
- `@smoke` → max 10-15 testów total, krytyczne flows, uruchamiane zawsze
- `@full` → wszystko inne, uruchamiane tylko na main
- `@production` → read-only, zero modyfikacji danych, uruchamiane po deploy

---

## AP-E2E-07: Strict mode violations — niejednoznaczne selektory

**Problem:** Playwright w strict mode failuje gdy selektor pasuje
do więcej niż jednego elementu.

```typescript
// ❌ ZŁE — "Zaloguj sie" pasuje do buttona I linku Google
await page.getByRole('button', { name: /zaloguj/i }).click();

// ❌ ZŁE — /basic/i pasuje do <h3>Basic</h3> i <span>...z planu Basic</span>
await page.getByText(/basic/i);

// ✅ DOBRE — exact match
await page.getByRole('button', { name: 'Zaloguj sie', exact: true }).click();

// ✅ DOBRE — zawężenie do roli
await page.getByRole('heading', { name: /basic/i });

// ✅ DOBRE — anchored regex
await page.getByRole('button', { name: /^zaloguj sie$/i });

// ✅ DOBRE — .first() gdy celowo chcesz pierwszy element
await page.getByText(/basic/i).first();
```
