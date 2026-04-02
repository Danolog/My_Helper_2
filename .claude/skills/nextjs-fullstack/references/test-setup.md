# Test Setup — Pełna konfiguracja

## playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Global setup przez API — nie przez UI
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI: 2 workers (GitHub Actions runner ma 2 CPU)
  // Lokalnie: 50% dostępnych CPU
  workers: process.env.CI ? 2 : '50%',
  reporter: process.env.CI ? 'github' : 'html',
  
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    // Domyślny storageState dla testów wymagających auth
    storageState: 'tests/.auth/owner.json',
  },

  projects: [
    // Projekt bez auth — dla testów logowania i unauthenticated
    {
      name: 'auth',
      use: {
        ...devices['Desktop Chrome'],
        storageState: undefined, // brak sesji
      },
      testMatch: '**/auth/**/*.spec.ts',
    },
    // Projekt z auth — dla testów dashboardu
    {
      name: 'dashboard',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/owner.json',
      },
      testMatch: '**/dashboard/**/*.spec.ts',
    },
    // Projekt dla testów produkcyjnych
    {
      name: 'production',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PRODUCTION_URL,
        storageState: undefined,
      },
      testMatch: '**/production/**/*.spec.ts',
    },
  ],

  webServer: {
    command: 'pnpm start', // production build w CI
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
```

---

## tests/global-setup.ts — logowanie przez API

```typescript
import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const OWNER_CREDENTIALS = {
  email: process.env.TEST_OWNER_EMAIL || 'owner@test.com',
  password: process.env.TEST_OWNER_PASSWORD || 'TestPassword123!',
};

async function loginViaAPI(
  context: any,
  credentials: { email: string; password: string },
  maxAttempts = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // ✅ API call zamiast UI — deterministyczne, zero race conditions
      const response = await context.request.post('/api/auth/sign-in/email', {
        data: credentials,
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok()) {
        console.log(`✅ Login succeeded on attempt ${attempt}`);
        return;
      }

      const body = await response.text();
      throw new Error(`Login failed: ${response.status()} — ${body}`);
    } catch (error) {
      console.log(`Attempt ${attempt} failed: ${error}`);
      if (attempt === maxAttempts) throw error;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

export default async function globalSetup(config: FullConfig) {
  // Utwórz katalog na sesje
  const authDir = path.join(process.cwd(), 'tests/.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: config.projects[0].use.baseURL as string,
  });

  await loginViaAPI(context, OWNER_CREDENTIALS);

  // Zapisz sesję do pliku — testy będą ją reużywać
  await context.storageState({ path: 'tests/.auth/owner.json' });
  console.log('✅ Owner session saved');

  await browser.close();
}
```

---

## scripts/seed-test.ts — idempotentny seed

```typescript
import { db } from '../src/lib/db';
import { users, verifications } from '../src/lib/schema';
import bcrypt from 'bcryptjs';

const TEST_USERS = [
  {
    email: 'owner@test.com',
    password: 'TestPassword123!',
    role: 'owner' as const,
    name: 'Test Owner',
  },
  {
    email: 'client@test.com', 
    password: 'TestPassword123!',
    role: 'client' as const,
    name: 'Test Client',
  },
];

async function seed() {
  console.log('🌱 Seeding test database...');

  for (const user of TEST_USERS) {
    const hashedPassword = await bcrypt.hash(user.password, 10);

    // ✅ Idempotentny — bezpieczne wielokrotne uruchomienie
    await db.insert(users).values({
      id: `test-${user.role}`,
      email: user.email,
      name: user.name,
      role: user.role,
      password: hashedPassword,
      emailVerified: true, // pole w tabeli user
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: users.email,
      set: {
        emailVerified: true,
        password: hashedPassword,
        updatedAt: new Date(),
      },
    });

    // ⚠️ KRYTYCZNE: Better Auth sprawdza tabelę verification
    // samo emailVerified: true w tabeli user NIE wystarczy
    await db.insert(verifications).values({
      identifier: user.email,
      value: 'verified',
      expiresAt: new Date('2099-12-31'),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    console.log(`✅ Seeded: ${user.email} (${user.role})`);
  }

  console.log('✅ Seed complete');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
```

Dodaj do `package.json`:
```json
{
  "scripts": {
    "db:seed:test": "tsx scripts/seed-test.ts"
  }
}
```

---

## Wzorzec helper logowania w testach auth

```typescript
// Dla testów które MUSZĄ testować UI logowania (auth.spec.ts)
async function fillLoginForm(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'load' });
  
  // ✅ Czekaj na hydration — button musi istnieć i nie być disabled
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn !== null && !btn.hasAttribute('disabled');
  }, { timeout: 15000 });

  await page.fill('#email', email);
  await page.fill('#password', password);
  
  // ✅ Kliknij przycisk — nie używaj keyboard.press('Enter')
  // Enter jest zawodny gdy React nie jest w pełni hydrated
  await page.locator('button[type="submit"]').click();
}

// Dla testów dashboardu — NIE loguj się przez UI
// Użyj storageState ustawionego w playwright.config.ts
// Sesja jest automatycznie aplikowana przez Playwright
```

---

## Tagowanie testów — wzorzec

```typescript
import { test, expect } from '@playwright/test';

// @smoke — krytyczny flow, uruchamiany na każdym PR
test('użytkownik może się zalogować', { tag: '@smoke' }, async ({ page }) => {
  // ...
});

// @full — szczegółowe scenariusze, uruchamiane na main
test('walidacja błędnego formatu email', { tag: '@full' }, async ({ page }) => {
  // ...
});

// @production — tylko read-only, uruchamiane po deploy
test('strona główna ładuje się', { tag: '@production' }, async ({ page }) => {
  // Używaj process.env.PRODUCTION_URL
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
  // NIE loguj się, NIE twórz danych, NIE modyfikuj niczego
});
```
