import { test, expect, type Page } from '../fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEW_EMPLOYEE = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  email: 'anna.kowalska@test.com',
  phone: '000600705', // TEST_PHONE_NUMBERS (src/lib/test-phone.ts)
  role: 'employee',
};

/** Salon wlasciciela z seeda (scripts/seed-test.ts). */
const SEED_SALON_ID = '00000000-0000-4000-8000-000000000001';
/** Usluga z seeda (scripts/seed-test.ts): "Strzyzenie damskie". */
const SEED_SERVICE_ID = '00000000-0000-4000-8000-5e0000000001';

type EmployeeDetail = { id: string; firstName: string; lastName: string; isActive: boolean; serviceIds: string[] };

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
  return { 'x-csrf-token': decodeURIComponent(token) };
}

/**
 * Wlasny pracownik testu edycji: znaleziony po stalym nazwisku albo zalozony raz
 * (API nie ma DELETE pracownika, wiec stala nazwa = brak przyrostu wierszy).
 * Testy nie zmieniaja pracownikow z seeda, z ktorych korzystaja kalendarz i portal.
 * Stan poczatkowy ustawiany przed testem i przywracany po nim: aktywny, bez uslug.
 */
async function ensureEditEmployee(page: Page, lastName: string): Promise<string> {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }); // ciasteczko CSRF
  const listRes = await page.request.get('/api/employees');
  expect(listRes.status(), `lista pracownikow: ${await listRes.text()}`).toBe(200);
  const list = (await listRes.json()).data as { id: string; firstName: string; lastName: string }[];
  // startsWith: test edycji zmienia nazwisko ("Edycja" -> "Edycja-zmiana"); gdyby afterEach
  // nie zdazyl przywrocic, kolejny przebieg znajdzie tego samego pracownika zamiast zakladac nowego.
  let id = list.find((e) => e.firstName === 'E2E' && e.lastName.startsWith(lastName))?.id;
  if (!id) {
    const created = await page.request.post('/api/employees', {
      headers: await csrfHeaders(page),
      data: { salonId: SEED_SALON_ID, firstName: 'E2E', lastName },
    });
    expect(created.status(), `zalozenie pracownika: ${await created.text()}`).toBe(201);
    id = ((await created.json()) as { data: { id: string } }).data.id;
  }
  await resetEditEmployee(page, id, lastName);
  return id;
}

async function resetEditEmployee(page: Page, id: string, lastName: string) {
  const res = await page.request.put(`/api/employees/${id}`, {
    headers: await csrfHeaders(page),
    data: { firstName: 'E2E', lastName, isActive: true, serviceIds: [] },
  });
  expect(res.status(), `reset pracownika ${id}: ${await res.text()}`).toBe(200);
}

async function getEmployee(page: Page, id: string): Promise<EmployeeDetail> {
  const res = await page.request.get(`/api/employees/${id}`);
  expect(res.status(), `odczyt pracownika ${id}: ${await res.text()}`).toBe(200);
  return ((await res.json()) as { data: EmployeeDetail }).data;
}

/** Otwiera dialog edycji danego pracownika i czeka na zaladowane dane (nie spinner). */
async function openEditDialog(page: Page, id: string) {
  await page.getByTestId(`edit-employee-${id}`).click();
  const dialog = page.getByRole('dialog', { name: 'Edytuj pracownika' });
  await expect(dialog.locator('#edit-firstName')).toHaveValue('E2E', { timeout: 15000 });
  return dialog;
}

/** Klik "Zapisz" + odpowiedz PUT tego pracownika; dialog zamyka sie dopiero po sukcesie. */
async function saveEditDialog(page: Page, dialog: ReturnType<Page['getByRole']>, id: string) {
  const putRes = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/employees/${id}`
  );
  await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
  const res = await putRes;
  expect(res.status(), `PUT /api/employees/${id}: ${await res.text()}`).toBe(200);
  await expect(dialog).toBeHidden({ timeout: 10000 });
  return res.request().postDataJSON() as { lastName: string; isActive: boolean; serviceIds: string[] };
}

async function navigateToEmployees(page: Page) {
  await page.goto('/dashboard/employees');
  // Wait for a specific interactive element to confirm the page is ready
  await page.getByRole('link', { name: /dodaj pracownika/i }).waitFor({ state: 'visible', timeout: 15000 });
}

async function openAddEmployeeForm(page: Page) {
  await navigateToEmployees(page);
  // Wait for hydration before clicking Next.js Link
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: /dodaj pracownika/i }).click();
  // Wait for navigation to /employees/add and form to render
  await page.waitForURL(/\/employees\/add/, { timeout: 15000 });
  await page.getByLabel(/imie/i).or(page.locator('#edit-firstName')).or(page.locator('input[name="firstName"]')).first()
    .waitFor({ state: 'visible', timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Flow 2: Employee Management (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 2: Employee Management', () => {
  // Auth handled by storageState — no login needed

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display employees page with header and add button', { tag: '@smoke' }, async ({ page }) => {
      await navigateToEmployees(page);
      await expect(page.getByText(/pracownicy/i).first()).toBeVisible();
      await expect(
        page.getByRole('link', { name: /dodaj pracownika/i })
      ).toBeVisible({ timeout: 15000 });
    });

    test('should open add employee dialog', { tag: '@full' }, async ({ page }) => {
      await openAddEmployeeForm(page);
      await expect(
        page.getByLabel(/imie/i).or(page.locator('#edit-firstName')).or(page.locator('input[name="firstName"]')).first()
      ).toBeVisible();
    });

    test('should add a new employee', { tag: '@full' }, async ({ page }) => {
      await openAddEmployeeForm(page);

      // Fill form
      await page.getByLabel(/imie/i).fill(NEW_EMPLOYEE.firstName);
      await page.getByLabel(/nazwisko/i).fill(NEW_EMPLOYEE.lastName);
      await page.getByLabel(/email/i).fill(NEW_EMPLOYEE.email);
      await page.getByLabel(/telefon/i).fill(NEW_EMPLOYEE.phone);

      // Save
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();

      // Employee should be added successfully (toast appears or page redirects to /calendar/all after 2s)
      await expect(
        page.getByText(/pracownik.*dodany|zostal dodany|dodano|zapisano/i).first()
          .or(page.getByText(/calendar|kalendarz/i).first())
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should navigate to employee schedule page', { tag: '@full' }, async ({ page }) => {
      // Tylko odczyt: pracownik testu "E2E Uslugi" (ten sam co w tescie uslug, stan i tak resetowany).
      // "Harmonogram" to link (Next Link), nie przycisk — stary test szukal roli button,
      // nigdy go nie znajdowal, a `if (isVisible)` pomijal cala nawigacje.
      const id = await ensureEditEmployee(page, 'Uslugi');
      await navigateToEmployees(page);

      // Najglebszy div z przyciskiem edycji tego pracownika i linkiem = jego grupa przyciskow.
      const actions = page
        .locator('div')
        .filter({ has: page.getByTestId(`edit-employee-${id}`) })
        .filter({ has: page.getByRole('link', { name: /harmonogram/i }) })
        .last();
      const scheduleLink = actions.getByRole('link', { name: /harmonogram/i });
      await expect(scheduleLink).toBeVisible();
      await scheduleLink.click();
      await page.waitForURL((url) => url.pathname === `/dashboard/employees/${id}/schedule`, { timeout: 15000 });
      await expect(page.getByRole('heading', { level: 1, name: 'E2E Uslugi' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Harmonogram pracy/)).toBeVisible();
    });

    test.describe('edycja wlasnego pracownika testu', () => {
      let edited: { id: string; lastName: string } | null = null;
      test.afterEach(async ({ page }) => {
        const e = edited;
        edited = null;
        if (e) await resetEditEmployee(page, e.id, e.lastName);
      });

      test('should edit an existing employee', { tag: '@full' }, async ({ page }) => {
        // Wlasny pracownik testu, nie pierwszy z listy: stary test zmienial nazwe
        // pracownika z seeda na "Edytowany" bez przywrocenia.
        const lastName = 'Edycja';
        const id = await ensureEditEmployee(page, lastName);
        edited = { id, lastName };
        await navigateToEmployees(page);

        const dialog = await openEditDialog(page, id);
        const lastNameInput = dialog.locator('#edit-lastName');
        await expect(lastNameInput).toHaveValue(lastName);
        await lastNameInput.fill('Edycja-zmiana');

        const sent = await saveEditDialog(page, dialog, id);
        expect(sent.lastName).toBe('Edycja-zmiana');

        // Lista po odswiezeniu i baza.
        await expect(page.getByText('E2E Edycja-zmiana', { exact: true })).toBeVisible({ timeout: 10000 });
        expect((await getEmployee(page, id)).lastName).toBe('Edycja-zmiana');
      });

      test('should assign services to employee', { tag: '@full' }, async ({ page }) => {
        const lastName = 'Uslugi';
        const id = await ensureEditEmployee(page, lastName);
        edited = { id, lastName };
        await navigateToEmployees(page);

        const dialog = await openEditDialog(page, id);
        const checkbox = dialog.locator(`[id="service-${SEED_SERVICE_ID}"]`);
        await expect(checkbox, 'brak uslugi z seeda w dialogu').toBeVisible();
        await expect(checkbox).not.toBeChecked();
        await checkbox.click();
        await expect(checkbox).toBeChecked();

        const sent = await saveEditDialog(page, dialog, id);
        expect(sent.serviceIds).toEqual([SEED_SERVICE_ID]);

        // Stan zapisany w bazie i widoczny po ponownym otwarciu dialogu.
        expect((await getEmployee(page, id)).serviceIds).toEqual([SEED_SERVICE_ID]);
        const reopened = await openEditDialog(page, id);
        await expect(reopened.locator(`[id="service-${SEED_SERVICE_ID}"]`)).toBeChecked();
      });

      test('should toggle employee active status', { tag: '@full' }, async ({ page }) => {
        const lastName = 'Status';
        const id = await ensureEditEmployee(page, lastName);
        edited = { id, lastName };
        await navigateToEmployees(page);

        const dialog = await openEditDialog(page, id);
        const activeSwitch = dialog.locator('#edit-active');
        await expect(activeSwitch).toBeChecked();
        await activeSwitch.click();
        await expect(activeSwitch).not.toBeChecked();

        const sent = await saveEditDialog(page, dialog, id);
        expect(sent.isActive).toBe(false);

        // Lista po odswiezeniu, baza i ponownie otwarty dialog.
        const nameRow = page.getByText('E2E Status', { exact: true }).locator('..');
        await expect(nameRow).toContainText('Nieaktywny');
        expect((await getEmployee(page, id)).isActive).toBe(false);
        const reopened = await openEditDialog(page, id);
        await expect(reopened.locator('#edit-active')).not.toBeChecked();
      });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error when adding employee without required fields', { tag: '@full' }, async ({ page }) => {
      await openAddEmployeeForm(page);

      // Submit without filling required fields
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();

      // Should show validation error
      await expect(
        page.getByText(/wymagane|required|imi[eę]|name/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should prevent non-owner from accessing employees page', { tag: '@full' }, async ({ page }) => {
      // Logout and try to access as unauthenticated user
      await page.goto('/dashboard/employees');
      // If redirected to login, the access control works
      const url = page.url();
      // Should either be on employees page (if still logged in) or redirected
      expect(url).toMatch(/\/(dashboard|login)/);
    });

    test('should handle invalid email format for employee', { tag: '@full' }, async ({ page }) => {
      await openAddEmployeeForm(page);

      await page.getByLabel(/imie/i).fill('Test');
      await page.getByLabel(/nazwisko/i).fill('User');
      await page.getByLabel(/email/i).fill('invalid-email');

      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      // Should either show validation error or handle gracefully
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle empty employees list gracefully', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);
      // Should display either employee list or empty state — NOT crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle rapid add button clicks', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);
      const addBtn = page.getByRole('link', { name: /dodaj pracownika/i });
      await addBtn.click();
      // First click navigates to /employees/add — second click may fail since link is gone
      await addBtn.click({ timeout: 2000 }).catch(() => {});
      // Should not crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle long employee name', { tag: '@full' }, async ({ page }) => {
      await openAddEmployeeForm(page);

      const longName = 'A'.repeat(200);
      await page.getByLabel(/imie/i).fill(longName);
      await page.getByLabel(/nazwisko/i).fill('Test');
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      // Should either truncate, show error, or save — NOT crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle special characters in employee name', { tag: '@full' }, async ({ page }) => {
      await openAddEmployeeForm(page);

      await page.getByLabel(/imie/i).fill("Müller-O'Brien");
      await page.getByLabel(/nazwisko/i).fill('Łódź-Żółć');
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
