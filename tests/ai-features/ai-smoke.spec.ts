import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// AI Features — Smoke Tests (@smoke)
//
// Verify that AI-related pages load without crashing. No actual AI API calls
// are made — these tests only confirm that the page renders a meaningful
// element within a generous timeout.
// ---------------------------------------------------------------------------

test.describe('AI Features Smoke Tests', () => {
  // Auth handled by storageState — no login needed

  // ── AI Usage / Cost monitoring ──────────────────────────────────────────

  test('should load AI usage dashboard', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/ai-usage');
    await page.waitForLoadState('domcontentloaded');

    // Page title is "Koszty AI" or shows the Pro gate with the same feature name
    await expect(
      page.getByText(/koszty ai|zu[zż]ycie ai|ai usage/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  // ── Clients page (AI Insights tab lives on individual client pages) ────

  test('should load clients page', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/clients');
    await page.waitForLoadState('domcontentloaded');

    // Just verify the page renders without errors
    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    await expect(
      page.getByText(/klient|client/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  // ── Content Generator pages ─────────────────────────────────────────────

  test('should load content generator hub', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/content-generator');
    await page.waitForLoadState('domcontentloaded');

    // UI: "Generator tresci" (no diacritics)
    await expect(
      page.getByText(/generator tre[sś]ci|content generator/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should load social posts page', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/content-generator/social-posts');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    await expect(
      page.getByText(/post|social|media|instagram|facebook/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('should load testimonials page', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/content-generator/testimonials');
    await page.waitForLoadState('domcontentloaded');

    // UI: "Szablony testimoniali wideo" or Pro gate
    await expect(
      page.getByText(/testimonial|wideo|pro/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  // ── Gallery (may include AI enhance button) ─────────────────────────────

  test('should load gallery page', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/gallery');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    await expect(
      page.getByText(/galeri|gallery|zdj[eę]ci|album/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  // ── Promotions (may include AI banner generator) ────────────────────────

  test('should load promotions page', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard/promotions');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    await expect(
      page.getByText(/promocj|rabat|discount|promotion/i).first()
    ).toBeVisible({ timeout: 10000 });
  });

  // ── Command palette (Cmd+K) ────────────────────────────────────────────

  test('should open command palette with Cmd+K', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    // Wait for hydration before triggering keyboard shortcut
    await page.waitForLoadState('load');

    await page.keyboard.press('Meta+k');

    // Palette input placeholder: "Szukaj stron, raportow, ustawien..."
    await expect(
      page.getByPlaceholder(/szukaj/i)
    ).toBeVisible({ timeout: 5000 });
  });
});
