import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const isRemote = !baseURL.includes('localhost');

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: isCI ? 1 : 2,
  workers: isCI ? 1 : 2,
  globalSetup: './tests/global-setup.ts',
  reporter: [['html'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: isCI ? 'off' : 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    // Auth tests run WITHOUT storageState (they test the login form itself)
    {
      name: 'auth',
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Dashboard tests use owner session
    {
      name: 'dashboard',
      testMatch: /dashboard\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/owner.json',
      },
    },
    // AI tools use owner session
    {
      name: 'ai-tools',
      testMatch: /ai-tools\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/owner.json',
      },
    },
    // AI features smoke tests use owner session
    {
      name: 'ai-features',
      testMatch: /ai-features\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/owner.json',
      },
    },
    // Client portal — mixed auth (some tests need login, some don't)
    {
      name: 'client-portal',
      testMatch: /client-portal\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Regression, production, performance — no auth needed
    {
      name: 'other',
      testMatch: /(regression|production|performance)\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Skip webServer when testing against a remote deployment
  ...(isRemote
    ? {}
    : {
        webServer: {
          command: isCI ? 'pnpm start' : 'pnpm dev',
          url: 'http://localhost:3000',
          reuseExistingServer: !isCI,
          timeout: isCI ? 60000 : 120000,
        },
      }),
});
