import { test, expect } from '@playwright/test';

/**
 * Production health checks — read-only tests only.
 * These run against the live Vercel deployment after each deploy.
 * They NEVER create users, modify data, or send emails.
 */

test.describe('Production Health Checks', () => {
  test('should load the home page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('should load the login page with form', { tag: '@production' }, async ({ page }) => {
    await page.goto('/login');
    // Wait for client component hydration (session check shows "Ladowanie..." first)
    await expect(page.locator('#email')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /zaloguj/i })).toBeVisible();
  });

  test('should load the registration page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /basic/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: /pro/i })).toBeVisible();
  });

  test('should return 200 from health endpoint', { tag: '@production' }, async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
  });

  test('should load salon browsing page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/salons');
    await expect(page.locator('body')).toBeVisible();
    // Page should load without errors — we don't check for specific salons
  });

  test('should load forgot password page', { tag: '@production' }, async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('body')).toBeVisible();
  });
});
