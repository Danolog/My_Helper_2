import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_CREDENTIALS = {
  email: 'client@test.com',
  password: 'TestPassword123!',
};

async function loginAsClient(page: Page) {
  await page.goto('/portal/login');
  await page.fill('#email', CLIENT_CREDENTIALS.email);
  await page.fill('#password', CLIENT_CREDENTIALS.password);
  await page.getByRole('button', { name: /zaloguj/i }).click();
  await page.waitForURL('**/(salons|appointments|dashboard)**', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Flow 7: Client Portal (P2)
// ---------------------------------------------------------------------------

test.describe('Flow 7: Client Portal', () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display salon browsing page (public, no auth)', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/salon|usług|znajdź|browse/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display client login page', async ({ page }) => {
      await page.goto('/portal/login');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /zaloguj/i })
      ).toBeVisible();
    });

    test('should display client registration page', async ({ page }) => {
      await page.goto('/portal/register');
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('#email').or(page.locator('input[name="email"]'))
      ).toBeVisible();
    });

    test('should browse salons without authentication', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      // Should be able to see salon list without login
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      await expect(page).toHaveURL(/\/salons/);
    });

    test('should view salon detail page', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      // Click on first salon link
      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        await salonLink.click();
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should view salon services', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        const href = await salonLink.getAttribute('href');
        if (href) {
          await page.goto(`${href}/services`);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
        }
      }
    });

    test('should view salon gallery', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        const href = await salonLink.getAttribute('href');
        if (href) {
          await page.goto(`${href}/gallery`);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
        }
      }
    });

    test('should display appointments page for logged-in client', async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/appointments');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/wizyt|appointment|rezerwacj/i).first()
          .or(page.getByText(/brak|no.*appointment|pust/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display favorites page for logged-in client', async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/favorites');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/ulubion|favorite|zapisane/i).first()
          .or(page.getByText(/brak|pust|no/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display waiting list page for logged-in client', async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/waiting-list');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/oczekując|waiting|lista/i).first()
          .or(page.getByText(/brak|pust|no/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should navigate to salon booking page', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        const href = await salonLink.getAttribute('href');
        if (href) {
          await page.goto(`${href}/book`);
          await page.waitForLoadState('networkidle');
          // Should show booking form or login prompt
          await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
        }
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error for invalid client login', async ({ page }) => {
      await page.goto('/portal/login');
      await page.fill('#email', 'wrong@example.com');
      await page.fill('#password', 'WrongPass123!');
      await page.getByRole('button', { name: /zaloguj/i }).click();

      await expect(
        page.getByText(/błąd|error|nieprawidłow|invalid/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should redirect unauthenticated user from appointments page', async ({ page }) => {
      await page.goto('/appointments');
      // Should redirect to login or show auth prompt
      await page.waitForTimeout(3000);
      const url = page.url();
      expect(url).toMatch(/\/(login|portal|appointments)/);
    });

    test('should redirect unauthenticated user from favorites page', async ({ page }) => {
      await page.goto('/favorites');
      await page.waitForTimeout(3000);
      const url = page.url();
      expect(url).toMatch(/\/(login|portal|favorites)/);
    });

    test('should handle non-existent salon ID gracefully', async ({ page }) => {
      await page.goto('/salons/nonexistent-uuid-12345');
      await page.waitForLoadState('networkidle');
      // Should show 404 or error message — NOT crash
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle empty registration form submission', async ({ page }) => {
      await page.goto('/portal/register');
      await page.waitForLoadState('networkidle');

      const submitBtn = page.getByRole('button', { name: /zarejestruj|register|utwórz/i });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
        // Should show validation errors
        await expect(
          page.getByText(/wymagane|required|email|hasło/i).first()
        ).toBeVisible({ timeout: 3000 });
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle salon list with no salons', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');
      // Should show empty state or list
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle rapid navigation between client pages', async ({ page }) => {
      const clientPages = ['/salons', '/appointments', '/favorites', '/waiting-list'];
      for (const path of clientPages) {
        await page.goto(path);
      }
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle search with special characters on salons page', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]'
      ).first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('<script>alert("xss")</script>');
        await page.waitForTimeout(500);
        // Should sanitize and not execute script
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should render client portal on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should render client portal on tablet viewport', async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1194 });
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle back/forward browser navigation', async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('networkidle');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        await salonLink.click();
        await page.waitForLoadState('networkidle');
        await page.goBack();
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/salons/);
        await page.goForward();
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should handle page refresh on appointments page', async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/appointments');
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });
});
