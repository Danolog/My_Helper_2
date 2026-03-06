import { chromium, type FullConfig } from '@playwright/test';

/**
 * Global setup — logs in as owner once, saves session cookies
 * to storageState so individual tests skip the login form entirely.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000';
  const browser = await chromium.launch();

  // Retry login up to 3 times to handle CI cold-start / hydration delays
  for (let attempt = 1; attempt <= 3; attempt++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector('#email', { state: 'visible', timeout: 15000 });

      await page.fill('#email', 'owner@test.com');
      await page.fill('#password', 'TestPassword123!');

      // Click login and wait for API response + redirect
      await Promise.all([
        page.waitForResponse(
          resp => resp.url().includes('/api/auth/') && resp.status() < 400,
          { timeout: 15000 }
        ).catch(() => {}),
        page.getByRole('button', { name: /^zaloguj sie$/i }).click(),
      ]);

      await page.waitForURL('**/dashboard/**', { timeout: 30000 });
      await context.storageState({ path: 'tests/.auth/owner.json' });
      await context.close();
      console.log(`[global-setup] Owner login succeeded (attempt ${attempt})`);
      break;
    } catch (error) {
      await context.close();
      if (attempt === 3) {
        console.error(`[global-setup] Owner login failed after 3 attempts`);
        throw error;
      }
      console.warn(`[global-setup] Owner login attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  await browser.close();
}

export default globalSetup;
