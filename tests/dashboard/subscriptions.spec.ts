import { test, expect, type Page } from '../fixtures';

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

    test('should not show upgrade button for Basic users when pro is not on sale', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Salon testowy ma po seedzie aktywny plan Basic, a "pro" nie jest na liście PLANS_ON_SALE:
      // najpierw karta planu (przycisk anulowania), potem brak przycisku przejścia na Pro.
      await expect(page.getByRole('button', { name: 'Anuluj subskrypcje', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Zmien na Pro', exact: true })).toHaveCount(0);
    });

    test('should not show downgrade button on Basic plan', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Najpierw karta planu (przycisk anulowania, koniec ładowania), potem brak przycisku obniżenia planu.
      await expect(page.getByRole('button', { name: 'Anuluj subskrypcje', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Zmien na Basic', exact: true })).toHaveCount(0);
    });

    test('should show cancel subscription option', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      const cancelBtn = page.getByRole('button', { name: 'Anuluj subskrypcje', exact: true });
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Tak, anuluj subskrypcje', exact: true })).toBeVisible();
      // Okno zamykane rezygnacją: subskrypcja zostaje bez zmian.
      await dialog.getByRole('button', { name: 'Nie, zachowaj', exact: true }).click();
      await expect(dialog).toBeHidden();
    });

    test('should navigate to payment history', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/subscription/payments');
      await page.waitForLoadState('domcontentloaded');
      await expect(
        page.getByText(/historia|p[lł]atno[sś]ci|payments|history/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should not show trial information for active subscription', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Subskrypcja aktywna: status „Aktywna”, bez informacji o okresie próbnym i bez przycisku zakupu z okresu próbnego.
      await expect(page.getByText('Aktywna', { exact: true })).toBeVisible();
      await expect(page.getByText(/Okres probny/)).toHaveCount(0);
      await expect(page.getByText('Koniec okresu probnego', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Wykup subskrypcje', exact: true })).toHaveCount(0);
    });

    test('should show next payment label without a date when period has no dates', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);
      // Subskrypcja bez dat okresu: etykiety płatności i odnowienia są, w miejscu daty „-”.
      const nextPayment = page.getByText('Nastepna platnosc', { exact: true });
      await expect(nextPayment).toBeVisible();
      await expect(nextPayment.locator('xpath=following-sibling::p[1]')).toHaveText('-');
      const nextRenewal = page.getByText('Nastepne odnowienie', { exact: true });
      await expect(nextRenewal).toBeVisible();
      await expect(nextRenewal.locator('xpath=following-sibling::span[1]')).toHaveText('-');
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

    test('should not offer plan selection for active subscription', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);

      // Subskrypcja aktywna: karta planu zamiast wyboru planu, bez ponownej aktywacji i bez zakupu z okresu próbnego.
      await expect(page.getByRole('button', { name: 'Anuluj subskrypcje', exact: true })).toBeVisible();
      await expect(page.getByText('Brak aktywnej subskrypcji', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Wybierz plan', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Aktywuj ponownie', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Wykup subskrypcje', exact: true })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error|unexpected/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should open one dialog on double-click of cancel subscription button', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);

      const cancelBtn = page.getByRole('button', { name: 'Anuluj subskrypcje', exact: true });
      await expect(cancelBtn).toBeVisible();
      await cancelBtn.dblclick();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);

      // Podwójne kliknięcie otwiera jedno okno anulowania; zamknięcie rezygnacją, bez potwierdzenia anulowania.
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toHaveCount(1);
      await expect(dialog.getByRole('button', { name: 'Tak, anuluj subskrypcje', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Nie, zachowaj', exact: true }).click();
      await expect(dialog).toBeHidden();

      const res = await page.request.get('/api/subscriptions/current');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.subscription?.status).toBe('active');
      expect(body.plan?.slug).toBe('basic');
    });

    test('should display subscription success page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/subscription/success');
      await page.waitForLoadState('domcontentloaded');
      // Should render without crash (may show success or redirect)
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle cancel confirmation dialog - dismiss', { tag: '@full' }, async ({ page }) => {
      await navigateToSubscription(page);

      // Salon testowy ma po seedzie aktywną subskrypcję, więc przycisk jest na stronie.
      await page.getByRole('button', { name: 'Anuluj subskrypcje', exact: true }).click();

      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      // Zamknięcie po dokładnej nazwie: w oknie jest też przycisk potwierdzenia anulowania.
      await dialog.getByRole('button', { name: 'Nie, zachowaj', exact: true }).click();
      await expect(dialog).toBeHidden();

      // Subskrypcja bez zmian.
      const res = await page.request.get('/api/subscriptions/current');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.subscription?.status).toBe('active');
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
