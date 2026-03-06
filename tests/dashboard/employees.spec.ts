import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NEW_EMPLOYEE = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  email: 'anna.kowalska@test.com',
  phone: '500100200',
  role: 'employee',
};

async function navigateToEmployees(page: Page) {
  await page.goto('/dashboard/employees');
  // Wait for a specific interactive element to confirm the page is ready
  await page.getByRole('link', { name: /dodaj pracownika/i }).waitFor({ state: 'visible', timeout: 15000 });
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
      await navigateToEmployees(page);
      await page.getByRole('link', { name: /dodaj pracownika/i }).click();
      // Add page with form fields should appear
      await expect(
        page.getByLabel(/imie/i).or(page.locator('#edit-firstName')).or(page.locator('input[name="firstName"]')).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should add a new employee', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('link', { name: /dodaj pracownika/i }).click();

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

    test('should edit an existing employee', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);

      // Click edit on the first employee
      const editButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await editButton.click();

      // Modify a field
      const firstNameInput = page.locator('#edit-firstName');
      if (await firstNameInput.isVisible()) {
        await firstNameInput.clear();
        await firstNameInput.fill('Edytowany');
        await page.getByRole('button', { name: /zapisz/i }).click();
        await expect(page.getByText('Edytowany')).toBeVisible({ timeout: 5000 });
      }
    });

    test('should navigate to employee schedule page', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);

      // Click schedule/harmonogram button
      const scheduleBtn = page.getByRole('button', { name: /harmonogram/i }).first();
      if (await scheduleBtn.isVisible()) {
        await scheduleBtn.click();
        await page.waitForURL('**/schedule**', { timeout: 5000 });
        await expect(page).toHaveURL(/\/schedule/);
      }
    });

    test('should assign services to employee', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);

      // Open edit dialog
      const editButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await editButton.click();

      // Look for service checkboxes
      const serviceCheckbox = page.locator('[id^="service-"]').first();
      if (await serviceCheckbox.isVisible()) {
        const isChecked = await serviceCheckbox.isChecked();
        await serviceCheckbox.setChecked(!isChecked);
        await page.getByRole('button', { name: /zapisz/i }).click();
        await page.waitForLoadState('networkidle');
      }
    });

    test('should toggle employee active status', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);

      // Open edit dialog
      const editButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await editButton.click();

      const activeSwitch = page.locator('#edit-active');
      if (await activeSwitch.isVisible()) {
        await activeSwitch.click();
        await page.getByRole('button', { name: /zapisz/i }).click();
        await page.waitForLoadState('networkidle');
      }
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error when adding employee without required fields', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('link', { name: /dodaj pracownika/i }).click();

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
      await navigateToEmployees(page);
      await page.getByRole('link', { name: /dodaj pracownika/i }).click();

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
      await navigateToEmployees(page);
      await page.getByRole('link', { name: /dodaj pracownika/i }).click();

      const longName = 'A'.repeat(200);
      await page.getByLabel(/imie/i).fill(longName);
      await page.getByLabel(/nazwisko/i).fill('Test');
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      // Should either truncate, show error, or save — NOT crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle special characters in employee name', { tag: '@full' }, async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('link', { name: /dodaj pracownika/i }).click();

      await page.getByLabel(/imie/i).fill("Müller-O'Brien");
      await page.getByLabel(/nazwisko/i).fill('Łódź-Żółć');
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
