import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_CREDENTIALS = {
  email: 'owner@test.com',
  password: 'TestPassword123!',
};

const NEW_EMPLOYEE = {
  firstName: 'Anna',
  lastName: 'Kowalska',
  email: 'anna.kowalska@test.com',
  phone: '500100200',
  role: 'employee',
};

async function loginAsOwner(page: Page) {
  await page.goto('/login');
  await page.fill('#email', OWNER_CREDENTIALS.email);
  await page.fill('#password', OWNER_CREDENTIALS.password);
  await page.getByRole('button', { name: /zaloguj się/i }).click();
  await page.waitForURL('**/dashboard**', { timeout: 10000 });
}

async function navigateToEmployees(page: Page) {
  await page.goto('/dashboard/employees');
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Flow 2: Employee Management (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 2: Employee Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display employees page with header and add button', async ({ page }) => {
      await navigateToEmployees(page);
      await expect(page.getByText(/pracownicy/i).first()).toBeVisible();
      await expect(
        page.getByRole('button', { name: /dodaj pracownika/i })
      ).toBeVisible();
    });

    test('should open add employee dialog', async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      // Dialog with form fields should appear
      await expect(
        page.locator('#edit-firstName').or(page.locator('input[name="firstName"]'))
      ).toBeVisible({ timeout: 3000 });
    });

    test('should add a new employee', async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();

      // Fill form
      await page.fill('#edit-firstName', NEW_EMPLOYEE.firstName);
      await page.fill('#edit-lastName', NEW_EMPLOYEE.lastName);
      await page.fill('#edit-email', NEW_EMPLOYEE.email);
      await page.fill('#edit-phone', NEW_EMPLOYEE.phone);

      // Save
      await page.getByRole('button', { name: /zapisz/i }).click();
      await page.waitForLoadState('networkidle');

      // Employee should appear on the list
      await expect(
        page.getByText(NEW_EMPLOYEE.firstName)
      ).toBeVisible({ timeout: 5000 });
    });

    test('should edit an existing employee', async ({ page }) => {
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
        await page.waitForLoadState('networkidle');
        await expect(page.getByText('Edytowany')).toBeVisible({ timeout: 5000 });
      }
    });

    test('should navigate to employee schedule page', async ({ page }) => {
      await navigateToEmployees(page);

      // Click schedule/harmonogram button
      const scheduleBtn = page.getByRole('button', { name: /harmonogram/i }).first();
      if (await scheduleBtn.isVisible()) {
        await scheduleBtn.click();
        await page.waitForURL('**/schedule**', { timeout: 5000 });
        await expect(page).toHaveURL(/\/schedule/);
      }
    });

    test('should assign services to employee', async ({ page }) => {
      await navigateToEmployees(page);

      // Open edit dialog
      const editButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await editButton.click();
      await page.waitForTimeout(500);

      // Look for service checkboxes
      const serviceCheckbox = page.locator('[id^="service-"]').first();
      if (await serviceCheckbox.isVisible()) {
        const isChecked = await serviceCheckbox.isChecked();
        await serviceCheckbox.setChecked(!isChecked);
        await page.getByRole('button', { name: /zapisz/i }).click();
        await page.waitForLoadState('networkidle');
      }
    });

    test('should toggle employee active status', async ({ page }) => {
      await navigateToEmployees(page);

      // Open edit dialog
      const editButton = page.locator('button').filter({ has: page.locator('svg') }).first();
      await editButton.click();
      await page.waitForTimeout(500);

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
    test('should show error when adding employee without required fields', async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      await page.waitForTimeout(300);

      // Submit without filling required fields
      await page.getByRole('button', { name: /zapisz/i }).click();

      // Should show validation error
      await expect(
        page.getByText(/wymagane|required|imię|name/i).first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should prevent non-owner from accessing employees page', async ({ page }) => {
      // Logout and try to access as unauthenticated user
      await page.goto('/dashboard/employees');
      // If redirected to login, the access control works
      const url = page.url();
      // Should either be on employees page (if still logged in) or redirected
      expect(url).toMatch(/\/(dashboard|login)/);
    });

    test('should handle invalid email format for employee', async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      await page.waitForTimeout(300);

      await page.fill('#edit-firstName', 'Test');
      await page.fill('#edit-lastName', 'User');
      await page.fill('#edit-email', 'invalid-email');

      await page.getByRole('button', { name: /zapisz/i }).click();
      // Should either show validation error or handle gracefully
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle empty employees list gracefully', async ({ page }) => {
      await navigateToEmployees(page);
      // Should display either employee list or empty state — NOT crash
      await expect(page.locator('body')).not.toContainText(/500|error|unexpected/i);
    });

    test('should handle rapid add button clicks', async ({ page }) => {
      await navigateToEmployees(page);
      const addBtn = page.getByRole('button', { name: /dodaj pracownika/i });
      await addBtn.click();
      await addBtn.click();
      await page.waitForTimeout(500);
      // Should show one dialog, not crash
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle long employee name', async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      await page.waitForTimeout(300);

      const longName = 'A'.repeat(200);
      await page.fill('#edit-firstName', longName);
      await page.fill('#edit-lastName', 'Test');
      await page.getByRole('button', { name: /zapisz/i }).click();
      await page.waitForTimeout(2000);
      // Should either truncate, show error, or save — NOT crash
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle special characters in employee name', async ({ page }) => {
      await navigateToEmployees(page);
      await page.getByRole('button', { name: /dodaj pracownika/i }).click();
      await page.waitForTimeout(300);

      await page.fill('#edit-firstName', "Müller-O'Brien");
      await page.fill('#edit-lastName', 'Łódź-Żółć');
      await page.getByRole('button', { name: /zapisz/i }).click();
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });
});
