import { test, expect } from '../fixtures';

// Panel + realny toast sonnera pod straznikiem CSP (tests/fixtures.ts, tag @csp).
// Sonner wstrzykuje <style> (hash w style-src-elem, src/proxy.ts buildCsp)
// i ustawia style="" na toascie (style-src-attr). Zlamanie ktoregokolwiek
// konczy ten test bledem z lista naruszen.
//
// Toast z walidacji po stronie klienta (pusta nazwa salonu): bez dialogu i bez
// zapisu do bazy. Dla pewnosci kazdy PUT na dane salonu jest przerywany —
// test nie moze zmienic danych lokalnej bazy ani bazy CI.

test.describe('Panel: toast bez naruszen CSP', () => {
  test('should show sonner toast on salon settings without CSP violations', { tag: ['@smoke', '@csp'] }, async ({ page }) => {
    const writes: string[] = [];
    await page.route('**/api/salons/**', async (route) => {
      if (route.request().method() !== 'GET') {
        writes.push(`${route.request().method()} ${route.request().url()}`);
        await route.abort();
        return;
      }
      await route.continue();
    });

    await page.goto('/dashboard/settings/salon');
    await page.waitForLoadState('load');

    // Dane salonu zaladowane (pole wypelnione) — dopiero wtedy czyscimy,
    // inaczej fetch nadpisalby pusta wartosc i zapis poszedlby z prawdziwa nazwa.
    const name = page.locator('#salon-name');
    await expect(name).not.toHaveValue('', { timeout: 15000 });
    await name.fill('');
    await expect(name).toHaveValue('');

    await page.getByRole('button', { name: /zapisz dane salonu/i }).click();

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: /nazwa salonu jest wymagana/i });
    await expect(toast).toBeVisible({ timeout: 10000 });
    expect(writes, 'walidacja po stronie klienta nie powinna wysylac zapisu').toEqual([]);
  });
});
