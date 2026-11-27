import { test, expect } from '../fixtures';

// Krotki adres salonu `/s/<slug>`: link, kod QR i przycisk "Zarezerwuj" z Instagrama
// i Facebooka. Klient bez konta (projekt client-portal biegnie bez storageState)
// ma trafic na strone salonu i przejsc do rezerwacji.
//
// Dane: scripts/seed-test.ts — salon "Beauty Studio Demo" ze slugiem beauty-studio-demo.
// Test tylko czyta, niczego nie zapisuje.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SALON_SLUG = 'beauty-studio-demo';

test.describe('Portal: krotki adres salonu /s/<slug>', () => {
  test('guest opens /s/<slug>, lands on the salon page and can go to booking', { tag: '@smoke' }, async ({ page }) => {
    await page.goto(`/s/${SALON_SLUG}`, { waitUntil: 'load' });

    // Przekierowanie na strone salonu (adres kanoniczny z id).
    await expect(page).toHaveURL(new RegExp(`/salons/${SALON_ID}$`));
    // Hydration: dane salonu pobiera komponent klienta.
    // Nazwa salonu jest w CardTitle (div, nie naglowek) — szukamy po tekscie.
    await expect(page.getByText('Beauty Studio Demo', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    const bookLink = page.getByRole('link', { name: /zarezerwuj wizyte/i });
    await expect(bookLink).toBeVisible();
    await bookLink.click();

    await expect(page).toHaveURL(new RegExp(`/salons/${SALON_ID}/book$`));
    // Gosc widzi liste uslug — bez logowania.
    await expect(page.locator('[data-testid^="booking-service-option-"]').first()).toBeVisible({ timeout: 15000 });
    await expect(page).not.toHaveURL(/\/login|\/portal\/login/);
  });

  test('adres z wielkimi literami prowadzi do tego samego salonu', { tag: '@full' }, async ({ page }) => {
    await page.goto(`/s/${SALON_SLUG.toUpperCase()}`, { waitUntil: 'load' });
    await expect(page).toHaveURL(new RegExp(`/salons/${SALON_ID}$`));
  });

  test('nieznany adres → 404, bez przekierowania na strone salonu', { tag: '@smoke' }, async ({ page }) => {
    const response = await page.goto('/s/nie-ma-takiego-salonu-e2e', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(404);
    await expect(page).not.toHaveURL(/\/salons\//);
  });

  test('slowo zastrzezone → 404', { tag: '@full' }, async ({ page }) => {
    const response = await page.goto('/s/admin', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(404);
  });
});
