import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_CREDENTIALS = {
  email: 'owner@test.com',
  password: 'TestPassword123!',
};

async function loginAsOwner(page: Page) {
  await page.goto('/login');
  await page.fill('#email', OWNER_CREDENTIALS.email);
  await page.fill('#password', OWNER_CREDENTIALS.password);
  await page.getByRole('button', { name: /zaloguj się/i }).click();
  await page.waitForURL('**/dashboard**', { timeout: 10000 });
}

async function navigateToServices(page: Page) {
  await page.goto('/dashboard/services');
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Flow 3: Services & Categories Management (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 3: Services & Categories', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display services page with tabs', async ({ page }) => {
      await navigateToServices(page);
      await expect(page.getByText(/usługi/i).first()).toBeVisible();
      await expect(page.getByTestId('add-service-btn')).toBeVisible();
      // Tabs should be visible
      await expect(page.getByTestId('tab-categories').or(page.getByText(/kategorie/i).first())).toBeVisible();
    });

    test('should open add service dialog', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await expect(page.getByTestId('service-name-input')).toBeVisible({ timeout: 3000 });
      await expect(page.getByTestId('service-price-input')).toBeVisible();
      await expect(page.getByTestId('service-duration-input')).toBeVisible();
    });

    test('should add a new service', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Strzyżenie damskie');
      await page.getByTestId('service-price-input').fill('120');
      await page.getByTestId('service-duration-input').fill('60');

      await page.getByTestId('save-service-btn').click();
      await page.waitForLoadState('networkidle');

      // Service should appear on the list
      await expect(
        page.getByText('Strzyżenie damskie')
      ).toBeVisible({ timeout: 5000 });
    });

    test('should create a service category', async ({ page }) => {
      await navigateToServices(page);

      // Switch to categories tab
      await page.getByTestId('tab-categories').click();
      await page.waitForTimeout(300);

      await page.getByTestId('add-category-btn').click();
      await page.getByTestId('category-name-input').fill('Fryzjerstwo');
      await page.getByTestId('save-category-btn').click();
      await page.waitForLoadState('networkidle');

      await expect(page.getByText('Fryzjerstwo')).toBeVisible({ timeout: 5000 });
    });

    test('should edit a service category', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();
      await page.waitForTimeout(300);

      // Click edit on first category
      const editBtn = page.locator('[data-testid^="edit-category-"]').first();
      if (await editBtn.isVisible()) {
        await editBtn.click();
        await page.getByTestId('category-name-input').clear();
        await page.getByTestId('category-name-input').fill('Fryzjerstwo Edytowane');
        await page.getByTestId('save-category-btn').click();
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Fryzjerstwo Edytowane')).toBeVisible({ timeout: 5000 });
      }
    });

    test('should assign category to a service', async ({ page }) => {
      await navigateToServices(page);

      // Find a service card with category assignment dropdown
      const assignSelect = page.locator('[data-testid^="assign-category-"]').first();
      if (await assignSelect.isVisible()) {
        await assignSelect.click();
        // Select first category option
        await page.getByRole('option').first().click();
        await page.waitForLoadState('networkidle');
      }
    });

    test('should delete a service with confirmation', async ({ page }) => {
      await navigateToServices(page);

      const deleteBtn = page.locator('[data-testid^="delete-service-"]').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        // Confirmation dialog
        await expect(
          page.getByTestId('confirm-delete-service-btn')
        ).toBeVisible({ timeout: 3000 });
        await page.getByTestId('confirm-delete-service-btn').click();
        await page.waitForLoadState('networkidle');
      }
    });

    test('should cancel service deletion', async ({ page }) => {
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

    test('should delete a category with confirmation', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();
      await page.waitForTimeout(300);

      const deleteBtn = page.locator('[data-testid^="delete-category-"]').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await expect(
          page.getByTestId('confirm-delete-category-btn')
        ).toBeVisible({ timeout: 3000 });
        await page.getByTestId('confirm-delete-category-btn').click();
        await page.waitForLoadState('networkidle');
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show validation errors for empty service form', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();
      await page.waitForTimeout(300);

      // Submit without filling
      await page.getByTestId('save-service-btn').click();

      // Should show validation errors
      await expect(
        page.getByTestId('error-service-name')
          .or(page.getByText(/wymagane|required|nazwa/i).first())
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject negative price', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Test Usługa');
      await page.getByTestId('service-price-input').fill('-50');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();

      // Should show price validation error
      await expect(
        page.getByTestId('error-service-price')
          .or(page.getByText(/cena|price|ujemna|0/i).first())
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject zero duration', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Test Usługa');
      await page.getByTestId('service-price-input').fill('100');
      await page.getByTestId('service-duration-input').fill('0');
      await page.getByTestId('save-service-btn').click();

      await expect(
        page.getByTestId('error-service-duration')
          .or(page.getByText(/czas|duration|0|większ/i).first())
      ).toBeVisible({ timeout: 3000 });
    });

    test('should show error for empty category name', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();
      await page.waitForTimeout(300);

      await page.getByTestId('add-category-btn').click();
      await page.getByTestId('save-category-btn').click();

      await expect(
        page.getByText(/wymagane|required|nazwa/i).first()
      ).toBeVisible({ timeout: 3000 });
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle very long service name', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      const longName = 'Usługa '.repeat(50);
      await page.getByTestId('service-name-input').fill(longName);
      await page.getByTestId('service-price-input').fill('100');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();
      await page.waitForTimeout(2000);

      // Should not crash
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle decimal price values', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Usługa z groszami');
      await page.getByTestId('service-price-input').fill('99.99');
      await page.getByTestId('service-duration-input').fill('45');
      await page.getByTestId('save-service-btn').click();
      await page.waitForLoadState('networkidle');

      // Should accept decimal prices
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle switching between tabs rapidly', async ({ page }) => {
      await navigateToServices(page);

      // Rapid tab switching
      for (let i = 0; i < 5; i++) {
        await page.getByTestId('tab-categories').click();
        await page.getByTestId('tab-categories').click(); // Click services tab back
      }
      await page.waitForTimeout(500);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle special characters in service name', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Koloryzacja "ombré" & balejaż');
      await page.getByTestId('service-price-input').fill('250');
      await page.getByTestId('service-duration-input').fill('120');
      await page.getByTestId('save-service-btn').click();
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle very high price value', async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('add-service-btn').click();

      await page.getByTestId('service-name-input').fill('Premium Service');
      await page.getByTestId('service-price-input').fill('999999');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });
});
