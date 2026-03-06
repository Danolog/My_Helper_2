import { chromium, type FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OWNER = { email: 'owner@test.com', password: 'TestPassword123!' };

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000';

  // Ensure .auth dir exists
  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();

  for (let attempt = 1; attempt <= 3; attempt++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForSelector('#email', { state: 'visible', timeout: 15000 });
      await page.waitForLoadState('networkidle');

      await page.fill('#email', OWNER.email);
      await page.fill('#password', OWNER.password);

      await Promise.all([
        page.waitForResponse(
          resp => resp.url().includes('/api/auth/') && resp.status() < 400,
          { timeout: 30000 },
        ),
        page.getByRole('button', { name: /^zaloguj sie$/i }).click(),
      ]);

      await page.waitForURL('**/dashboard/**', { timeout: 30000 });
      await context.storageState({ path: path.join(authDir, 'owner.json') });
      console.log(`[global-setup] Owner login succeeded (attempt ${attempt})`);
      await context.close();
      break;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[global-setup] Attempt ${attempt} failed: ${msg}`);

      // Save debug screenshot
      const ssPath = path.join(authDir, `login-fail-attempt-${attempt}.png`);
      await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});

      await context.close();
      if (attempt === 3) {
        console.error('[global-setup] Owner login failed after 3 attempts');
        throw error;
      }
      // Exponential back-off
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  await browser.close();
}

export default globalSetup;
