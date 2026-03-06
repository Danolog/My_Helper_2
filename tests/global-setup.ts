import { type FullConfig, request } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OWNER = { email: 'owner@test.com', password: 'TestPassword123!' };

/**
 * Global setup — creates an authenticated session via API call (no UI).
 * Saves cookies to storageState so dashboard/ai-tools tests skip login.
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000';

  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const apiContext = await request.newContext({ baseURL });

      const response = await apiContext.post('/api/auth/sign-in/email', {
        data: { email: OWNER.email, password: OWNER.password },
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok()) {
        const body = await response.text();
        throw new Error(`Sign-in API returned ${response.status()}: ${body}`);
      }

      // Extract set-cookie headers and build storageState
      const cookies: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Lax' | 'None' | 'Strict';
      }> = [];

      const setCookieHeaders = response.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
      for (const header of setCookieHeaders) {
        const parts = header.value.split(';').map(p => p.trim());
        const nameValue = parts[0] ?? '';
        const eqIdx = nameValue.indexOf('=');
        const name = nameValue.substring(0, eqIdx);
        const value = nameValue.substring(eqIdx + 1);

        cookies.push({
          name,
          value,
          domain: 'localhost',
          path: '/',
          httpOnly: parts.some(p => p.toLowerCase() === 'httponly'),
          secure: parts.some(p => p.toLowerCase() === 'secure'),
          sameSite: 'Lax',
        });
      }

      const storageState = {
        cookies,
        origins: [],
      };

      const statePath = path.join(authDir, 'owner.json');
      fs.writeFileSync(statePath, JSON.stringify(storageState, null, 2));

      console.log(`[global-setup] Owner session created via API (attempt ${attempt}, ${cookies.length} cookies)`);
      await apiContext.dispose();
      return;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[global-setup] Attempt ${attempt} failed: ${msg}`);
      if (attempt === 3) {
        console.error('[global-setup] Failed after 3 attempts');
        throw error;
      }
      await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
}

export default globalSetup;
