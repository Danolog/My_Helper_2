import { test, expect, type Page } from '../fixtures';

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

const SEED_CLIENT_ID = '00000000-0000-4000-8000-c10000000001'; // Maria Kaczmarek
const SEED_SERVICE_ID = '00000000-0000-4000-8000-5e0000000001'; // Strzyzenie damskie, 60 min
const SCHEDULED_EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003'; // Ewa Zadatkowa, grafik 08:00-20:00
const APPOINTMENT_TIME = '19:00';

function tomorrowInWarsaw(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // YYYY-MM-DD
}

/**
 * Radix Select: otwiera trigger po data-testid i wybiera opcje po nazwie.
 * Portal z opcjami bywa poza viewportem CI (klik nie dochodzi) — fokus + Enter.
 */
async function selectOption(page: Page, triggerTestId: string, name: RegExp) {
  await page.getByTestId(triggerTestId).click();
  const option = page.getByRole('option', { name });
  await expect(option, `opcja ${name} w ${triggerTestId} (dane z seeda)`).toHaveCount(1, { timeout: 10000 });
  await option.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
}

// ---------------------------------------------------------------------------
// Flow 4: Appointment System (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 4: Appointment System', () => {
  // Auth handled by storageState — no login needed
  test.use({ timezoneId: 'Europe/Warsaw' });

  // Sprzatanie: wizyty utworzone w tescie sa anulowane (DELETE = status
  // "cancelled"; termin wraca do puli, kolizje pomijaja anulowane).
  let createdAppointmentIds: string[] = [];
  test.afterEach(async ({ page }) => {
    const ids = createdAppointmentIds;
    createdAppointmentIds = [];
    if (ids.length === 0) return;
    const token = (await page.context().cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
    for (const id of ids) {
      const res = await page.request.delete(`/api/appointments/${id}`, { headers: { 'x-csrf-token': decodeURIComponent(token) } });
      expect(res.status(), `sprzatanie: anulowanie wizyty ${id}: ${await res.text()}`).toBe(200);
    }
  });

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
      // Realny zapis z dialogu (#105 cz. 1). Poprzednia wersja byla w warunkach
      // `if (await x.isVisible())`, ktore nie czekaja: gdy dialog jeszcze sie nie
      // otworzyl, test konczyl sie zielono bez zadnej akcji, a gdy zdazyl —
      // klikal zawsze zablokowany przycisk (nie ustawial pracownika ani godziny).
      //
      // Dane z seeda: klientka Maria Kaczmarek, usluga "Strzyzenie damskie"
      // (60 min, bez zadatku), Ewa Zadatkowa (grafik 7 dni 08:00-20:00).
      // Jutro 19:00-20:00 — w grafiku i poza pierwszym wolnym terminem, ktory
      // bierze spec zadatku (tests/client-portal/) dla tej samej pracowniczki.
      await navigateToCalendar(page);
      await page.getByTestId('new-appointment-btn').click();

      const dialog = page.getByTestId('new-appointment-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await selectOption(page, 'client-select', /^Maria Kaczmarek/);
      await selectOption(page, 'service-select', /^Strzyzenie damskie - /);
      await selectOption(page, 'employee-select', /Ewa Zadatkowa/);

      const date = tomorrowInWarsaw();
      await dialog.getByTestId('appointment-date-input').fill(date);
      await dialog.getByTestId('appointment-time-input').fill(APPOINTMENT_TIME);

      const saveBtn = dialog.getByTestId('save-appointment-btn');
      await expect(saveBtn).toBeEnabled({ timeout: 10000 });

      const responsePromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/appointments',
        { timeout: 15000 }
      );
      await saveBtn.click();
      const res = await responsePromise;
      const body = await res.text();
      const json = JSON.parse(body) as { data?: { id?: string } };
      if (json.data?.id) createdAppointmentIds.push(json.data.id);
      expect(res.status(), `POST /api/appointments: ${body}`).toBe(201);
      const appointmentId = json.data!.id!;

      await expect(dialog).toBeHidden({ timeout: 10000 });

      // Zapis w bazie z danymi z formularza
      const expectedStart = await page.evaluate((local) => new Date(local).toISOString(), `${date}T${APPOINTMENT_TIME}:00`);
      const getRes = await page.request.get(`/api/appointments/${appointmentId}`);
      expect(getRes.status()).toBe(200);
      const saved = (await getRes.json()).data as {
        clientId: string; serviceId: string; employeeId: string; startTime: string; endTime: string; status: string;
      };
      expect(saved).toMatchObject({
        clientId: SEED_CLIENT_ID,
        serviceId: SEED_SERVICE_ID,
        employeeId: SCHEDULED_EMPLOYEE_ID,
        status: 'scheduled',
      });
      expect(new Date(saved.startTime).toISOString()).toBe(expectedStart);
      expect(new Date(saved.endTime).getTime() - new Date(saved.startTime).getTime()).toBe(60 * 60000);
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
      // Should either redirect to login or show auth-gated content
      await newPage.waitForLoadState('domcontentloaded');
      const url = newPage.url();
      if (!url.includes('/login')) {
        // Client-side auth check — page should not show calendar data
        await expect(newPage.locator('body')).not.toContainText(/Internal Server Error/i);
      } else {
        await expect(newPage).toHaveURL(/\/login/);
      }
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
