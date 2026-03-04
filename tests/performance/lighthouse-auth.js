/**
 * Lighthouse Puppeteer Auth Script
 *
 * Logs in before running Lighthouse audits on authenticated pages.
 * Pages that require auth: /dashboard, /dashboard/calendar, /dashboard/reports
 * Pages that don't: /login, / (portal)
 */

const LOGIN_URL_PATH = "/login";
const DASHBOARD_PATHS = ["/dashboard", "/dashboard/calendar", "/dashboard/reports"];

// Test credentials — use env vars or defaults
const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "testpassword123";

/**
 * @param {import('puppeteer').Browser} browser
 * @param {{ url: string }} context
 */
async function setup(browser, context) {
  const url = new URL(context.url);
  const path = url.pathname;

  // Skip auth for public pages
  const needsAuth = DASHBOARD_PATHS.some((p) => path.startsWith(p));
  if (!needsAuth) return;

  const page = await browser.newPage();

  try {
    // Navigate to login
    await page.goto(`${url.origin}${LOGIN_URL_PATH}`, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Fill login form
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', TEST_EMAIL);
    await page.type('input[type="password"]', TEST_PASSWORD);

    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);

    // Verify we're logged in
    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      console.warn("⚠️  Login may have failed — still on login page");
    }
  } catch (err) {
    console.error("Auth setup error:", err.message);
  } finally {
    await page.close();
  }
}

module.exports = setup;
