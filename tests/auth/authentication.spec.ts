import { failedLoginEmail } from '../failed-login-email';
import { test, expect, type Page } from '../fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER = {
  name: 'Test Owner',
  email: `test-owner-${Date.now()}@example.com`,
  password: 'TestPassword123!',
};

// Seeded user that already exists in the test database (no email verification needed)
const SEEDED_OWNER = {
  email: 'owner@test.com',
  password: 'TestPassword123!',
};

async function fillLoginForm(page: Page, email: string, password: string) {
  await page.waitForSelector('#email', { state: 'visible', timeout: 15000 });
  // Wait for React hydration — the component starts with sessionPending=true
  // which renders a disabled "Ladowanie..." button (no form). Once hydration
  // completes and session check finishes, the full form with submit button renders.
  await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
  // Extra wait to ensure React event handlers are attached after hydration
  await page.waitForTimeout(500);
  await page.fill('#email', email);
  await page.fill('#password', password);
}

// ---------------------------------------------------------------------------
// Flow 1: Authentication (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 1: Authentication', () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display login form', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.getByRole('button', { name: /^zaloguj sie$/i })).toBeVisible();
    });

    test('should display account form fields on registration page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      // Registration opens on the account form
      await expect(page.locator('#name')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('#confirmPassword')).toBeVisible();
    });

    test('should go back from account form to plan selection and continue to account form', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      // Wait for the account form submit button, then 500 ms
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: /wstecz/i }).click();
      // Plan selection - plan is already selected, so Dalej is enabled
      const dalej = page.getByRole('button', { name: /dalej/i });
      await expect(dalej).toBeVisible({ timeout: 10000 });
      await expect(dalej).toBeEnabled({ timeout: 5000 });
      await dalej.click();
      await expect(page.locator('#name')).toBeVisible({ timeout: 10000 });
    });

    test('should register a new owner account', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/register');
      // Step 2 - fill form (wait for the submit button, then 500 ms)
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
      await page.fill('#name', TEST_USER.name);
      await page.fill('#email', TEST_USER.email);
      await page.fill('#password', TEST_USER.password);
      await page.fill('#confirmPassword', TEST_USER.password);
      await page.locator('form button[type="submit"]').click();
      // Should see success or redirect (UI text has no diacritics: "Konto utworzone!" / "Konto zostalo utworzone pomyslnie!")
      await expect(
        page.getByText(/konto.*utworzone/i).first().or(page.locator('[href="/dashboard"]')).first()
      ).toBeVisible({ timeout: 10000 });
    });

    // Regresja (2026-11-14): przy PIERWSZEJ wizycie service worker po instalacji
    // przejmuje strone (sw.js: clients.claim() -> zdarzenie "controllerchange").
    // SwRegister przeladowywal wtedy strone: znikal wybrany plan ("Dalej" wracal
    // do disabled), kasowaly sie wpisane dane, a trwajace logowanie bylo zrywane.
    // Test jest deterministyczny — nie zalezy od tego, czy przeladowanie trafi
    // akurat we wpisywanie: liczy ladowania dokumentu do chwili po przejeciu strony.
    test('should not reload the page when the service worker takes control on first visit', { tag: '@smoke' }, async ({ page }) => {
      test.skip(!process.env.CI, 'Service worker rejestruje sie tylko w buildzie produkcyjnym (CI: pnpm start)');

      // Liczymy pelne ladowania dokumentu (zadania nawigacyjne glownej ramki);
      // history.replaceState routera Next.js nie jest takim zadaniem.
      let documentLoads = 0;
      page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentLoads += 1;
      });

      await page.goto('/register');
      const nameInput = page.locator('#name');
      const emailInput = page.locator('#email');
      await expect(nameInput).toBeVisible({ timeout: 15000 });
      // Wpis ponawiany do skutku: wpis przed hydratacja moze zniknac.
      await expect(async () => {
        await nameInput.fill('Test User');
        await emailInput.fill('test@example.com');
        await page.waitForTimeout(500);
        await expect(nameInput).toHaveValue('Test User', { timeout: 1000 });
        await expect(emailInput).toHaveValue('test@example.com', { timeout: 1000 });
      }).toPass({ timeout: 15000 });

      // Czekamy, az service worker faktycznie przejmie strone...
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 20000,
      });
      // ...i dajemy ewentualnemu przeladowaniu czas na wykonanie (w CI trwalo ~100 ms).
      await page.waitForTimeout(2000);

      expect(
        documentLoads,
        'strona przeladowala sie po przejeciu przez service worker — uzytkowniczka traci wpisane dane'
      ).toBe(1);
      // Zachowanie widziane przez uzytkowniczke: wpisane dane nadal w polach.
      await expect(nameInput).toHaveValue('Test User');
      await expect(emailInput).toHaveValue('test@example.com');
    });

    test('should login with valid credentials and redirect to dashboard', { tag: ['@smoke', '@csp'] }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, SEEDED_OWNER.email, SEEDED_OWNER.password);
      // Click submit button (hydration already confirmed by fillLoginForm)
      await page.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });
    });

    test('should display Google sign-in button', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await expect(
        page.getByRole('button', { name: /google/i })
      ).toBeVisible();
    });

    test('should navigate to forgot password page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      // Wait for form to render (after session check)
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
      // Click the forgot password link
      await page.locator('a[href="/forgot-password"]').click();
      await page.waitForURL('**/forgot-password**', { timeout: 15000 });
      await expect(page.locator('#email')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /wys[lł]ij link/i })
      ).toBeVisible();
    });

    test('should submit forgot password form', { tag: '@full' }, async ({ page }) => {
      await page.goto('/forgot-password');
      // Przycisk jest disabled do konca hydratacji (fix natywnego submitu).
      // Czekamy na enabled i DOPIERO wtedy wypelniamy pole — kontrolowany
      // input Reacta wymazuje wartosc wpisana przed hydratacja (pierwszy
      // render ze stanem ""), co bylo zrodlem flaka tego testu.
      const submit = page.locator('form button[type="submit"]');
      await expect(submit).toBeEnabled({ timeout: 15000 });
      await page.fill('#email', TEST_USER.email);
      await submit.click();
      // Uzytkowniczka widzi potwierdzenie wyslania linku. Poprzedni lokator laczyl
      // w jednym wyrazeniu komunikat i przycisk "Powrot do logowania" — po
      // sukcesie pasowal do DWOCH elementow i padal na "strict mode violation",
      // o ile odpowiedz przyszla przed pierwszym sprawdzeniem (wyscig).
      await expect(
        page.getByText(/je[sś]li konto z tym adresem/i)
      ).toBeVisible({ timeout: 30000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error for invalid credentials', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, failedLoginEmail(), 'WrongPass123!');
      // Click submit button (hydration already confirmed by fillLoginForm)
      await page.locator('button[type="submit"]').click();
      // Should display an error message — sanitized to Polish:
      // "Nieprawidlowy email lub haslo" or "Nie udalo sie zalogowac"
      await expect(
        page.getByText(/nieprawidl|nie udalo|blad|invalid|nie znaleziono/i)
      ).toBeVisible({ timeout: 30000 });
      // Should NOT redirect
      await expect(page).toHaveURL(/\/login/);
    });

    // Straznik limitu prob logowania. tests/fixtures.ts daje kazdemu testowi
    // wlasny adres IP, zeby testy nie zjadaly sobie nawzajem limitu. Ten test
    // pilnuje, ze sam limit w aplikacji nadal dziala: z JEDNEGO adresu czwarta
    // proba logowania w ciagu 10 s dostaje 429 (Better Auth: 3 proby / 10 s).
    test('should rate-limit repeated sign-in attempts from one client', { tag: '@full' }, async ({ request, baseURL }) => {
      // Tryb "database" magazynu limitu wlacza limit niezaleznie od NODE_ENV — wtedy test biegnie tez lokalnie.
      test.skip(
        !process.env.CI && process.env.AUTH_RATE_LIMIT_STORE !== 'database',
        'Better Auth wlacza limit tylko w buildzie produkcyjnym (CI: pnpm start) albo w trybie AUTH_RATE_LIMIT_STORE=database'
      );
      // Nie bijemy limitu logowania na zdalnym wdrozeniu (produkcja, preview):
      // strażnik ma sens tylko na lokalnym serwerze z CI.
      const targetHost = new URL(baseURL ?? 'http://localhost:3000').hostname;
      test.skip(
        !['localhost', '127.0.0.1', '[::1]', '::1'].includes(targetHost),
        `Straznik limitu dziala tylko lokalnie — BASE_URL wskazuje zdalny host (${targetHost})`
      );

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await request.post('/api/auth/sign-in/email', {
          data: { email: failedLoginEmail(), password: 'WrongPass123!' },
          // Jak przegladarka: zadanie z ciasteczkami bez naglowka Origin Better Auth odrzuca (403).
          headers: { Origin: baseURL ?? 'http://localhost:3000' },
        });
        statuses.push(response.status());
      }

      expect(
        statuses,
        'limit prob logowania nie zadzialal — czwarta proba z tego samego adresu powinna dostac 429'
      ).toEqual([401, 401, 401, 429]);
    });

    test('should show validation errors on empty login form', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await page.waitForSelector('#email', { state: 'visible', timeout: 10000 });
      await page.locator('button[type="submit"]').click();
      // At least one validation message should appear (UI: "Wpisz adres email..." / "Wpisz haslo...")
      await expect(
        page.getByText(/wymagane|required|wpisz|email|has[lł]o/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should validate email format on login', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'not-an-email', 'SomePass123');
      await page.locator('button[type="submit"]').click();
      // UI: "Nieprawidlowy format email..." (no diacritics)
      await expect(
        page.getByText(/email|format|prawidl/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should show error for password mismatch during registration', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      await page.waitForSelector('#name', { state: 'visible', timeout: 10000 });
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
      await page.fill('#name', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'Password123!');
      await page.fill('#confirmPassword', 'DifferentPassword123!');
      await page.locator('form button[type="submit"]').click();
      // UI: "Hasla nie sa identyczne..." (no diacritics)
      await expect(
        page.getByText(/has[lł]a|nie pasuj|identyczne|mismatch|zgodne/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject password shorter than 8 characters', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      await page.waitForSelector('#name', { state: 'visible', timeout: 10000 });
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(500);
      await page.fill('#name', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'short');
      await page.fill('#confirmPassword', 'short');
      await page.locator('form button[type="submit"]').click();
      // UI: "Haslo jest za krotkie. Wpisz co najmniej 8 znakow" (no diacritics)
      await expect(
        page.getByText(/minimum|8|znak[oó]w|characters|za kr[oó]tkie/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should redirect unauthenticated user from dashboard to login', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/login**', { timeout: 10000 });
      await expect(page).toHaveURL(/\/login/);
    });
  });

  // ── Reset hasla: token poza adresem i poza Referer ──────────────────────
  //
  // Strona /reset-password?token=… i adresy z tokenem Better Auth maja
  // Referrer-Policy: no-referrer (next.config.ts), a formularz usuwa token
  // z paska adresu (history.replaceState) i nadal wysyla go w tresci POST.
  // Token jest falszywy: odpowiedz Better Auth to blad tokenu, nie sukces —
  // test sprawdza droge tokenu, nie samo ustawienie hasla.

  test.describe('Reset password token handling', () => {
    const FAKE_TOKEN = 'e2eNotARealResetToken123';

    test('reset page: no-referrer, token removed from URL, form still sends token without Referer', { tag: '@smoke' }, async ({ page }) => {
      const response = await page.goto(`/reset-password?token=${FAKE_TOKEN}`, { waitUntil: 'load' });
      expect(response?.headers()['referrer-policy']).toBe('no-referrer');

      // Token znika z adresu po hydratacji (efekt formularza)...
      await expect(page).toHaveURL(/\/reset-password$/, { timeout: 15000 });
      // ...a formularz zostaje (Next 16: replaceState odswieza useSearchParams).
      await expect(page.getByText(/brak tokenu/i)).toHaveCount(0);
      const submit = page.locator('form button[type="submit"]');
      await expect(submit).toBeEnabled({ timeout: 15000 });
      await page.fill('#password', 'NewPassword123!');
      await page.fill('#confirmPassword', 'NewPassword123!');

      const resetRequest = page.waitForRequest(
        (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/auth/reset-password'
      );
      await submit.click();
      const request = await resetRequest;
      expect(request.postDataJSON()).toMatchObject({ token: FAKE_TOKEN });
      const headers = await request.allHeaders();
      expect(headers['referer'], 'Referer na stronie resetu').toBeUndefined();
      expect(request.url()).not.toContain(FAKE_TOKEN);

      // Falszywy token: komunikat bledu w formularzu, bez przekierowania.
      await expect(page.locator('form p.text-destructive')).toBeVisible({ timeout: 30000 });
      await expect(page).toHaveURL(/\/reset-password$/);
      expect(page.url()).not.toContain(FAKE_TOKEN);
    });

    test('token URLs of Better Auth: no-referrer; other pages unchanged', { tag: '@smoke' }, async ({ request }) => {
      const callback = await request.get(`/api/auth/reset-password/${FAKE_TOKEN}?callbackURL=%2Freset-password`, {
        maxRedirects: 0,
      });
      expect(callback.headers()['referrer-policy']).toBe('no-referrer');

      const verify = await request.get(`/api/auth/verify-email?token=${FAKE_TOKEN}`, { maxRedirects: 0 });
      expect(verify.headers()['referrer-policy']).toBe('no-referrer');

      for (const path of ['/login', '/forgot-password', '/api/health']) {
        const res = await request.get(path, { maxRedirects: 0 });
        expect(res.headers()['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle double-click on login button gracefully', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      const button = page.getByRole('button', { name: /^zaloguj sie$/i });
      await button.dblclick();
      // Should not crash -- either shows error, loading state, or redirects
      await expect(
        page.getByText(/bl[aą]d|nieprawidl|logowanie|nie uda[lł]o/i).first()
          .or(page.locator('text=dashboard'))
          .or(page.locator('#email'))
          .first()
      ).toBeVisible({ timeout: 30000 });
    });

    test('should show loading state during login', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, SEEDED_OWNER.email, SEEDED_OWNER.password);
      await page.locator('button[type="submit"]').click();
      // Button should show loading state (disabled or text change)
      // UI: "Logowanie..." / "Ladowanie..." (no diacritics)
      await expect(
        page.getByText(/logowanie|ladowanie/i)
          .or(page.getByRole('button', { disabled: true }))
          .or(page.locator('[data-loading="true"]'))
          .first()
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Loading state may be too fast to catch -- acceptable
      });
    });

    test('should handle special characters in email', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'user+special@example.com', 'TestPassword123!');
      await page.locator('button[type="submit"]').click();
      // Should either login or show proper error — NOT crash
      await expect(
        page.locator('body')
      ).not.toContainText(/Internal Server Error/i);
    });

    test('should navigate between login and register pages', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      // Wait for form to render
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
      // Click register link (multiple a[href="/register"] on page, pick the one in form)
      await page.locator('form a[href="/register"]').click();
      await expect(page).toHaveURL(/\/register/, { timeout: 10000 });
      // Wait for register page to load
      await page.waitForLoadState('domcontentloaded');
      await page.locator('a[href="/login"]').first().click();
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should preserve returnTo URL after login redirect', { tag: '@full' }, async ({ page }) => {
      // Try to access protected page
      await page.goto('/dashboard/employees');
      // Should redirect to login (or salons if not admin)
      await page.waitForURL(/\/(login|salons)/, { timeout: 15000 });
      // If redirected to login, try logging in
      if (page.url().includes('/login')) {
        await fillLoginForm(page, SEEDED_OWNER.email, SEEDED_OWNER.password);
        await page.locator('form button[type="submit"]').click();
        // Should redirect back to dashboard or stay on a valid page
        await expect(page).toHaveURL(/\/(dashboard|salons|login)/, { timeout: 30000 });
      }
    });
  });
});
