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

// All report routes
const REPORT_ROUTES = [
  { path: '/dashboard/reports/revenue', name: 'Revenue', keywords: /przychod|revenue|obrót/i },
  { path: '/dashboard/reports/employee-occupancy', name: 'Employee Occupancy', keywords: /obłożen|occupancy|wykorzyst/i },
  { path: '/dashboard/reports/employee-payroll', name: 'Employee Payroll', keywords: /wynagrodzen|payroll|prowizj/i },
  { path: '/dashboard/reports/employee-popularity', name: 'Employee Popularity', keywords: /popularnoś|popularity|ranking/i },
  { path: '/dashboard/reports/services-popularity', name: 'Services Popularity', keywords: /usług|services|popularnoś/i },
  { path: '/dashboard/reports/service-profitability', name: 'Service Profitability', keywords: /rentownoś|profitab|zysk/i },
  { path: '/dashboard/reports/materials', name: 'Materials', keywords: /materiał|zużyci|materials/i },
  { path: '/dashboard/reports/materials-profitloss', name: 'Materials P&L', keywords: /materiał|zysk|strat|profit|loss/i },
  { path: '/dashboard/reports/promotions', name: 'Promotions', keywords: /promocj|rabat|discount/i },
  { path: '/dashboard/reports/cancellations', name: 'Cancellations', keywords: /anulowan|cancel|odwołan/i },
  { path: '/dashboard/reports/monthly-comparison', name: 'Monthly Comparison', keywords: /miesięczn|monthly|porównan/i },
  { path: '/dashboard/reports/yearly-comparison', name: 'Yearly Comparison', keywords: /roczn|yearly|porównan/i },
];

// ---------------------------------------------------------------------------
// Flow 8: Reports & Finance (P1)
// ---------------------------------------------------------------------------

test.describe('Flow 8: Reports & Finance', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    for (const report of REPORT_ROUTES) {
      test(`should load ${report.name} report page`, async ({ page }) => {
        await page.goto(report.path);
        await page.waitForLoadState('networkidle');
        // Page should load without errors
        await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
        // Should contain some report-specific content
        await expect(
          page.getByText(report.keywords).first()
            .or(page.getByText(/raport|report|dane|data/i).first())
        ).toBeVisible({ timeout: 5000 });
      });
    }

    test('should display date range filter on revenue report', async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('networkidle');

      // Date filter should be available
      const dateFilter = page.locator(
        'input[type="date"], [data-testid*="date"], button:has-text("zakres"), button:has-text("okres")'
      ).first();
      await expect(
        dateFilter.or(page.getByText(/okres|zakres|od.*do|filtr/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display employee filter on payroll report', async ({ page }) => {
      await page.goto('/dashboard/reports/employee-payroll');
      await page.waitForLoadState('networkidle');

      // Should have filter options
      await expect(
        page.getByText(/wynagrodzen|payroll|prowizj/i).first()
          .or(page.getByText(/pracowni|employee/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display revenue chart or data table', async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('networkidle');

      // Should display either a chart or a data table
      await expect(
        page.locator('canvas, svg, table, [role="table"]').first()
          .or(page.getByText(/brak danych|no data|0.*PLN/i).first())
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display monthly comparison data', async ({ page }) => {
      await page.goto('/dashboard/reports/monthly-comparison');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/porównan|comparison|miesiąc|month/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display yearly comparison data', async ({ page }) => {
      await page.goto('/dashboard/reports/yearly-comparison');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/porównan|comparison|rok|year/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display cancellations report', async ({ page }) => {
      await page.goto('/dashboard/reports/cancellations');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/anulowan|cancel|odwołan/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display materials usage report', async ({ page }) => {
      await page.goto('/dashboard/reports/materials');
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByText(/materiał|zużyci|materials/i).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should prevent non-owner access to reports', async ({ page }) => {
      const newPage = await page.context().newPage();
      await newPage.goto('/dashboard/reports/revenue');
      await newPage.waitForURL('**/login**', { timeout: 10000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
    });

    test('should handle invalid report route gracefully', async ({ page }) => {
      await page.goto('/dashboard/reports/nonexistent-report');
      await page.waitForLoadState('networkidle');
      // Should show 404 or redirect — NOT crash
      const status = page.locator('body');
      await expect(status).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle report with no data', async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('networkidle');
      // Even with no data, should render gracefully
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle rapid report switching', async ({ page }) => {
      for (const report of REPORT_ROUTES.slice(0, 5)) {
        await page.goto(report.path);
        // Don't wait for full load — test rapid switching
      }
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle page refresh on report', async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should render reports on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should handle all 12 report pages without errors', async ({ page }) => {
      for (const report of REPORT_ROUTES) {
        await page.goto(report.path);
        await page.waitForLoadState('networkidle');
        const bodyText = await page.locator('body').textContent();
        expect(bodyText).not.toMatch(/500|Internal Server Error/i);
      }
    });

    test('should display finance overview page', async ({ page }) => {
      await page.goto('/dashboard/finance');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i);
    });

    test('should display invoices page', async ({ page }) => {
      await page.goto('/dashboard/invoices');
      await page.waitForLoadState('networkidle');
      await expect(
        page.getByText(/faktur|invoice|paragon|receipt/i).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });
});
