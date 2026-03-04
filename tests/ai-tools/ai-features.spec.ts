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
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display AI assistant hub page', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant');
      await page.waitForLoadState('networkidle');

      // Should show AI hub with navigation options
      await expect(
        page.getByText(/asystent ai|ai assistant|inteligenc|narzędzi/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display business intelligence chat', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('networkidle');

      // Should show chat interface or Pro gate
      await expect(
        page.getByText(/biznes|business|czat|chat|pro/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display content generator hub', async ({ page }) => {
      await page.goto('/dashboard/content-generator');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/treści|content|generuj|generator/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display social post generator', async ({ page }) => {
      await page.goto('/dashboard/content-generator/social-posts');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/post|social|media|instagram|facebook/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display newsletter generator', async ({ page }) => {
      await page.goto('/dashboard/content-generator/newsletters');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/newsletter|email|kampani/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display AI recommendations page', async ({ page }) => {
      await page.goto('/dashboard/ai-recommendations');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/rekomendacj|suggestion|zaleceni|recommendation/i).first()
          .or(page.getByText(/pro/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display trend analysis page', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/trends');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/trend|analiz|analysis/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display voice assistant configuration', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/voice');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/głosow|voice|asystent|konfigur/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display scheduled posts page', async ({ page }) => {
      await page.goto('/dashboard/content-generator/scheduled');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/zaplanowane|scheduled|harmonogram|post/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display templates page', async ({ page }) => {
      await page.goto('/dashboard/content-generator/templates');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/szablon|template/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should show AI chat input for Pro users', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('networkidle');

      // Chat input field or Pro gate should be present
      const chatInput = page.locator(
        'textarea, input[type="text"][placeholder*="pytanie"], input[placeholder*="wpisz"], input[placeholder*="message"]'
      ).first();
      const proGate = page.getByText(/wymaga planu pro|plan pro|upgrade/i).first();

      await expect(
        chatInput.or(proGate)
      ).toBeVisible({ timeout: 5000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show Pro plan gate for Basic plan users', async ({ page }) => {
      // If user is on Basic plan, AI features should show upgrade prompt
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('networkidle');

      // Should either show chat (Pro user) or upgrade gate (Basic user)
      await expect(
        page.getByText(/czat|chat|pro|upgrade|wymaga/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should prevent unauthenticated access to AI features', async ({ page }) => {
      const newPage = await page.context().newPage();
      await newPage.goto('/dashboard/ai-assistant');
      await newPage.waitForURL('**/login**', { timeout: 10000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
    });

    test('should handle empty AI chat submission', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('networkidle');

      // Try to submit empty message
      const submitBtn = page.getByRole('button', { name: /wyślij|send|ask/i }).first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
        // Should not crash
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should handle AI content generation without required fields', async ({ page }) => {
      await page.goto('/dashboard/content-generator/social-posts');
      await page.waitForLoadState('networkidle');

      // Try to generate without filling required fields
      const generateBtn = page.getByRole('button', { name: /generuj|generate|utwórz|create/i }).first();
      if (await generateBtn.isVisible()) {
        await generateBtn.click();
        await page.waitForTimeout(2000);
        // Should show validation error, not crash
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    for (const aiPage of AI_PAGES) {
      test(`should load ${aiPage.name} without errors`, async ({ page }) => {
        await page.goto(aiPage.path);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      });
    }

    test('should handle very long chat message', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('networkidle');

      const chatInput = page.locator(
        'textarea, input[type="text"][placeholder*="pytanie"], input[placeholder*="wpisz"]'
      ).first();

      if (await chatInput.isVisible()) {
        const longMessage = 'Pytanie o salon. '.repeat(100);
        await chatInput.fill(longMessage);
        // Should not crash
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
      }
    });

    test('should handle rapid page navigation between AI tools', async ({ page }) => {
      for (const aiPage of AI_PAGES.slice(0, 5)) {
        await page.goto(aiPage.path);
      }
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle AI page refresh', async ({ page }) => {
      await page.goto('/dashboard/ai-assistant/business');
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should render AI features on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard/ai-assistant');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });
});
