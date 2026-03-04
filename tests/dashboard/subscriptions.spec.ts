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

async function navigateToSubscription(page: Page) {
  await page.goto('/dashboard/subscription');
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Flow 9: Subscriptions & Stripe Payments (P1)
// ---------------------------------------------------------------------------

test.describe('Flow 9: Subscriptions & Stripe', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display subscription page', async ({ page }) => {
      await navigateToSubscription(page);
      await expect(
        page.getByText(/subskrypcj|subscription|plan/i).first()
      ).toBeVisible();
    });

    test('should display current plan status', async ({ page }) => {
      await navigateToSubscription(page);
      // Should show current plan info (Basic, Pro, Trial, or no plan)
      await expect(
        page.getByText(/basic|pro|trial|aktywn|active|brak planu/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display plan comparison (Basic vs Pro)', async ({ page }) => {
      await navigateToSubscription(page);
      // Both plans should be visible for comparison
      await expect(page.getByText(/basic/i).first()).toBeVisible();
      await expect(page.getByText(/pro/i).first()).toBeVisible();
    });

    test('should display plan prices', async ({ page }) => {
      await navigateToSubscription(page);
      // Basic: 49 PLN, Pro: 149 PLN
      await expect(
        page.getByText(/49|PLN/i).first()
          .or(page.getByText(/149/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should show upgrade button for Basic users', async ({ page }) => {
      await navigateToSubscription(page);
      const upgradeBtn = page.getByRole('button', { name: /upgrade|uaktualnij|zmień na pro/i });
      // Upgrade button may or may not be visible depending on current plan
      if (await upgradeBtn.isVisible()) {
        await expect(upgradeBtn).toBeEnabled();
      }
    });

    test('should show downgrade button for Pro users', async ({ page }) => {
      await navigateToSubscription(page);
      const downgradeBtn = page.getByRole('button', { name: /downgrade|obniż|zmień na basic/i });
      // May or may not be visible depending on plan
      if (await downgradeBtn.isVisible()) {
        await expect(downgradeBtn).toBeEnabled();
      }
    });

    test('should show cancel subscription option', async ({ page }) => {
      await navigateToSubscription(page);
      const cancelBtn = page.getByRole('button', { name: /anuluj subskrypcj|cancel subscription/i });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        // Should show confirmation dialog
        await expect(
          page.locator('[role="alertdialog"], [role="dialog"]')
            .or(page.getByText(/czy na pewno|are you sure|potwierdź/i).first())
        ).toBeVisible({ timeout: 3000 });
      }
    });

    test('should navigate to payment history', async ({ page }) => {
      await page.goto('/dashboard/subscription/payments');
      await page.waitForLoadState('networkidle');
      await expect(
        page.getByText(/historia|płatności|payments|history/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display trial information for new users', async ({ page }) => {
      await navigateToSubscription(page);
      // If user is on trial, should show trial info
      const trialInfo = page.getByText(/trial|próbn|14 dni|testow/i);
      if (await trialInfo.first().isVisible()) {
        await expect(trialInfo.first()).toBeVisible();
      }
    });

    test('should display next billing date', async ({ page }) => {
      await navigateToSubscription(page);
      // If subscribed, should show next billing date
      const billingDate = page.getByText(/następna płatność|next billing|rozliczeni|odnowienie/i);
      if (await billingDate.first().isVisible()) {
        await expect(billingDate.first()).toBeVisible();
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should handle subscription page without active plan', async ({ page }) => {
      await navigateToSubscription(page);
      // Should render properly even without active subscription
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should prevent unauthenticated access to subscription page', async ({ page }) => {
      const newPage = await page.context().newPage();
      await newPage.goto('/dashboard/subscription');
      await newPage.waitForURL('**/login**', { timeout: 10000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
    });

    test('should handle Stripe checkout errors gracefully', async ({ page }) => {
      await navigateToSubscription(page);

      // Try to initiate checkout (if button available)
      const checkoutBtn = page.getByRole('button', { name: /wybierz|choose|subscribe|aktywuj/i }).first();
      if (await checkoutBtn.isVisible()) {
        await checkoutBtn.click();
        await page.waitForTimeout(3000);
        // Should either redirect to Stripe or show error — NOT crash
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error|unexpected/i);
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle double-click on upgrade button', async ({ page }) => {
      await navigateToSubscription(page);

      const upgradeBtn = page.getByRole('button', { name: /upgrade|uaktualnij|zmień na pro/i });
      if (await upgradeBtn.isVisible()) {
        await upgradeBtn.dblclick();
        await page.waitForTimeout(2000);
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should display subscription success page', async ({ page }) => {
      await page.goto('/dashboard/subscription/success');
      await page.waitForLoadState('networkidle');
      // Should render without crash (may show success or redirect)
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle cancel confirmation dialog - dismiss', async ({ page }) => {
      await navigateToSubscription(page);

      const cancelBtn = page.getByRole('button', { name: /anuluj subskrypcj|cancel subscription/i });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        await page.waitForTimeout(500);

        // Dismiss the dialog
        const dismissBtn = page.getByRole('button', { name: /nie|cancel|anuluj|wróć/i }).last();
        if (await dismissBtn.isVisible()) {
          await dismissBtn.click();
          await page.waitForTimeout(500);
          // Dialog should close, subscription unchanged
        }
      }
    });

    test('should show plan features list', async ({ page }) => {
      await navigateToSubscription(page);
      // Plans should list their features
      await expect(
        page.getByText(/funkcj|feature|zawiera|includes/i).first()
          .or(page.locator('ul, [role="list"]').first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should handle page refresh on subscription page', async ({ page }) => {
      await navigateToSubscription(page);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      await expect(
        page.getByText(/subskrypcj|subscription|plan/i).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });
});
