import { test, expect } from '../fixtures';

// Promocje zamrozone (FROZEN_PROMOTION_TYPES, modul complexPromotions — #59, #60)
// na danych z seeda (scripts/seed-test.ts, krok 8): happy_hours i package
// (zamrozone) oraz percentage "Rabat 10% (E2E)" jako kontrola, ze lista
// faktycznie sie laduje. Kody: E2E-HAPPY (-> happy_hours), E2E-RABAT10 (-> percentage).
// Tylko odczyt.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const FROZEN_TYPES = ['happy_hours', 'package', 'buy2get1', 'first_visit'];
const FROZEN_NAMES = [/Happy Hours -50% \(E2E/, /Pakiet strzyzenie \+ manicure \(E2E/];
const ALLOWED_NAME = 'Rabat 10% (E2E)';

test.describe('Panel: promocje zamrozone na danych', () => {
  test('GET /api/promotions does not return seeded frozen types', { tag: '@full' }, async ({ page }) => {
    await page.goto('/dashboard');
    const res = await page.request.get(`/api/promotions?salonId=${SALON_ID}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    const list = (json.data ?? []) as Array<{ name: string; type: string }>;
    expect(list.map((p) => p.name), 'kontrola: dozwolona promocja z seeda jest na liscie').toContain(ALLOWED_NAME);
    expect(list.filter((p) => FROZEN_TYPES.includes(p.type)), 'zamrozone typy w odpowiedzi').toEqual([]);
  });

  test('promotions page does not show seeded frozen promotions', { tag: '@full' }, async ({ page }) => {
    await page.goto('/dashboard/promotions');
    await page.waitForLoadState('load');
    await expect(page.getByText(ALLOWED_NAME).first()).toBeVisible({ timeout: 15000 });
    for (const name of FROZEN_NAMES) {
      await expect(page.getByText(name)).toHaveCount(0);
    }
  });

  test('promo code linked to happy hours shows "Promocja niedostępna" badge', { tag: '@full' }, async ({ page }) => {
    await page.goto('/dashboard/promo-codes');
    await page.waitForLoadState('load');
    // Karta kodu = najglebszy <div> zawierajacy kod i opis promocji (Card bez data-testid).
    const card = (code: string) =>
      page.locator('div').filter({ has: page.getByText(code, { exact: true }) }).filter({ hasText: 'Promocja:' }).last();
    const frozenCard = card('E2E-HAPPY');
    const allowedCard = card('E2E-RABAT10');
    await expect(frozenCard).toBeVisible({ timeout: 15000 });
    await expect(frozenCard.getByText('Promocja niedostępna')).toBeVisible();
    await expect(allowedCard).toBeVisible();
    await expect(allowedCard.getByText('Promocja niedostępna')).toHaveCount(0);
  });
});
