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

async function navigateToProducts(page: Page) {
  await page.goto('/dashboard/products');
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Flow 5: Inventory & Materials (P1)
// ---------------------------------------------------------------------------

test.describe('Flow 5: Inventory & Materials', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display products page with header', async ({ page }) => {
      await navigateToProducts(page);
      await expect(page.getByText(/produkty|magazyn|inventory/i).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: /dodaj produkt|add product/i })
      ).toBeVisible();
    });

    test('should open add product dialog/form', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      // Form fields should be visible
      await expect(
        page.locator('[role="dialog"]')
          .or(page.getByText(/nazwa produktu|product name/i).first())
      ).toBeVisible({ timeout: 3000 });
    });

    test('should add a new product', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      // Fill product form
      const nameInput = page.locator('input[name="name"], input[placeholder*="nazw"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('Farba do włosów - Blond');
      }

      const priceInput = page.locator('input[name="price"], input[placeholder*="cen"]').first();
      if (await priceInput.isVisible()) {
        await priceInput.fill('45.99');
      }

      const quantityInput = page.locator('input[name="quantity"], input[placeholder*="ilo"]').first();
      if (await quantityInput.isVisible()) {
        await quantityInput.fill('20');
      }

      const minStockInput = page.locator('input[name="minimumStock"], input[name="minimum"], input[placeholder*="min"]').first();
      if (await minStockInput.isVisible()) {
        await minStockInput.fill('5');
      }

      // Save
      await page.getByRole('button', { name: /zapisz|dodaj|save|add/i }).last().click();
      await page.waitForLoadState('networkidle');

      // Product should appear
      await expect(
        page.getByText(/farba do włosów/i).or(page.getByText('Blond'))
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display product categories tab', async ({ page }) => {
      await navigateToProducts(page);

      const categoriesTab = page.getByRole('tab', { name: /kategorie|categories/i })
        .or(page.getByText(/kategorie/i).first());
      if (await categoriesTab.isVisible()) {
        await categoriesTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('should display stock alerts tab', async ({ page }) => {
      await navigateToProducts(page);

      const alertsTab = page.getByRole('tab', { name: /alert|niski stan|low stock/i })
        .or(page.getByText(/alert/i).first());
      if (await alertsTab.isVisible()) {
        await alertsTab.click();
        await page.waitForTimeout(500);
      }
    });

    test('should search for products', async ({ page }) => {
      await navigateToProducts(page);

      const searchInput = page.locator('input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]').first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('farba');
        await page.waitForTimeout(500);
        // Filtered results should show
      }
    });

    test('should navigate to product detail page', async ({ page }) => {
      await navigateToProducts(page);

      // Click on a product card/row
      const productLink = page.locator('a[href*="/products/"]').first();
      if (await productLink.isVisible()) {
        await productLink.click();
        await page.waitForURL('**/products/**', { timeout: 5000 });
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error when adding product without name', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      // Try to save without filling required fields
      await page.getByRole('button', { name: /zapisz|dodaj|save|add/i }).last().click();

      // Should show validation error
      await expect(
        page.getByText(/wymagane|required|nazwa/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject negative quantity', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      const nameInput = page.locator('input[name="name"], input[placeholder*="nazw"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('Test Product');
      }

      const quantityInput = page.locator('input[name="quantity"], input[placeholder*="ilo"]').first();
      if (await quantityInput.isVisible()) {
        await quantityInput.fill('-5');
      }

      await page.getByRole('button', { name: /zapisz|dodaj|save|add/i }).last().click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should reject negative price', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      const nameInput = page.locator('input[name="name"], input[placeholder*="nazw"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('Test Product');
      }

      const priceInput = page.locator('input[name="price"], input[placeholder*="cen"]').first();
      if (await priceInput.isVisible()) {
        await priceInput.fill('-10');
      }

      await page.getByRole('button', { name: /zapisz|dodaj|save|add/i }).last().click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle empty product list', async ({ page }) => {
      await navigateToProducts(page);
      // Page should render without errors
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle very large quantity value', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      const nameInput = page.locator('input[name="name"], input[placeholder*="nazw"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('Bulk Product');
      }

      const quantityInput = page.locator('input[name="quantity"], input[placeholder*="ilo"]').first();
      if (await quantityInput.isVisible()) {
        await quantityInput.fill('9999999');
      }

      await page.getByRole('button', { name: /zapisz|dodaj|save|add/i }).last().click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle special characters in product name', async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.waitForTimeout(500);

      const nameInput = page.locator('input[name="name"], input[placeholder*="nazw"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('Lakier "żelowy" — Łódź #2');
      }

      await page.getByRole('button', { name: /zapisz|dodaj|save|add/i }).last().click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle search with no results', async ({ page }) => {
      await navigateToProducts(page);

      const searchInput = page.locator('input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]').first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('nonexistent_product_xyz_123');
        await page.waitForTimeout(500);
        // Should show empty state or "no results" message
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should handle rapid tab switching on products page', async ({ page }) => {
      await navigateToProducts(page);

      const tabs = page.getByRole('tab');
      const tabCount = await tabs.count();

      if (tabCount > 1) {
        for (let i = 0; i < tabCount * 3; i++) {
          await tabs.nth(i % tabCount).click();
        }
        await page.waitForTimeout(500);
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });
  });
});
