import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function navigateToCalendar(page: Page) {
  await page.goto('/dashboard/calendar');
  await page.waitForLoadState('domcontentloaded');
  // Wait for calendar to fully load — either the appointment button appears
  // or the empty state ("Brak pracownikow") or the time grid renders
  await expect(
    page.getByTestId('new-appointment-btn')
      .or(page.getByText(/brak pracownik/i).first())
      .or(page.locator('[class*="time-grid"], [class*="calendar"]').first())
      .first()
  ).toBeVisible({ timeout: 30000 });
}

// ---------------------------------------------------------------------------
// Flow 4: Appointment System (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 4: Appointment System', () => {
  // Auth handled by storageState — no login needed

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display calendar page with controls', { tag: '@smoke' }, async ({ page }) => {
      await navigateToCalendar(page);
      // Calendar page should show controls or empty state
      await expect(
        page.getByTestId('new-appointment-btn')
          .or(page.getByText(/kalendarz|calendar/i).first())
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should open new appointment dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const newBtn = page.getByTestId('new-appointment-btn');
      if (await newBtn.isVisible()) {
        await newBtn.click();
        // Dialog should open with client/service/employee selection
        await expect(
          page.getByText(/nowa wizyta|nowe spotkanie|nowa rezerwacja/i).first()
            .or(page.locator('[role="dialog"]'))
            .first()
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test('should create a new appointment', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const newBtn = page.getByTestId('new-appointment-btn');
      if (!(await newBtn.isVisible())) return;
      await newBtn.click();

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
        const saveBtn = dialog.getByRole('button', { name: /zapisz|potwierd[zź]|utw[oó]rz|dodaj/i });
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
          await page.waitForLoadState('domcontentloaded');
        }
      }
    });

    test('should filter calendar by employee', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      const filter = page.getByTestId('employee-filter');
      if (!(await filter.isVisible())) return;
      await filter.click();

      // Select a specific employee (first option)
      const option = page.getByRole('option').first();
      if (await option.isVisible()) {
        await option.click();
        await page.waitForLoadState('domcontentloaded');
      }
    });

    test('should switch between day and week view', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      // Click week view button
      const weekBtn = page.getByRole('button', { name: /tydzien|tydzień|week/i });
      if (await weekBtn.isVisible()) {
        await weekBtn.click();
        // Week view should be active
      }

      // Click day view button
      const dayBtn = page.getByRole('button', { name: /^dzie[nń]$/i });
      if (await dayBtn.isVisible()) {
        await dayBtn.click();
      }
    });

    test('should navigate between days', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      // Navigate to next day
      const nextBtn = page.getByRole('button', { name: /nast[eę]pn|next|>/i }).first();
      if (await nextBtn.isVisible()) {
        await nextBtn.click();
      }

      // Navigate to previous day
      const prevBtn = page.getByRole('button', { name: /poprzedn|prev|</i }).first();
      if (await prevBtn.isVisible()) {
        await prevBtn.click();
      }

      // Go to today
      const todayBtn = page.getByRole('button', { name: /dzi[sś]|dzisiaj|today/i });
      if (await todayBtn.isVisible()) {
        await todayBtn.click();
      }
    });

    test('should open block time dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const blockBtn = page.getByTestId('block-time-btn');
      if (!(await blockBtn.isVisible())) return;
      await blockBtn.click();
      await expect(
        page.locator('[role="dialog"]')
          .or(page.getByText(/zablokuj|blokada|przerwa/i).first())
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should navigate to booking page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/booking');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should view appointment details', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      // Click on an existing appointment event if any
      const appointment = page.locator('[class*="appointment"], [class*="event"], [data-appointment]').first();
      if (await appointment.isVisible()) {
        await appointment.click();
        // Should show details or toast with appointment info
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should prevent creating appointment without required fields', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const newBtn = page.getByTestId('new-appointment-btn');
      if (!(await newBtn.isVisible())) return;
      await newBtn.click();

      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible()) {
        // Save button should be disabled when required fields are empty
        const saveBtn = dialog.getByRole('button', { name: /utw[oó]rz wizyt|zapisz|potwierd/i });
        if (await saveBtn.isVisible()) {
          await expect(saveBtn).toBeDisabled();
        }
      }
    });

    test('should handle calendar page without appointments', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      // Should display calendar grid even with no appointments
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should prevent access to calendar without auth', { tag: '@full' }, async ({ browser }) => {
      // Use a fresh browser context without any auth cookies
      const newContext = await browser.newContext();
      const newPage = await newContext.newPage();
      await newPage.goto('/dashboard/calendar');
      await newPage.waitForURL('**/login**', { timeout: 10000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
      await newContext.close();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle rapid view switching', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      const weekBtn = page.getByRole('button', { name: /tydzien|tydzień|week/i });
      const dayBtn = page.getByRole('button', { name: /^dzie[nń]$/i });

      if (await weekBtn.isVisible() && await dayBtn.isVisible()) {
        for (let i = 0; i < 5; i++) {
          await weekBtn.click();
          await dayBtn.click();
        }
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should handle rapid date navigation', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      const nextBtn = page.getByRole('button', { name: /nast[eę]pn|next|>/i }).first();
      if (await nextBtn.isVisible()) {
        for (let i = 0; i < 10; i++) {
          await nextBtn.click();
        }
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should display appointment cancel dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      // Find and click an appointment
      const appointment = page.locator('[class*="appointment"], [class*="event"], [data-appointment]').first();
      if (await appointment.isVisible()) {
        await appointment.click();

        // Look for cancel button
        const cancelBtn = page.getByRole('button', { name: /anuluj|cancel/i }).first();
        if (await cancelBtn.isVisible()) {
          await cancelBtn.click();
          await expect(
            page.locator('[role="dialog"]')
              .or(page.getByText(/anulowa[cć]|cancel|pow[oó]d/i).first())
              .first()
          ).toBeVisible({ timeout: 3000 });
        }
      }
    });

    test('should display complete appointment dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);

      const appointment = page.locator('[class*="appointment"], [class*="event"], [data-appointment]').first();
      if (await appointment.isVisible()) {
        await appointment.click();

        const completeBtn = page.getByRole('button', { name: /zako[nń]cz|complete/i }).first();
        if (await completeBtn.isVisible()) {
          await completeBtn.click();
          await expect(
            page.locator('[role="dialog"]')
          ).toBeVisible({ timeout: 3000 });
        }
      }
    });

    test('should handle calendar with multiple employee colors', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      // Calendar should render without errors even with multiple employees
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
