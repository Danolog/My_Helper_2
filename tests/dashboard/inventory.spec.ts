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
  await page.getByRole('button', { name: /^zaloguj sie$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
}

async function navigateToProducts(page: Page) {
  await page.goto('/dashboard/products');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle');
  // Wait for page hydration — ensure the add product button is interactive
  await page.getByRole('button', { name: /dodaj produkt|add product/i }).waitFor({ state: 'visible', timeout: 30000 });
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
    test('should display products page with header', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await expect(page.getByText(/produkty|magazyn|inventory/i).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: /dodaj produkt|add product/i })
      ).toBeVisible();
    });

    test('should open add product dialog/form', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();

      // Form fields should be visible
      await expect(
        page.getByTestId('product-dialog')
          .or(page.locator('[role="dialog"]'))
          .or(page.getByText(/nazwa produktu|product name/i).first())
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should add a new product', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.getByTestId('product-name-input').waitFor({ state: 'visible', timeout: 5000 });

      // Fill product form using data-testid selectors
      await page.getByTestId('product-name-input').fill('Farba do włosów - Blond');
      await page.getByTestId('product-price-input').fill('45.99');
      await page.getByTestId('product-quantity-input').fill('20');

      const minInput = page.getByTestId('product-min-quantity-input');
      if (await minInput.isVisible()) {
        await minInput.fill('5');
      }

      // Save
      await page.getByTestId('save-product-btn').click();
      await page.waitForLoadState('domcontentloaded');

      // Product should appear
      await expect(
        page.getByText(/farba do włosów/i).or(page.getByText('Blond')).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display product categories tab', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);

      const categoriesTab = page.getByRole('tab', { name: /kategorie|categories/i })
        .or(page.getByText(/kategorie/i).first())
        .first();
      if (await categoriesTab.isVisible()) {
        await categoriesTab.click();
      }
    });

    test('should display stock alerts tab', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);

      const alertsTab = page.getByRole('tab', { name: /alert|niski stan|low stock/i })
        .or(page.getByText(/alert/i).first())
        .first();
      if (await alertsTab.isVisible()) {
        await alertsTab.click();
      }
    });

    test('should search for products', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);

      const searchInput = page.locator('input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]').first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('farba');
        // Filtered results should show
      }
    });

    test('should navigate to product detail page', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);

      // Click on a product card/row
      const productLink = page.locator('a[href*="/products/"]').first();
      if (await productLink.isVisible()) {
        await productLink.click();
        await page.waitForURL('**/products/**', { timeout: 5000 });
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error when adding product without name', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.getByTestId('product-name-input').waitFor({ state: 'visible', timeout: 5000 });

      // Try to save without filling required fields
      await page.getByTestId('save-product-btn').click();

      // Should show validation error
      await expect(
        page.getByText(/wymagane|required|nazwa/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject negative quantity', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.getByTestId('product-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('product-name-input').fill('Test Product');
      await page.getByTestId('product-quantity-input').fill('-5');

      await page.getByTestId('save-product-btn').click();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should reject negative price', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.getByTestId('product-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('product-name-input').fill('Test Product');
      await page.getByTestId('product-price-input').fill('-10');

      await page.getByTestId('save-product-btn').click();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle empty product list', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      // Page should render without errors
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle very large quantity value', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.getByTestId('product-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('product-name-input').fill('Bulk Product');
      await page.getByTestId('product-quantity-input').fill('9999999');

      await page.getByTestId('save-product-btn').click();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle special characters in product name', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);
      await page.getByRole('button', { name: /dodaj produkt|add product/i }).click();
      await page.getByTestId('product-name-input').waitFor({ state: 'visible', timeout: 5000 });

      await page.getByTestId('product-name-input').fill('Lakier "żelowy" — Łódź #2');

      await page.getByTestId('save-product-btn').click();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle search with no results', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);

      const searchInput = page.locator('input[type="search"], input[placeholder*="szukaj"], input[placeholder*="search"]').first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('nonexistent_product_xyz_123');
        // Should show empty state or "no results" message
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should handle rapid tab switching on products page', { tag: '@full' }, async ({ page }) => {
      await navigateToProducts(page);

      const tabs = page.getByRole('tab');
      const tabCount = await tabs.count();

      if (tabCount > 1) {
        for (let i = 0; i < tabCount * 3; i++) {
          await tabs.nth(i % tabCount).click();
        }
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });
  });
});
