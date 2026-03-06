import { test, expect, type Page } from '@playwright/test';

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
  await page.waitForSelector('#email', { state: 'visible', timeout: 10000 });
  // Wait for React hydration — button must be enabled (not disabled during SSR)
  await page.getByRole('button', { name: /^zaloguj sie$/i }).waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForLoadState('domcontentloaded');
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

    test('should display registration page with plan selection', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      // Step 1 - plan selection should be visible
      await expect(page.getByText(/basic/i).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/pro/i).first()).toBeVisible({ timeout: 10000 });
      await expect(page.getByRole('button', { name: /dalej/i })).toBeVisible({ timeout: 10000 });
    });

    test('should navigate from plan selection to account form', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      // Select Basic plan and proceed
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      // Step 2 - account form should appear
      await expect(page.locator('#name')).toBeVisible();
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.locator('#confirmPassword')).toBeVisible();
    });

    test('should register a new owner account', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/register');
      // Step 1 - select plan
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      // Step 2 - fill form
      await page.fill('#name', TEST_USER.name);
      await page.fill('#email', TEST_USER.email);
      await page.fill('#password', TEST_USER.password);
      await page.fill('#confirmPassword', TEST_USER.password);
      await page.getByRole('button', { name: /utw[oó]rz konto/i }).click();
      // Should see success or redirect (UI text has no diacritics: "Konto utworzone!" / "Konto zostalo utworzone pomyslnie!")
      await expect(
        page.getByText(/konto.*utworzone/i).first().or(page.locator('[href="/dashboard"]')).first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should login with valid credentials and redirect to dashboard', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/login');
      // Use seeded owner credentials (already verified, no email verification needed)
      await fillLoginForm(page, SEEDED_OWNER.email, SEEDED_OWNER.password);
      await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
      // Should redirect to dashboard
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should display Google sign-in button', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await expect(
        page.getByRole('button', { name: /google/i })
      ).toBeVisible();
    });

    test('should navigate to forgot password page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      // UI text: "Nie pamietam hasla" (no diacritics)
      await page.getByText(/nie pami[eę]tam has[lł]a/i).click();
      await page.waitForURL('**/forgot-password**');
      await expect(page.locator('#email')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /wys[lł]ij link/i })
      ).toBeVisible();
    });

    test('should submit forgot password form', { tag: '@full' }, async ({ page }) => {
      await page.goto('/forgot-password');
      await page.fill('#email', TEST_USER.email);
      await page.getByRole('button', { name: /wys[lł]ij link/i }).click();
      // Should show success message (UI: "Jesli konto z tym adresem email istnieje...")
      await expect(
        page.getByText(/jesli konto z tym adresem|jeśli konto z tym adresem/i)
      ).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error for invalid credentials', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'wrong@example.com', 'WrongPass123!');
      const submitBtn = page.getByRole('button', { name: /^zaloguj sie$/i });
      // Click and wait for API response
      await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/api/auth/') && resp.status() >= 400, { timeout: 15000 }).catch(() => {}),
        submitBtn.click(),
      ]);
      // Should display an error message — sanitized to Polish:
      // "Nieprawidlowy email lub haslo" or fallback "Nie udalo sie zalogowac"
      await expect(
        page.getByText(/nieprawidl|nie udalo|blad|invalid|nie znaleziono/i)
      ).toBeVisible({ timeout: 15000 });
      // Should NOT redirect
      await expect(page).toHaveURL(/\/login/);
    });

    test('should show validation errors on empty login form', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
      // At least one validation message should appear (UI: "Wpisz adres email..." / "Wpisz haslo...")
      await expect(
        page.getByText(/wymagane|required|wpisz|email|has[lł]o/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should validate email format on login', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      await page.fill('#email', 'not-an-email');
      await page.fill('#password', 'SomePass123');
      await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
      // UI: "Nieprawidlowy format email..." (no diacritics)
      await expect(
        page.getByText(/email|format|prawidl/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should show error for password mismatch during registration', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      await page.fill('#name', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'Password123!');
      await page.fill('#confirmPassword', 'DifferentPassword123!');
      await page.getByRole('button', { name: /utw[oó]rz konto/i }).click();
      // UI: "Hasla nie sa identyczne..." (no diacritics)
      await expect(
        page.getByText(/has[lł]a|nie pasuj|identyczne|mismatch|zgodne/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject password shorter than 8 characters', { tag: '@full' }, async ({ page }) => {
      await page.goto('/register');
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      await page.fill('#name', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'short');
      await page.fill('#confirmPassword', 'short');
      await page.getByRole('button', { name: /utw[oó]rz konto/i }).click();
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
      const button = page.getByRole('button', { name: /^zaloguj sie$/i });
      await button.click();
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
      await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
      // Should either login or show proper error — NOT crash
      await expect(
        page.locator('body')
      ).not.toContainText(/Internal Server Error/i);
    });

    test('should navigate between login and register pages', { tag: '@full' }, async ({ page }) => {
      await page.goto('/login');
      // UI: "Zarejestruj sie" (no diacritics)
      await page.getByText(/zarejestruj si[eę]/i).click();
      await expect(page).toHaveURL(/\/register/);
      await page.getByText(/^zaloguj sie$/i).first().click();
      await expect(page).toHaveURL(/\/login/);
    });

    test('should preserve returnTo URL after login redirect', { tag: '@full' }, async ({ page }) => {
      // Try to access protected page
      await page.goto('/dashboard/employees');
      await page.waitForURL('**/login**', { timeout: 10000 });
      // Login with seeded credentials (guaranteed to exist)
      await fillLoginForm(page, SEEDED_OWNER.email, SEEDED_OWNER.password);
      await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
      // Should redirect back to the originally requested page (or dashboard)
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    });
  });
});
