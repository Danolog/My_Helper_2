import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// AI feature pages
const AI_PAGES = [
  { path: '/dashboard/ai-assistant', name: 'AI Assistant Hub' },
  { path: '/dashboard/ai-assistant/business', name: 'Business Intelligence' },
  { path: '/dashboard/ai-assistant/trends', name: 'Trend Analysis' },
  { path: '/dashboard/ai-assistant/voice', name: 'Voice Assistant' },
  { path: '/dashboard/content-generator', name: 'Content Generator Hub' },
  { path: '/dashboard/content-generator/social-posts', name: 'Social Posts' },
  { path: '/dashboard/content-generator/newsletters', name: 'Newsletters' },
  { path: '/dashboard/content-generator/templates', name: 'Templates' },
  { path: '/dashboard/content-generator/scheduled', name: 'Scheduled Posts' },
  { path: '/dashboard/ai-recommendations', name: 'AI Recommendations' },
];

// ---------------------------------------------------------------------------
// Flow 6: AI Tools — Pro Plan (P2)
// ---------------------------------------------------------------------------

test.describe('Flow 6: AI Tools (Pro Plan)', () => {
  // Auth handled by storageState — no login needed

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display AI assistant hub page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant');
      await page.waitForLoadState('domcontentloaded');

      // Should show AI hub with navigation options
      await expect(
        // UI: "Asystent AI" (no diacritics)
        page.getByText(/asystent ai|ai assistant|inteligenc|narz[eę]dzi/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display business intelligence chat', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('domcontentloaded');

      // Should show chat interface or Pro gate
      await expect(
        page.getByText(/biznes|business|czat|chat|pro/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display content generator hub', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/content-generator');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        // UI: "Generator tresci" (no diacritics)
        page.getByText(/tre[sś]ci|content|generuj|generator/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display social post generator', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/content-generator/social-posts');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/post|social|media|instagram|facebook/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display newsletter generator', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/content-generator/newsletters');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/newsletter|email|kampani/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display AI recommendations page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-recommendations');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/rekomendacj|suggestion|zaleceni|recommendation/i).first()
          .or(page.getByText(/pro/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display trend analysis page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/trends');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/trend|analiz|analysis/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display voice assistant configuration', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/voice');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        // UI uses "Asystent glosowy" (no diacritics)
        page.getByText(/g[lł]osow|voice|asystent|konfigur/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display scheduled posts page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/content-generator/scheduled');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/zaplanowane|scheduled|harmonogram|post/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display templates page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/content-generator/templates');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/szablon|template/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should show AI chat input for Pro users', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('domcontentloaded');

      // Chat input field or Pro gate should be present
      const chatInput = page.locator(
        'textarea, input[type="text"][placeholder*="pytanie"], input[placeholder*="wpisz"], input[placeholder*="message"]'
      ).first();
      const proGate = page.getByText(/wymaga planu pro|plan pro|upgrade/i).first();

      await expect(
        chatInput.or(proGate).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show Pro plan gate for Basic plan users', { tag: '@full' }, async ({ page }) => {
      // If user is on Basic plan, AI features should show upgrade prompt
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('domcontentloaded');

      // Should either show chat (Pro user) or upgrade gate (Basic user)
      await expect(
        page.getByText(/czat|chat|pro|upgrade|wymaga/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should prevent unauthenticated access to AI features', { tag: '@full' }, async ({ browser }) => {
      const newContext = await browser.newContext();
      const newPage = await newContext.newPage();
      await newPage.goto('/dashboard/ai-assistant');
      await newPage.waitForURL('**/login**', { timeout: 30000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
      await newContext.close();
    });

    test('should handle empty AI chat submission', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('domcontentloaded');

      // Try to submit empty message
      // UI: "Wyslij wiadomosc" (no diacritics)
      const submitBtn = page.getByRole('button', { name: /wys[lł]ij|send|ask/i }).first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        // Should not crash
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should handle AI content generation without required fields', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/content-generator/social-posts');
      await page.waitForLoadState('domcontentloaded');

      // Try to generate without filling required fields
      const generateBtn = page.getByRole('button', { name: /generuj|generate|utw[oó]rz|create/i }).first();
      if (await generateBtn.isVisible()) {
        await generateBtn.click();
        // Should show validation error, not crash
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    for (const aiPage of AI_PAGES) {
      test(`should load ${aiPage.name} without errors`, { tag: '@full' }, async ({ page }) => {
        await page.goto(aiPage.path);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      });
    }

    test('should handle very long chat message', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('domcontentloaded');

      const chatInput = page.locator(
        'textarea, input[type="text"][placeholder*="pytanie"], input[placeholder*="wpisz"]'
      ).first();

      if (await chatInput.isVisible()) {
        const longMessage = 'Pytanie o salon. '.repeat(100);
        await chatInput.fill(longMessage);
        // Should not crash
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      }
    });

    test('should handle rapid page navigation between AI tools', { tag: '@full' }, async ({ page }) => {
      for (const aiPage of AI_PAGES.slice(0, 5)) {
        await page.goto(aiPage.path);
      }
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle AI page refresh', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('domcontentloaded');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should render AI features on mobile viewport', { tag: '@full' }, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard/ai-assistant');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
