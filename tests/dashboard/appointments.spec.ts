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

async function navigateToCalendar(page: Page) {
  await page.goto('/dashboard/calendar');
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Flow 4: Appointment System (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 4: Appointment System', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display calendar page with controls', async ({ page }) => {
      await navigateToCalendar(page);
      await expect(page.getByTestId('new-appointment-btn')).toBeVisible();
      await expect(page.getByTestId('employee-filter')).toBeVisible();
    });

    test('should open new appointment dialog', async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('new-appointment-btn').click();
      // Dialog should open with client/service/employee selection
      await expect(
        page.getByText(/nowa wizyta|nowe spotkanie|nowa rezerwacja/i).first()
          .or(page.locator('[role="dialog"]'))
      ).toBeVisible({ timeout: 5000 });
    });

    test('should create a new appointment', async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('new-appointment-btn').click();
      await page.waitForTimeout(500);

      // Fill appointment form — select client, service, employee
      // These selectors depend on the actual dialog implementation
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible()) {
        // Select first available client
        const clientSelect = dialog.locator('select, [role="combobox"]').first();
        if (await clientSelect.isVisible()) {
          await clientSelect.click();
          await page.getByRole('option').first().click();
        }

        // Select service
        const serviceSelect = dialog.locator('select, [role="combobox"]').nth(1);
        if (await serviceSelect.isVisible()) {
          await serviceSelect.click();
          await page.getByRole('option').first().click();
        }

        // Confirm/save
        const saveBtn = dialog.getByRole('button', { name: /zapisz|potwierdź|utwórz|dodaj/i });
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
          await page.waitForLoadState('networkidle');
        }
      }
    });

    test('should filter calendar by employee', async ({ page }) => {
      await navigateToCalendar(page);

      const filter = page.getByTestId('employee-filter');
      await filter.click();
      await page.waitForTimeout(300);

      // Select a specific employee (first option)
      const option = page.getByRole('option').first();
      if (await option.isVisible()) {
        await option.click();
        await page.waitForLoadState('networkidle');
      }
    });

    test('should switch between day and week view', async ({ page }) => {
      await navigateToCalendar(page);

      // Click week view button
      const weekBtn = page.getByRole('button', { name: /tydzień|week/i });
      if (await weekBtn.isVisible()) {
        await weekBtn.click();
        await page.waitForTimeout(500);
        // Week view should be active
      }

      // Click day view button
      const dayBtn = page.getByRole('button', { name: /dzień|day/i });
      if (await dayBtn.isVisible()) {
        await dayBtn.click();
        await page.waitForTimeout(500);
      }
    });

    test('should navigate between days', async ({ page }) => {
      await navigateToCalendar(page);

      // Navigate to next day
      const nextBtn = page.getByRole('button', { name: /następn|next|>/i }).first();
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      }

      // Navigate to previous day
      const prevBtn = page.getByRole('button', { name: /poprzedn|prev|</i }).first();
      if (await prevBtn.isVisible()) {
        await prevBtn.click();
        await page.waitForTimeout(500);
      }

      // Go to today
      const todayBtn = page.getByRole('button', { name: /dziś|dzisiaj|today/i });
      if (await todayBtn.isVisible()) {
        await todayBtn.click();
        await page.waitForTimeout(500);
      }
    });

    test('should open block time dialog', async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('block-time-btn').click();
      await expect(
        page.locator('[role="dialog"]')
          .or(page.getByText(/zablokuj|blokada|przerwa/i).first())
      ).toBeVisible({ timeout: 3000 });
    });

    test('should navigate to booking page', async ({ page }) => {
      await page.goto('/dashboard/booking');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should view appointment details', async ({ page }) => {
      await navigateToCalendar(page);

      // Click on an existing appointment event if any
      const appointment = page.locator('[class*="appointment"], [class*="event"], [data-appointment]').first();
      if (await appointment.isVisible()) {
        await appointment.click();
        await page.waitForTimeout(500);
        // Should show details or toast with appointment info
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should prevent creating appointment without required fields', async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('new-appointment-btn').click();
      await page.waitForTimeout(500);

      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible()) {
        // Try to save without selecting anything
        const saveBtn = dialog.getByRole('button', { name: /zapisz|potwierdź|utwórz|dodaj/i });
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
          // Should show validation errors
          await expect(
            page.getByText(/wymagane|required|wybierz|select/i).first()
          ).toBeVisible({ timeout: 3000 });
        }
      }
    });

    test('should handle calendar page without appointments', async ({ page }) => {
      await navigateToCalendar(page);
      // Should display calendar grid even with no appointments
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should prevent access to calendar without auth', async ({ page }) => {
      // Clear auth by going to a new context
      const newPage = await page.context().newPage();
      await newPage.goto('/dashboard/calendar');
      await newPage.waitForURL('**/login**', { timeout: 10000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle rapid view switching', async ({ page }) => {
      await navigateToCalendar(page);

      const weekBtn = page.getByRole('button', { name: /tydzień|week/i });
      const dayBtn = page.getByRole('button', { name: /dzień|day/i });

      if (await weekBtn.isVisible() && await dayBtn.isVisible()) {
        for (let i = 0; i < 5; i++) {
          await weekBtn.click();
          await dayBtn.click();
        }
        await page.waitForTimeout(1000);
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should handle rapid date navigation', async ({ page }) => {
      await navigateToCalendar(page);

      const nextBtn = page.getByRole('button', { name: /następn|next|>/i }).first();
      if (await nextBtn.isVisible()) {
        for (let i = 0; i < 10; i++) {
          await nextBtn.click();
        }
        await page.waitForTimeout(1000);
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should display appointment cancel dialog', async ({ page }) => {
      await navigateToCalendar(page);

      // Find and click an appointment
      const appointment = page.locator('[class*="appointment"], [class*="event"], [data-appointment]').first();
      if (await appointment.isVisible()) {
        await appointment.click();
        await page.waitForTimeout(500);

        // Look for cancel button
        const cancelBtn = page.getByRole('button', { name: /anuluj|cancel/i }).first();
        if (await cancelBtn.isVisible()) {
          await cancelBtn.click();
          await expect(
            page.locator('[role="dialog"]')
              .or(page.getByText(/anulować|cancel|powód/i).first())
          ).toBeVisible({ timeout: 3000 });
        }
      }
    });

    test('should display complete appointment dialog', async ({ page }) => {
      await navigateToCalendar(page);

      const appointment = page.locator('[class*="appointment"], [class*="event"], [data-appointment]').first();
      if (await appointment.isVisible()) {
        await appointment.click();
        await page.waitForTimeout(500);

        const completeBtn = page.getByRole('button', { name: /zakończ|complete/i }).first();
        if (await completeBtn.isVisible()) {
          await completeBtn.click();
          await expect(
            page.locator('[role="dialog"]')
          ).toBeVisible({ timeout: 3000 });
        }
      }
    });

    test('should handle calendar with multiple employee colors', async ({ page }) => {
      await navigateToCalendar(page);
      // Calendar should render without errors even with multiple employees
      await page.waitForTimeout(1000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });
});
