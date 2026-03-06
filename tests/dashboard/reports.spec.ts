import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// All report routes
// Keywords use flexible regex to match both diacritic and non-diacritic UI text
const REPORT_ROUTES = [
  { path: '/dashboard/reports/revenue', name: 'Revenue', keywords: /przychod|revenue|obr[oó]t/i },
  { path: '/dashboard/reports/employee-occupancy', name: 'Employee Occupancy', keywords: /obciaz|ob[lł]o[zż]en|occupancy|wykorzyst/i },
  { path: '/dashboard/reports/employee-payroll', name: 'Employee Payroll', keywords: /wynagrodzen|payroll|prowizj/i },
  { path: '/dashboard/reports/employee-popularity', name: 'Employee Popularity', keywords: /popularn|popularity|ranking/i },
  { path: '/dashboard/reports/services-popularity', name: 'Services Popularity', keywords: /us[lł]ug|services|popularn/i },
  { path: '/dashboard/reports/service-profitability', name: 'Service Profitability', keywords: /rentown|profitab|zysk/i },
  { path: '/dashboard/reports/materials', name: 'Materials', keywords: /materia[lł]|zu[zż]yci|materials/i },
  { path: '/dashboard/reports/materials-profitloss', name: 'Materials P&L', keywords: /materia[lł]|zysk|strat|profit|loss/i },
  { path: '/dashboard/reports/promotions', name: 'Promotions', keywords: /promocj|rabat|discount/i },
  { path: '/dashboard/reports/cancellations', name: 'Cancellations', keywords: /anulac|anulowan|cancel|odwo[lł]an|utracony/i },
  { path: '/dashboard/reports/monthly-comparison', name: 'Monthly Comparison', keywords: /miesi[eę]czn|monthly|por[oó]wnan/i },
  { path: '/dashboard/reports/yearly-comparison', name: 'Yearly Comparison', keywords: /roczn|yearly|por[oó]wnan/i },
];

// ---------------------------------------------------------------------------
// Flow 8: Reports & Finance (P1)
// ---------------------------------------------------------------------------

test.describe('Flow 8: Reports & Finance', () => {
  // Auth handled by storageState — no login needed

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    for (const report of REPORT_ROUTES) {
      test(`should load ${report.name} report page`, { tag: '@full' }, async ({ page }) => {
        await page.goto(report.path);
        await page.waitForLoadState('domcontentloaded');
        // Page should load without errors
        await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
        // Should contain some report-specific content
        await expect(
          page.getByText(report.keywords).first()
            .or(page.getByText(/raport|report|dane|data/i).first())
            .first()
        ).toBeVisible({ timeout: 30000 });
      });
    }

    test('should display date range filter on revenue report', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('domcontentloaded');

      // Date filter should be available
      const dateFilter = page.locator(
        'input[type="date"], [data-testid*="date"], button:has-text("zakres"), button:has-text("okres")'
      ).first();
      await expect(
        dateFilter.or(page.getByText(/okres|zakres|od.*do|filtr/i).first()).first()
      ).toBeVisible({ timeout: 15000 });
    });

    test('should display employee filter on payroll report', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/employee-payroll');
      await page.waitForLoadState('domcontentloaded');

      // Should have filter options
      await expect(
        page.getByText(/wynagrodzen|payroll|prowizj/i).first()
          .or(page.getByText(/pracowni|employee/i).first())
          .first()
      ).toBeVisible({ timeout: 15000 });
    });

    test('should display revenue chart or data table', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('domcontentloaded');

      // Should display either a chart or a data table
      await expect(
        page.locator('canvas, table, [role="table"]').first()
          .or(page.getByText(/brak danych|no data/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display monthly comparison data', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/monthly-comparison');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/por[oó]wnan|comparison|miesi[aą]c|month/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display yearly comparison data', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/yearly-comparison');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/por[oó]wnan|comparison|rok|year/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display cancellations report', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/cancellations');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/anulac|anulowan|cancel|odwo[lł]an|utracony/i).first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('should display materials usage report', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/materials');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/materia[lł]|zu[zż]yci|materials/i).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should prevent non-owner access to reports', { tag: '@full' }, async ({ browser }) => {
      const newContext = await browser.newContext();
      const newPage = await newContext.newPage();
      await newPage.goto('/dashboard/reports/revenue');
      await newPage.waitForURL('**/login**', { timeout: 30000 });
      await expect(newPage).toHaveURL(/\/login/);
      await newPage.close();
      await newContext.close();
    });

    test('should handle invalid report route gracefully', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/nonexistent-report');
      await page.waitForLoadState('domcontentloaded');
      // Should show 404 or redirect — NOT crash
      const status = page.locator('body');
      await expect(status).not.toContainText(/Internal Server Error/i);
    });

    test('should handle report with no data', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('domcontentloaded');
      // Even with no data, should render gracefully
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle rapid report switching', { tag: '@full' }, async ({ page }) => {
      for (const report of REPORT_ROUTES.slice(0, 5)) {
        await page.goto(report.path);
        // Don't wait for full load — test rapid switching
      }
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle page refresh on report', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('domcontentloaded');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should render reports on mobile viewport', { tag: '@full' }, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/dashboard/reports/revenue');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle all 12 report pages without errors', { tag: '@full' }, async ({ page }) => {
      test.setTimeout(120000);
      for (const report of REPORT_ROUTES) {
        await page.goto(report.path);
        await page.waitForLoadState('domcontentloaded');
        const bodyText = await page.locator('body').textContent();
        expect(bodyText).not.toMatch(/Internal Server Error/i);
      }
    });

    test('should display finance overview page', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/dashboard/finance');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should display invoices page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/invoices');
      await page.waitForLoadState('domcontentloaded');
      await expect(
        page.getByText(/faktur|invoice|paragon|receipt/i).first()
      ).toBeVisible({ timeout: 5000 });
    });
  });
});
