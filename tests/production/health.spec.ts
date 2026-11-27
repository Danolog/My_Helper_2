import { test, expect } from '@playwright/test';

/**
 * Production health checks — read-only tests only.
 * These run against the live deployment after each deploy: Vercel
 * (deployment_status, until C4) or Cloud Run (deploy-cloud-run.yml →
 * e2e-production.yml with base_url). BASE_URL selects the target.
 * They NEVER create users, modify data, or send emails.
 */

test.describe('Production Health Checks', () => {
  test('should load the home page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('body')).toBeVisible();
    // Strona glowna to oferta dla wlascicieli salonow (sekcja cennika).
    await expect(page.locator('#pricing')).toBeAttached({ timeout: 10000 });
  });

  test('should load the login page with form', { tag: '@production' }, async ({ page }) => {
    await page.goto('/login');
    // Wait for client component hydration (session check shows "Ladowanie..." first)
    await expect(page.locator('#email')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj sie', exact: true })).toBeVisible();
  });

  test('should load the registration page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/register');
    // Registration opens on the account form
    await expect(page.locator('#name')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('should return 200 from health endpoint', { tag: '@production' }, async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
  });

  test('salon list is frozen: /salons redirects to home page', { tag: '@production' }, async ({ page }) => {
    // Katalog salonow zamrozony — lista przekierowuje na strone glowna
    // (oferta dla salonow). Strona pojedynczego salonu dziala dalej.
    await page.goto('/salons', { waitUntil: 'load' });
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load forgot password page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('body')).toBeVisible();
  });
});
