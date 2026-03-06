import { chromium, type FullConfig } from '@playwright/test';

/**
 * Global setup — logs in as owner and client once, saves session cookies
 * to storageState files so individual tests skip the login form entirely.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000';
  const browser = await chromium.launch();

  // --- Owner session ---
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${baseURL}/login`);
  await ownerPage.waitForSelector('#email', { state: 'visible', timeout: 30000 });
  await ownerPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await ownerPage.fill('#email', 'owner@test.com');
  await ownerPage.fill('#password', 'TestPassword123!');
  await ownerPage.getByRole('button', { name: /^zaloguj sie$/i }).click();
  await ownerPage.waitForURL('**/dashboard/**', { timeout: 30000 });
  await ownerContext.storageState({ path: 'tests/.auth/owner.json' });
  await ownerContext.close();

  await browser.close();
}

export default globalSetup;
