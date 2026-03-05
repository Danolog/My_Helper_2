import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const isRemote = !baseURL.includes('localhost');

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: isCI ? 1 : 2,
  workers: isCI ? 1 : 2,
  reporter: [['html'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    video: isCI ? 'off' : 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
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
