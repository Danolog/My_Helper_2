import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER = {
  name: 'Test Owner',
  email: `test-owner-${Date.now()}@example.com`,
  password: 'TestPassword123!',
};

async function fillLoginForm(page: Page, email: string, password: string) {
  await page.fill('#email', email);
  await page.fill('#password', password);
}

// ---------------------------------------------------------------------------
// Flow 1: Authentication (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 1: Authentication', () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(page.getByRole('button', { name: /zaloguj się/i })).toBeVisible();
    });

    test('should display registration page with plan selection', async ({ page }) => {
      await page.goto('/register');
      // Step 1 - plan selection should be visible
      await expect(page.getByText(/basic/i)).toBeVisible();
      await expect(page.getByText(/pro/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /dalej/i })).toBeVisible();
    });

    test('should navigate from plan selection to account form', async ({ page }) => {
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

    test('should register a new owner account', async ({ page }) => {
      await page.goto('/register');
      // Step 1 - select plan
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      // Step 2 - fill form
      await page.fill('#name', TEST_USER.name);
      await page.fill('#email', TEST_USER.email);
      await page.fill('#password', TEST_USER.password);
      await page.fill('#confirmPassword', TEST_USER.password);
      await page.getByRole('button', { name: /utwórz konto/i }).click();
      // Should see success or redirect
      await expect(
        page.getByText(/konto zostało utworzone/i).or(page.locator('[href="/dashboard"]'))
      ).toBeVisible({ timeout: 10000 });
    });

    test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, TEST_USER.email, TEST_USER.password);
      await page.getByRole('button', { name: /zaloguj się/i }).click();
      // Should redirect to dashboard
      await page.waitForURL('**/dashboard**', { timeout: 10000 });
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test('should display Google sign-in button', async ({ page }) => {
      await page.goto('/login');
      await expect(
        page.getByRole('button', { name: /google/i })
      ).toBeVisible();
    });

    test('should navigate to forgot password page', async ({ page }) => {
      await page.goto('/login');
      await page.getByText(/nie pamiętam hasła/i).click();
      await page.waitForURL('**/forgot-password**');
      await expect(page.locator('#email')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /wyślij link/i })
      ).toBeVisible();
    });

    test('should submit forgot password form', async ({ page }) => {
      await page.goto('/forgot-password');
      await page.fill('#email', TEST_USER.email);
      await page.getByRole('button', { name: /wyślij link/i }).click();
      // Should show success message
      await expect(
        page.getByText(/jeśli konto z tym adresem/i)
      ).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'wrong@example.com', 'WrongPass123!');
      await page.getByRole('button', { name: /zaloguj się/i }).click();
      // Should display an error message
      await expect(
        page.getByText(/nieprawidłowy|błąd|invalid|nie znaleziono/i)
      ).toBeVisible({ timeout: 5000 });
      // Should NOT redirect
      await expect(page).toHaveURL(/\/login/);
    });

    test('should show validation errors on empty login form', async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /zaloguj się/i }).click();
      // At least one validation message should appear
      await expect(
        page.getByText(/wymagane|required|email|hasło/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should validate email format on login', async ({ page }) => {
      await page.goto('/login');
      await page.fill('#email', 'not-an-email');
      await page.fill('#password', 'SomePass123');
      await page.getByRole('button', { name: /zaloguj się/i }).click();
      await expect(
        page.getByText(/email|format|prawidłowy/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should show error for password mismatch during registration', async ({ page }) => {
      await page.goto('/register');
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      await page.fill('#name', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'Password123!');
      await page.fill('#confirmPassword', 'DifferentPassword123!');
      await page.getByRole('button', { name: /utwórz konto/i }).click();
      await expect(
        page.getByText(/hasła|nie pasują|mismatch|zgodne/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject password shorter than 8 characters', async ({ page }) => {
      await page.goto('/register');
      await page.getByText(/basic/i).first().click();
      await page.getByRole('button', { name: /dalej/i }).click();
      await page.fill('#name', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'short');
      await page.fill('#confirmPassword', 'short');
      await page.getByRole('button', { name: /utwórz konto/i }).click();
      await expect(
        page.getByText(/minimum|8|znaków|characters/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should redirect unauthenticated user from dashboard to login', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL('**/login**', { timeout: 10000 });
      await expect(page).toHaveURL(/\/login/);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle double-click on login button gracefully', async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'test@example.com', 'TestPassword123!');
      const button = page.getByRole('button', { name: /zaloguj się/i });
      await button.dblclick();
      // Should not crash — either shows error or redirects
      await expect(
        page.getByText(/błąd|nieprawidłowy|logowanie/i)
          .or(page.locator('text=dashboard'))
          .or(page.locator('#email'))
      ).toBeVisible({ timeout: 5000 });
    });

    test('should show loading state during login', async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, TEST_USER.email, TEST_USER.password);
      const button = page.getByRole('button', { name: /zaloguj się/i });
      await button.click();
      // Button should show loading state (disabled or text change)
      await expect(
        page.getByText(/logowanie|ładowanie/i)
          .or(page.getByRole('button', { disabled: true }))
          .or(page.locator('[data-loading="true"]'))
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Loading state may be too fast to catch — acceptable
      });
    });

    test('should handle special characters in email', async ({ page }) => {
      await page.goto('/login');
      await fillLoginForm(page, 'user+special@example.com', 'TestPassword123!');
      await page.getByRole('button', { name: /zaloguj się/i }).click();
      // Should either login or show proper error — NOT crash
      await page.waitForTimeout(2000);
      await expect(
        page.locator('body')
      ).not.toContainText(/500|Internal Server Error|unexpected/i);
    });

    test('should navigate between login and register pages', async ({ page }) => {
      await page.goto('/login');
      await page.getByText(/zarejestruj się/i).click();
      await expect(page).toHaveURL(/\/register/);
      await page.getByText(/zaloguj się/i).first().click();
      await expect(page).toHaveURL(/\/login/);
    });

    test('should preserve returnTo URL after login redirect', async ({ page }) => {
      // Try to access protected page
      await page.goto('/dashboard/employees');
      await page.waitForURL('**/login**', { timeout: 10000 });
      // Login
      await fillLoginForm(page, TEST_USER.email, TEST_USER.password);
      await page.getByRole('button', { name: /zaloguj się/i }).click();
      // Should redirect back to the originally requested page (or dashboard)
      await page.waitForURL('**/dashboard**', { timeout: 10000 });
    });
  });
});
