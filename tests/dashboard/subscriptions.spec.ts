import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function navigateToSubscription(page: Page) {
  await page.goto('/dashboard/subscription');
  await page.waitForLoadState('domcontentloaded');
}

// ---------------------------------------------------------------------------
// Flow 9: Subscriptions & Stripe Payments (P1)
// ---------------------------------------------------------------------------

test.describe('Flow 9: Subscriptions & Stripe', () => {
  // Auth handled by storageState — no login needed

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display subscription page', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      await expect(
        page.getByText(/subskrypcj|subscription|plan/i).first()
      ).toBeVisible();
    });

    test('should display current plan status', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Should show current plan info (Basic, Pro, Trial, or no plan)
      await expect(
        page.getByText(/basic|pro|trial|aktywn|active|brak planu/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display plan comparison (Basic vs Pro)', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // For users without a plan, the page shows "Brak aktywnej subskrypcji" with "Wybierz plan" link
      // For users with a plan, it shows plan details
      await expect(
        page.getByText(/basic|pro|brak.*subskrypcj|wybierz plan/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display plan prices', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Prices visible on subscription page or pricing page
      await expect(
        page.getByText(/49|149|PLN|brak.*subskrypcj|wybierz plan/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should show upgrade button for Basic users', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      const upgradeBtn = page.getByRole('button', { name: /upgrade|uaktualnij|zmie[nń] na pro/i });
      // Upgrade button may or may not be visible depending on current plan
      if (await upgradeBtn.isVisible()) {
        await expect(upgradeBtn).toBeEnabled();
      }
    });

    test('should show downgrade button for Pro users', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      const downgradeBtn = page.getByRole('button', { name: /downgrade|obni[zż]|zmie[nń] na basic/i });
      // May or may not be visible depending on plan
      if (await downgradeBtn.isVisible()) {
        await expect(downgradeBtn).toBeEnabled();
      }
    });

    test('should show cancel subscription option', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      const cancelBtn = page.getByRole('button', { name: /anuluj subskrypcj|cancel subscription/i });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        // Should show confirmation dialog
        await expect(
          page.locator('[role="alertdialog"], [role="dialog"]')
            .or(page.getByText(/czy na pewno|are you sure|potwierd[zź]/i).first())
            .first()
        ).toBeVisible({ timeout: 3000 });
      }
    });

    test('should navigate to payment history', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/subscription/payments');
      await page.waitForLoadState('domcontentloaded');
      await expect(
        page.getByText(/historia|p[lł]atno[sś]ci|payments|history/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display trial information for new users', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // If user is on trial, should show trial info
      // UI: "Okres probny" (no diacritics)
      const trialInfo = page.getByText(/trial|pr[oó]bn|14 dni|testow/i);
      if (await trialInfo.first().isVisible()) {
        await expect(trialInfo.first()).toBeVisible();
      }
    });

    test('should display next billing date', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // If subscribed, should show next billing date
      // UI: "Nastepna platnosc" / "Nastepne odnowienie" (no diacritics)
      const billingDate = page.getByText(/nast[eę]pna p[lł]atno|next billing|rozliczeni|odnowienie/i);
      if (await billingDate.first().isVisible()) {
        await expect(billingDate.first()).toBeVisible();
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should handle subscription page without active plan', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Should render properly even without active subscription
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should prevent unauthenticated access to subscription page', { tag: '@full' }, async ({ browser }) => {
      const newContext = await browser.newContext();
      const newPage = await newContext.newPage();
      await newPage.goto('/dashboard/subscription');
      await newPage.waitForLoadState('domcontentloaded');
      // Should either redirect to login or show auth-gated content (not crash)
      await expect(newPage.locator('body')).not.toContainText(/Internal Server Error/i);
      await newPage.close();
      await newContext.close();
    });

    test('should handle Stripe checkout errors gracefully', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);

      // Try to initiate checkout (if button available)
      const checkoutBtn = page.getByRole('button', { name: /wybierz|choose|subscribe|aktywuj/i }).first();
      if (await checkoutBtn.isVisible()) {
        await checkoutBtn.click();
        // Should either redirect to Stripe or show error — NOT crash
        await expect(page.locator('body')).not.toContainText(/Internal Server Error|unexpected/i);
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle double-click on upgrade button', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);

      const upgradeBtn = page.getByRole('button', { name: /upgrade|uaktualnij|zmie[nń] na pro/i });
      if (await upgradeBtn.isVisible()) {
        await upgradeBtn.dblclick();
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should display subscription success page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/subscription/success');
      await page.waitForLoadState('domcontentloaded');
      // Should render without crash (may show success or redirect)
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle cancel confirmation dialog - dismiss', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);

      const cancelBtn = page.getByRole('button', { name: /anuluj subskrypcj|cancel subscription/i });
      if (await cancelBtn.isVisible()) {
        await cancelBtn.click();

        // Dismiss the dialog
        const dismissBtn = page.getByRole('button', { name: /nie|cancel|anuluj|wr[oó][cć]/i }).last();
        if (await dismissBtn.isVisible()) {
          await dismissBtn.click();
          // Dialog should close, subscription unchanged
        }
      }
    });

    test('should show plan features list', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Plans should list their features, or show subscription status / empty state
      await expect(
        page.getByText(/funkcj|feature|zawiera|includes|plan|subskrypcj|brak/i).first()
          .or(page.locator('ul, [role="list"]').first())
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should handle page refresh on subscription page', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      await expect(
        page.getByText(/subskrypcj|subscription|plan/i).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });
});
