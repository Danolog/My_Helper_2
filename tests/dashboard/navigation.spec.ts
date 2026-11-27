import { test, expect } from '../fixtures';

// ---------------------------------------------------------------------------
// Nawigacja panelu: 5 pozycji + „Więcej”, strony zbiorcze Oferta i Wyniki,
// dolny pasek na telefonie. Auth przez storageState (właściciel).
// ---------------------------------------------------------------------------

const PRIMARY_LABELS = ['Dziś', 'Kalendarz', 'Klienci', 'Oferta', 'Wyniki'];

test.describe('Nawigacja panelu', () => {
  test.describe('Menu boczne (desktop)', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test('pięć pozycji i zwinięte „Więcej”', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      const sidebar = page.locator('aside[aria-label="Panel nawigacyjny"]');
      await expect(sidebar).toBeVisible({ timeout: 30000 });

      for (const label of PRIMARY_LABELS) {
        await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
      }
      const more = sidebar.getByRole('button', { name: 'Więcej' });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      // Przy 900 px wysokości ostatnia pozycja i wylogowanie mieszczą się na ekranie.
      await expect(sidebar.getByRole('button', { name: 'Wyloguj się' })).toBeInViewport();
    });

    test('„Więcej” rozwija dodatki i ustawienia', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      const sidebar = page.locator('aside[aria-label="Panel nawigacyjny"]');
      const more = sidebar.getByRole('button', { name: 'Więcej' });
      await expect(more).toBeVisible({ timeout: 30000 });

      // Czekamy na hydrację: kliknięcie przed nią nie zmienia aria-expanded.
      await expect(async () => {
        await more.click();
        await expect(more).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
      }).toPass({ timeout: 30000 });

      await expect(sidebar.getByRole('link', { name: 'Ustawienia' })).toBeVisible();
      await expect(sidebar.getByRole('link', { name: 'Subskrypcja' })).toBeVisible();
      await sidebar.getByRole('link', { name: 'Ustawienia' }).click();
      await expect(page).toHaveURL(/\/dashboard\/settings/, { timeout: 30000 });
    });

    test('Oferta prowadzi do usług i zespołu', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/offer', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: 'Oferta' })).toBeVisible({ timeout: 30000 });

      await page.getByRole('link', { name: /Usługi/ }).first().click();
      await expect(page).toHaveURL(/\/dashboard\/services/, { timeout: 30000 });
    });

    test('Wyniki prowadzą do raportów, płatności i rozliczeń', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/results', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: 'Wyniki' })).toBeVisible({ timeout: 30000 });

      // Menu boczne prowadzi na /dashboard/results, więc te linki są tylko w kafelkach.
      await expect(page.locator('a[href="/dashboard/reports"]')).toBeVisible();
      await expect(page.locator('a[href="/dashboard/payments"]')).toBeVisible();
      await expect(page.locator('a[href="/dashboard/finance"]')).toBeVisible();
    });
  });

  test.describe('Dolny pasek (telefon)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('Dziś, Kalendarz, + Wizyta, Klienci, Więcej', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      const bar = page.getByRole('navigation', { name: 'Szybka nawigacja' });
      await expect(bar).toBeVisible({ timeout: 30000 });

      await expect(bar.getByRole('link', { name: 'Dziś', exact: true })).toBeVisible();
      await expect(bar.getByRole('link', { name: 'Kalendarz', exact: true })).toBeVisible();
      await expect(bar.getByRole('link', { name: 'Klienci', exact: true })).toBeVisible();
      await expect(bar.getByRole('link', { name: 'Dodaj wizytę' })).toHaveAttribute('href', '/dashboard/booking');
      await expect(bar.getByRole('button', { name: /pełne menu/i })).toBeVisible();
    });
  });
});
