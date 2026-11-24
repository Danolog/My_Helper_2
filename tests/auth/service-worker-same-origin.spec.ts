import { test, expect } from '../fixtures';

// Service worker i strona nie wysylaja zadnego zadania poza origin aplikacji.
// Dawniej sw.js ladowal Workbox z CDN Google (importScripts), a workbox-sw
// doladowywal stamtad kolejne moduly. Dzis biblioteki leza w
// public/workbox-v7.3.0/; ten test pilnuje, zeby zaden adres zewnetrzny nie
// wrocil — ani w skryptach workera, ani w jego fetchach, ani na stronie.
//
// context.on('request') obejmuje w Chromium takze zadania z service workera
// (importScripts przy instalacji i fetch z handlerow Workboxa); page.on
// dodatkowo zadania samej strony. Strona bez logowania (projekt "auth" nie ma
// storageState), wiec test nie zalezy od seeda.
test.describe('Service worker: tylko wlasny origin', () => {
  test('po rejestracji SW zadne zadanie nie idzie do innego hosta', { tag: '@smoke' }, async ({ page, context, baseURL }) => {
    test.skip(!process.env.CI, 'Service worker rejestruje sie tylko w buildzie produkcyjnym (CI: pnpm start)');

    const appOrigin = new URL(baseURL ?? 'http://localhost:3000').origin;
    const foreign = new Set<string>();
    const workboxScripts = new Set<string>();

    const record = (url: string) => {
      // data:, blob: itp. nie wychodza do sieci.
      if (!/^https?:/.test(url)) return;
      const parsed = new URL(url);
      if (parsed.origin !== appOrigin) foreign.add(url);
      if (parsed.pathname.startsWith('/workbox-v7.3.0/')) workboxScripts.add(parsed.pathname);
    };
    context.on('request', (request) => record(request.url()));
    page.on('request', (request) => record(request.url()));

    await page.goto('/login', { waitUntil: 'load' });

    // ready rozwiazuje sie dopiero przy aktywnym workerze — czyli gdy
    // importScripts wszystkich modulow Workboxa sie udal.
    const scriptURL = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.scriptURL ?? null;
    });
    expect(scriptURL).toBe(`${appOrigin}/sw.js`);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20000,
    });

    // Druga wizyta idzie juz przez handlery workera (NetworkFirst, CacheFirst).
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('#email')).toBeVisible({ timeout: 15000 });

    // Nowa wersja workera faktycznie dziala: cache z biezacym CACHE_VERSION.
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames).toContain('pages-v4');

    // Monitor faktycznie widzi zadania workera (inaczej asercja nizej bylaby pusta).
    expect([...workboxScripts]).toEqual(
      expect.arrayContaining(['/workbox-v7.3.0/workbox-sw.js', '/workbox-v7.3.0/workbox-routing.prod.js'])
    );
    expect([...foreign], 'zadania poza origin aplikacji').toEqual([]);
  });
});
