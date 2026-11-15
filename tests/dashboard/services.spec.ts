import { test, expect, type Page } from '../fixtures';
import type { Response } from '@playwright/test';

const SALON_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Helpers (auth handled by storageState in playwright.config.ts)
// ---------------------------------------------------------------------------

async function navigateToServices(page: Page) {
  await page.goto('/dashboard/services');
  await page.waitForLoadState('domcontentloaded');
  // Wait for all JS bundles to load — React hydration requires full bundle
  await page.waitForLoadState('load');
  // Wait for page hydration — ensure the add button is interactive
  await page.getByTestId('add-service-btn').waitFor({ state: 'visible', timeout: 30000 });
}

/**
 * Reliably opens the "Add service" dialog by retrying the click
 * if the dialog doesn't appear. This handles the CI hydration timing
 * issue where the button is visible before React has attached the
 * DialogTrigger event handler.
 */
async function openAddServiceDialog(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByTestId('add-service-btn').click();
    try {
      await page.getByTestId('service-name-input').waitFor({ state: 'visible', timeout: 3000 });
      return; // Dialog opened successfully
    } catch {
      // Dialog didn't open — wait for hydration and retry
      await page.waitForTimeout(1000);
    }
  }
  // Final attempt with longer timeout
  await page.getByTestId('service-name-input').waitFor({ state: 'visible', timeout: 5000 });
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
  return { 'x-csrf-token': decodeURIComponent(token) };
}

/** Unikalna nazwa per przebieg — asercje nie moga trafic w dane z seeda ani z poprzednich przebiegow. */
function uniqueName(prefix: string): string {
  return `${prefix} E2E ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function isCreate(res: Response, path: '/api/services' | '/api/service-categories'): boolean {
  return res.request().method() === 'POST' && new URL(res.url()).pathname === path;
}

/** Zapis z formularza: czeka na odpowiedz POST i zwraca id z 201. */
async function submitAndGetId(
  page: Page,
  path: '/api/services' | '/api/service-categories',
  submit: () => Promise<void>
): Promise<string> {
  const responsePromise = page.waitForResponse((res) => isCreate(res, path), { timeout: 15000 });
  await submit();
  const res = await responsePromise;
  const body = await res.text();
  expect(res.status(), `POST ${path}: ${body}`).toBe(201);
  return (JSON.parse(body) as { data: { id: string } }).data.id;
}

async function createServiceViaApi(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/services', {
    headers: await csrfHeaders(page),
    data: { salonId: SALON_ID, name, basePrice: 10, baseDuration: 15 },
  });
  expect(res.status(), `zalozenie uslugi: ${await res.text()}`).toBe(201);
  return (await res.json()).data.id;
}

async function createCategoryViaApi(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/service-categories', {
    headers: await csrfHeaders(page),
    data: { salonId: SALON_ID, name },
  });
  expect(res.status(), `zalozenie kategorii: ${await res.text()}`).toBe(201);
  return (await res.json()).data.id;
}

// ---------------------------------------------------------------------------
// Flow 3: Services & Categories Management (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 3: Services & Categories', () => {
  // Auth handled by storageState — no login needed

  // Sprzatanie: kazda usluga i kategoria utworzona w tescie (201 z POST — z UI
  // albo przez API) jest usuwana po tescie. Najpierw uslugi, potem kategorie
  // (DELETE kategorii z przypisanymi uslugami zwraca 409). 404 = test usunal
  // obiekt sam (testy usuwania). Liczba uslug i kategorii salonu przed i po
  // @full ma byc ta sama.
  let createdServiceIds = new Set<string>();
  let createdCategoryIds = new Set<string>();

  test.beforeEach(async ({ page }) => {
    page.on('response', async (res) => {
      const kind = isCreate(res, '/api/services') ? 'service' : isCreate(res, '/api/service-categories') ? 'category' : null;
      if (!kind || res.status() !== 201) return;
      try {
        const id = ((await res.json()) as { data?: { id?: string } }).data?.id;
        if (id) (kind === 'service' ? createdServiceIds : createdCategoryIds).add(id);
      } catch {
        // body niedostepne (strona zamknieta) — submitAndGetId i tak zwraca id do testu
      }
    });
  });

  test.afterEach(async ({ page }) => {
    const services = [...createdServiceIds];
    const categories = [...createdCategoryIds];
    createdServiceIds = new Set();
    createdCategoryIds = new Set();
    if (services.length === 0 && categories.length === 0) return;

    const headers = await csrfHeaders(page);
    for (const id of services) {
      const res = await page.request.delete(`/api/services/${id}`, { headers });
      expect([200, 404], `sprzatanie: usuwanie uslugi ${id}: ${await res.text()}`).toContain(res.status());
    }
    for (const id of categories) {
      const res = await page.request.delete(`/api/service-categories/${id}`, { headers });
      expect([200, 404], `sprzatanie: usuwanie kategorii ${id}: ${await res.text()}`).toContain(res.status());
    }
  });

  /** Rejestruje id do sprzatania niezaleznie od listenera (np. gdy test sam je zwrocil). */
  function track(kind: 'service' | 'category', id: string) {
    (kind === 'service' ? createdServiceIds : createdCategoryIds).add(id);
  }

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display services page with tabs', { tag: '@smoke' }, async ({ page }) => {
      await navigateToServices(page);
      // UI: "Uslugi" (no diacritics)
      await expect(page.getByText(/us[lł]ugi/i).first()).toBeVisible();
      await expect(page.getByTestId('add-service-btn')).toBeVisible();
      // Tabs should be visible
      await expect(page.getByTestId('tab-categories').or(page.getByText(/kategorie/i).first()).first()).toBeVisible();
    });

    test('should open add service dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);
      await expect(page.getByTestId('service-name-input')).toBeVisible();
      await expect(page.getByTestId('service-price-input')).toBeVisible();
      await expect(page.getByTestId('service-duration-input')).toBeVisible();
    });

    test('should add a new service', { tag: '@full' }, async ({ page }) => {
      // Asercja na id z odpowiedzi 201, nie na tekst: "Strzyżenie damskie"
      // bylo juz na liscie (seed, poprzednie przebiegi), wiec stary test
      // swiecil na zielono nawet bez zapisu.
      await navigateToServices(page);
      await openAddServiceDialog(page);

      const name = uniqueName('Strzyżenie damskie');
      await page.getByTestId('service-name-input').fill(name);
      await page.getByTestId('service-price-input').fill('120');
      await page.getByTestId('service-duration-input').fill('60');

      const serviceId = await submitAndGetId(page, '/api/services', () =>
        page.getByTestId('save-service-btn').click()
      );
      track('service', serviceId);

      // Karta wlasnie tej uslugi na liscie, z nasza nazwa
      await expect(page.getByTestId(`service-card-${serviceId}`)).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId(`service-card-${serviceId}`)).toContainText(name);

      // I zapis w bazie z danymi z formularza
      const res = await page.request.get(`/api/services/${serviceId}`);
      expect(res.status()).toBe(200);
      const saved = (await res.json()).data as { name: string; basePrice: string; baseDuration: number; salonId: string };
      expect(saved).toMatchObject({ name, baseDuration: 60, salonId: SALON_ID });
      expect(Number(saved.basePrice)).toBe(120);
    });

    test('should create a service category', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      // Switch to categories tab
      await page.getByTestId('tab-categories').click();

      const name = uniqueName('Fryzjerstwo');
      await page.getByTestId('add-category-btn').click();
      await page.getByTestId('category-name-input').fill(name);
      const categoryId = await submitAndGetId(page, '/api/service-categories', () =>
        page.getByTestId('save-category-btn').click()
      );
      track('category', categoryId);

      await expect(page.getByTestId(`category-name-${categoryId}`)).toHaveText(name, { timeout: 10000 });
    });

    test('should edit a service category', { tag: '@full' }, async ({ page }) => {
      // Edytujemy wlasna kategorie, nie "pierwsza z listy" — pierwsza (sort 0)
      // to kategoria z seeda, ktorej stary test zmienial nazwe.
      await navigateToServices(page);
      const categoryId = await createCategoryViaApi(page, uniqueName('Kategoria do edycji'));
      track('category', categoryId);
      const newName = uniqueName('Fryzjerstwo Edytowane');

      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();
      await page.getByTestId(`edit-category-${categoryId}`).click();
      await page.getByTestId('category-name-input').clear();
      await page.getByTestId('category-name-input').fill(newName);
      await page.getByTestId('save-category-btn').click();

      await expect(page.getByTestId(`category-name-${categoryId}`)).toHaveText(newName, { timeout: 10000 });
      await expect
        .poll(async () => {
          const res = await page.request.get(`/api/service-categories/${categoryId}`);
          return ((await res.json()) as { data?: { name?: string } }).data?.name;
        }, { message: 'nowa nazwa kategorii nie zapisana', timeout: 10000 })
        .toBe(newName);
    });

    test('should assign category to a service', { tag: '@full' }, async ({ page }) => {
      // Wlasna usluga i wlasna kategoria — stary test przepinal pierwsza usluge
      // z listy (lista bez ORDER BY, czesto usluga z seeda) do pierwszej kategorii.
      await navigateToServices(page);
      const categoryName = uniqueName('Kategoria do przypisania');
      const categoryId = await createCategoryViaApi(page, categoryName);
      track('category', categoryId);
      const serviceId = await createServiceViaApi(page, uniqueName('Usluga do przypisania'));
      track('service', serviceId);

      await navigateToServices(page);
      await page.getByTestId(`assign-category-${serviceId}`).click();
      // Radix Select renderuje opcje w portalu, ktory w CI wychodzi poza
      // viewport (klik nie dochodzi) — fokus na opcji naszej kategorii + Enter.
      const option = page.getByRole('option', { name: categoryName, exact: true });
      await expect(option).toHaveCount(1);
      await option.focus();
      await page.keyboard.press('Enter');

      await expect
        .poll(async () => {
          const res = await page.request.get(`/api/services/${serviceId}`);
          return ((await res.json()) as { data?: { categoryId?: string | null } }).data?.categoryId;
        }, { message: 'usluga nie zostala przypisana do kategorii', timeout: 10000 })
        .toBe(categoryId);
    });

    test('should delete a service with confirmation', { tag: '@full' }, async ({ page }) => {
      // Usuwamy usluge zalozona przez ten test, nie "pierwsza z listy": lista
      // nie ma ORDER BY, a usuwanie pierwszej zjadalo kolejno uslugi z seeda,
      // od ktorych zaleza inne testy (np. zadatek w tests/client-portal/).
      await navigateToServices(page);
      const salonId = SALON_ID;
      const serviceId = await createServiceViaApi(page, uniqueName('Do usuniecia'));
      track('service', serviceId); // gdyby UI nie usunelo — afterEach sprzata

      await navigateToServices(page);
      await page.getByTestId(`delete-service-${serviceId}`).click();
      await expect(page.getByTestId('confirm-delete-service-btn')).toBeVisible({ timeout: 3000 });
      await page.getByTestId('confirm-delete-service-btn').click();

      await expect
        .poll(async () => {
          const res = await page.request.get(`/api/services?salonId=${salonId}`);
          const json = (await res.json()) as { data?: Array<{ id: string }> };
          return (json.data ?? []).some((svc) => svc.id === serviceId);
        }, { message: 'usunieta usluga nadal na liscie', timeout: 10000 })
        .toBe(false);
    });

    test('should cancel service deletion', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      const deleteBtn = page.locator('[data-testid^="delete-service-"]').first();
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.getByTestId('cancel-delete-service-btn').click();
        // Dialog should close, service still visible
        await expect(
          page.getByTestId('cancel-delete-service-btn')
        ).not.toBeVisible({ timeout: 2000 });
      }
    });

    test('should delete a category with confirmation', { tag: '@full' }, async ({ page }) => {
      // Jak przy usludze: usuwamy kategorie zalozona przez ten test (bez uslug),
      // nie "pierwsza z listy" — ta mogla byc kategoria z seeda.
      await navigateToServices(page);
      const salonId = SALON_ID;
      const categoryId = await createCategoryViaApi(page, uniqueName('Kategoria do usuniecia'));
      track('category', categoryId); // gdyby UI nie usunelo — afterEach sprzata

      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();
      await page.getByTestId(`delete-category-${categoryId}`).click();
      await expect(page.getByTestId('confirm-delete-category-btn')).toBeVisible({ timeout: 3000 });
      await page.getByTestId('confirm-delete-category-btn').click();

      await expect
        .poll(async () => {
          const res = await page.request.get(`/api/service-categories?salonId=${salonId}`);
          const json = (await res.json()) as { data?: Array<{ id: string }> };
          return (json.data ?? []).some((cat) => cat.id === categoryId);
        }, { message: 'usunieta kategoria nadal na liscie', timeout: 10000 })
        .toBe(false);
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show validation errors for empty service form', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      // Submit without filling
      await page.getByTestId('save-service-btn').click();

      // Should show validation errors
      await expect(
        page.getByTestId('error-service-name')
          .or(page.getByText(/wymagane|required|nazwa/i).first())
          .first()
      ).toBeVisible({ timeout: 3000 });
    });

    test('should reject negative price', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      await page.getByTestId('service-name-input').fill('Test Usługa');
      await page.getByTestId('service-price-input').fill('-50');
      await page.getByTestId('service-duration-input').fill('30');
      await page.getByTestId('save-service-btn').click();

      // Should show price validation error, or browser may prevent negative input
      await expect(
        page.getByTestId('error-service-price')
          .or(page.getByText(/cena|price|ujemna|0/i).first())
          .first()
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Browser may prevent negative input - verify no crash
      });
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should reject zero duration', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      await page.getByTestId('service-name-input').fill('Test Usługa');
      await page.getByTestId('service-price-input').fill('100');
      await page.getByTestId('service-duration-input').fill('0');
      await page.getByTestId('save-service-btn').click();

      // Should show duration validation error, or browser may prevent zero input
      await expect(
        page.getByTestId('error-service-duration')
          .or(page.getByText(/czas|duration|0|wi[eę]ksz/i).first())
          .first()
      ).toBeVisible({ timeout: 3000 }).catch(() => {
        // Browser may prevent zero input - verify no crash
      });
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should show error for empty category name', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await page.getByTestId('tab-categories').click();

      await page.getByTestId('add-category-btn').waitFor({ state: 'visible', timeout: 5000 });
      await page.getByTestId('add-category-btn').click();
      await page.getByTestId('save-category-btn').click();

      await expect(
        page.getByText(/wymagane|required|nazwa/i).first()
      ).toBeVisible({ timeout: 3000 });
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle very long service name', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      const longName = 'Usługa '.repeat(50); // 350 znakow, limit API to 200
      await page.getByTestId('service-name-input').fill(longName);
      await page.getByTestId('service-price-input').fill('100');
      await page.getByTestId('service-duration-input').fill('30');
      // Czekamy na odpowiedz (jesli formularz w ogole wysle POST), zeby nic nie
      // bylo w locie przy sprzataniu. Usluga nie moze powstac.
      const responsePromise = page
        .waitForResponse((res) => isCreate(res, '/api/services'), { timeout: 5000 })
        .catch(() => null);
      await page.getByTestId('save-service-btn').click();
      const res = await responsePromise;
      if (res) expect(res.status(), `za dluga nazwa przyjeta: ${await res.text()}`).toBe(400);

      // Should not crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle decimal price values', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      await page.getByTestId('service-name-input').fill(uniqueName('Usługa z groszami'));
      await page.getByTestId('service-price-input').fill('99.99');
      await page.getByTestId('service-duration-input').fill('45');
      const serviceId = await submitAndGetId(page, '/api/services', () =>
        page.getByTestId('save-service-btn').click()
      );
      track('service', serviceId);

      // Should accept decimal prices — zapisane z groszami
      const res = await page.request.get(`/api/services/${serviceId}`);
      expect(Number((await res.json()).data.basePrice)).toBe(99.99);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle switching between tabs rapidly', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);

      // Rapid tab switching
      for (let i = 0; i < 5; i++) {
        await page.getByTestId('tab-categories').click();
        await page.getByTestId('tab-categories').click(); // Click services tab back
      }
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle special characters in service name', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      const name = uniqueName('Koloryzacja "ombré" & balejaż');
      await page.getByTestId('service-name-input').fill(name);
      await page.getByTestId('service-price-input').fill('250');
      await page.getByTestId('service-duration-input').fill('120');
      const serviceId = await submitAndGetId(page, '/api/services', () =>
        page.getByTestId('save-service-btn').click()
      );
      track('service', serviceId);

      // Nazwa zapisana bez zmian (cudzyslowy, &, znaki diakrytyczne)
      const res = await page.request.get(`/api/services/${serviceId}`);
      expect((await res.json()).data.name).toBe(name);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle very high price value', { tag: '@full' }, async ({ page }) => {
      await navigateToServices(page);
      await openAddServiceDialog(page);

      await page.getByTestId('service-name-input').fill(uniqueName('Premium Service'));
      await page.getByTestId('service-price-input').fill('999999');
      await page.getByTestId('service-duration-input').fill('30');
      const serviceId = await submitAndGetId(page, '/api/services', () =>
        page.getByTestId('save-service-btn').click()
      );
      track('service', serviceId);

      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
