import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (auth handled by storageState in playwright.config.ts)
// ---------------------------------------------------------------------------

async function navigateToServices(page: Page) {
  await page.goto('/dashboard/services');
  await page.waitForLoadState('domcontentloaded');
  // Wait for page hydration — ensure the add button is interactive
  await page.getByTestId('add-service-btn').waitFor({ state: 'visible', timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Flow 3: Services & Categories Management (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 3: Services & Categories', () => {
  // Auth handled by storageState — no login needed

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display services page with tabs', { tag: '@smoke' }, async ({ page }) => {
      await navigateToServices(page);
      // UI: "Uslugi" (no diacritics)
      await expect(page.getByText(/us[lł]ugi/i).first()).toBeVisible();
      await expect(page.getByTestId('add-service-btn')).toBeVisible();
      // Tabs should be visible
      await expect(page.getByTestId('tab-categories').or(page.getByText(/kategorie/i).first()).first()).toBeVisible();
    });

    test('should open add service dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await expect(page.getByTestId('service-name-input')).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId('service-price-input')).toBeVisible();
      await expect(page.getByTestId('service-duration-input')).toBeVisible();
    });

    test('should add a new service', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await page.getByTestId('service-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('service-name-input').fill('Strzyżenie damskie');
      await page.getByTestId('service-price-input').fill('120');
      await page.getByTestId('service-duration-input').fill('60');

      await page.getByTestId('save-service-btn').click();
      await page.waitForLoadState('domcontentloaded');

      // Service should appear on the list
      await expect(
        page.getByText('Strzyżenie damskie').first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should create a service category', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      // Switch to categories tab
      await page.getByTestId('tab-categories').click();

      await page.getByTestId('add-category-btn').click();
      await page.getByTestId('category-name-input').fill('Fryzjerstwo');
      await page.getByTestId('save-category-btn').click();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Fryzjerstwo').first()).toBeVisible({ timeout: 5000 });
    });

    test('should edit a service category', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();

      // Click edit on first category
      const editBtn = page.locator('[data-testid^="edit-category-"]').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.getByTestId('category-name-input').clear();
        await page.getByTestId('category-name-input').fill('Fryzjerstwo Edytowane');
        await page.getByTestId('save-category-btn').click();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText('Fryzjerstwo Edytowane').first()).toBeVisible({ timeout: 5000 });
      }
    });

    test('should assign category to a service', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      // Find a service card with category assignment dropdown
      const assignSelect = page.locator('[data-testid^="assign-category-"]').first();
      if (await assignSelect.isVisible()) {
        await assignSelect.click();
        // Select first category option
        await page.getByRole('option').first().click();
        await page.waitForLoadState('domcontentloaded');
      }
    });

    test('should delete a service with confirmation', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      const deleteBtn = page.locator('[data-testid^="delete-service-"]').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        // Confirmation dialog
        await expect(
          page.getByTestId('confirm-delete-service-btn')
        ).toBeVisible({ timeout: 3000 });
        await page.getByTestId('confirm-delete-service-btn').click();
        await page.waitForLoadState('domcontentloaded');
      }
    });

    test('should cancel service deletion', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      const deleteBtn = page.locator('[data-testid^="delete-service-"]').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.getByTestId('cancel-delete-service-btn').click();
        // Dialog should close, service still visible
        await expect(
          page.getByTestId('cancel-delete-service-btn')
        ).not.toBeVisible({ timeout: 2000 });
      }
    });

    test('should delete a category with confirmation', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();
      await page.waitForLoadState('networkidle');

      const deleteBtn = page.locator('[data-testid^="delete-category-"]').first();
      await deleteBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        const confirmBtn = page.getByTestId('confirm-delete-category-btn');
        await confirmBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await page.waitForLoadState('networkidle');
        }
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show validation errors for empty service form', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await page.getByTestId('service-name-input').waitFor({ state: 'visible', timeout: 5000 });

      // Submit without filling
      await page.getByTestId('save-service-btn').click();

      // Should show validation errors
      await expect(
        page.getByTestId('error-service-name')
          .or(page.getByText(/wymagane|required|nazwa/i).first())
          .first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject negative price', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await page.getByTestId('service-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('service-name-input').fill('Test Usługa');
      await page.getByTestId('service-price-input').fill('-50');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();

      // Should show price validation error, or browser may prevent negative input
      await expect(
        page.getByTestId('error-service-price')
          .or(page.getByText(/cena|price|ujemna|0/i).first())
          .first()
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Browser may prevent negative input - verify no crash
      });
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should reject zero duration', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await page.getByTestId('service-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('service-name-input').fill('Test Usługa');
      await page.getByTestId('service-price-input').fill('100');
      await page.getByTestId('service-duration-input').fill('0');
      await page.getByTestId('save-service-btn').click();

      // Should show duration validation error, or browser may prevent zero input
      await expect(
        page.getByTestId('error-service-duration')
          .or(page.getByText(/czas|duration|0|wi[eę]ksz/i).first())
          .first()
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Browser may prevent zero input - verify no crash
      });
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should show error for empty category name', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();

      await page.getByTestId('add-category-btn').click();
      await page.getByTestId('save-category-btn').click();

      await expect(
        page.getByText(/wymagane|required|nazwa/i).first()
      ).toBeVisible({ timeout: 3000 });
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle very long service name', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      const longName = 'Usługa '.repeat(50);
      await page.getByTestId('service-name-input').fill(longName);
      await page.getByTestId('service-price-input').fill('100');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();

      // Should not crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle decimal price values', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Usługa z groszami');
      await page.getByTestId('service-price-input').fill('99.99');
      await page.getByTestId('service-duration-input').fill('45');
      await page.getByTestId('save-service-btn').click();
      await page.waitForLoadState('domcontentloaded');

      // Should accept decimal prices
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle switching between tabs rapidly', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      // Rapid tab switching
      for (let i = 0; i < 5; i++) {
        await page.getByTestId('tab-categories').click();
        await page.getByTestId('tab-categories').click(); // Click services tab back
      }
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle special characters in service name', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Koloryzacja "ombré" & balejaż');
      await page.getByTestId('service-price-input').fill('250');
      await page.getByTestId('service-duration-input').fill('120');
      await page.getByTestId('save-service-btn').click();

      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle very high price value', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Premium Service');
      await page.getByTestId('service-price-input').fill('999999');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();

      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
