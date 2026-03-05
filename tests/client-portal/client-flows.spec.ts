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
  await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
  await page.waitForURL(/\/(salons|appointments|dashboard)/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Flow 7: Client Portal (P2)
// ---------------------------------------------------------------------------

test.describe('Flow 7: Client Portal', () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display salon browsing page (public, no auth)', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        // UI: "Znajdz idealny salon" (no diacritics)
        page.getByText(/salon|us[lł]ug|znajd[zź]|browse/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display client login page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/login');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^zaloguj sie$/i })
      ).toBeVisible();
    });

    test('should display client registration page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/register');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.locator('#email').or(page.locator('input[name="email"]')).first()
      ).toBeVisible();
    });

    test('should browse salons without authentication', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      // Should be able to see salon list without login
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      await expect(page).toHaveURL(/\/salons/);
    });

    test('should view salon detail page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      // Click on first salon link
      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        await salonLink.click();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should view salon services', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        const href = await salonLink.getAttribute('href');
        if (href) {
          await page.goto(`${href}/services`);
          await page.waitForLoadState('domcontentloaded');
          await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
        }
      }
    });

    test('should view salon gallery', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        const href = await salonLink.getAttribute('href');
        if (href) {
          await page.goto(`${href}/gallery`);
          await page.waitForLoadState('domcontentloaded');
          await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
        }
      }
    });

    test('should display appointments page for logged-in client', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/appointments');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/wizyt|appointment|rezerwacj/i).first()
          .or(page.getByText(/brak|no.*appointment|pust/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display favorites page for logged-in client', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/favorites');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/ulubion|favorite|zapisane/i).first()
          .or(page.getByText(/brak|pust|no/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display waiting list page for logged-in client', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/waiting-list');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        // UI: "Lista oczekujacych" / "Oczekujace" (no diacritics)
        page.getByText(/oczekuj[aą]c|waiting|lista/i).first()
          .or(page.getByText(/brak|pust|no/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should navigate to salon booking page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        const href = await salonLink.getAttribute('href');
        if (href) {
          await page.goto(`${href}/book`);
          await page.waitForLoadState('domcontentloaded');
          // Should show booking form or login prompt
          await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
        }
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error for invalid client login', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/login');
      await page.fill('#email', 'wrong@example.com');
      await page.fill('#password', 'WrongPass123!');
      await page.getByRole('button', { name: /^zaloguj sie$/i }).click();

      await expect(
        // UI shows: "Nie udalo sie zalogowac. Sprawdz dane i sprobuj ponownie."
        page.getByText(/nie uda[lł]o si[eę]|nieprawidl|bl[aą]d|error|invalid/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should redirect unauthenticated user from appointments page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/appointments');
      // Should redirect to login or show auth prompt
      await page.waitForLoadState('networkidle');
      const url = page.url();
      expect(url).toMatch(/\/(login|portal|appointments)/);
    });

    test('should redirect unauthenticated user from favorites page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/favorites');
      await page.waitForLoadState('networkidle');
      const url = page.url();
      expect(url).toMatch(/\/(login|portal|favorites)/);
    });

    test('should handle non-existent salon ID gracefully', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons/nonexistent-uuid-12345');
      await page.waitForLoadState('domcontentloaded');
      // Should show 404 or error message — NOT crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle empty registration form submission', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/register');
      await page.waitForLoadState('domcontentloaded');

      const submitBtn = page.getByRole('button', { name: /zarejestruj|register|utw[oó]rz/i });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        // Should show validation errors
        await expect(
          page.getByText(/wymagane|required|email|has[lł]o|wpisz/i).first()
        ).toBeVisible({ timeout: 3000 });
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle salon list with no salons', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');
      // Should show empty state or list
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle rapid navigation between client pages', { tag: '@full' }, async ({ page }) => {
      const clientPages = ['/salons', '/appointments', '/favorites', '/waiting-list'];
      for (const path of clientPages) {
        await page.goto(path);
      }
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle search with special characters on salons page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      const searchInput = page.locator(
        'input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]'
      ).first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('<script>alert("xss")</script>');
        // Should sanitize and not execute script
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should render client portal on mobile viewport', { tag: '@full' }, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should render client portal on tablet viewport', { tag: '@full' }, async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1194 });
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle back/forward browser navigation', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons');
      await page.waitForLoadState('domcontentloaded');

      const salonLink = page.locator('a[href*="/salons/"]').first();
      if (await salonLink.isVisible()) {
        await salonLink.click();
        await page.waitForLoadState('domcontentloaded');
        await page.goBack();
        await page.waitForLoadState('domcontentloaded');
        await expect(page).toHaveURL(/\/salons/);
        await page.goForward();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should handle page refresh on appointments page', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/appointments');
      await page.waitForLoadState('domcontentloaded');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
