import { failedLoginEmail } from '../failed-login-email';
import { test, expect, type Page } from '../fixtures';
import { acceptLegalDocuments } from '../legal-acceptance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_CREDENTIALS = {
  email: 'client@test.com',
  password: 'TestPassword123!',
};

async function loginAsClient(page: Page) {
  await page.goto('/portal/login');
  // Wait for React hydration — form renders after session check completes
  await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
  await page.fill('#email', CLIENT_CREDENTIALS.email);
  await page.fill('#password', CLIENT_CREDENTIALS.password);
  // Po udanym logowaniu klient Better Auth robi pelne przeladowanie na adres
  // docelowy (window.location.href = callbackURL, tu /appointments — katalog
  // salonow jest zamrozony). Czekamy na
  // KONIEC tego ladowania — nasluch ustawiony przed kliknieciem.
  // Poprzedni wzorzec /(salons|appointments|dashboard|portal)/ pasowal tez do
  // samego /portal/login: helper wracal natychmiast, a nastepne page.goto()
  // zrywalo trwajace zadanie logowania (test szedl dalej niezalogowany) albo
  // samo bylo przerywane przez to przeladowanie.
  const redirectedAfterLogin = page.waitForEvent('load', { timeout: 20000 });
  await page.locator('form button[type="submit"]').click();
  await redirectedAfterLogin;
  await expect(page).toHaveURL((url) => url.pathname === '/appointments');
}

/**
 * Salon testowy z seeda. Katalog salonow (lista `/salons`) jest zamrozony —
 * klient wchodzi na strone salonu z linku od salonu, wiec testy otwieraja ja
 * wprost, a nie przez liste.
 */
const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SALON_PATH = `/salons/${SALON_ID}`;
/** Nazwa salonu i usluga z seeda (`scripts/seed-test.ts`). */
const SALON_NAME = 'Beauty Studio Demo';
const SERVICE_ID = '00000000-0000-4000-8000-5e0000000001';
const SERVICE_NAME = 'Strzyzenie damskie';

/** Strona salonu sie pokazala: nazwa z seeda, bez stanu „Salon nie znaleziony”. */
async function expectSalonPageRendered(page: Page) {
  await expect(page.getByText(SALON_NAME, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/salon nie znaleziony/i)).toHaveCount(0);
}

/** Strona publiczna zamrozonego modulu: proxy przekierowuje na strone glowna. */
async function expectRedirectedHome(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'load' });
  await expect(page).toHaveURL((url) => url.pathname === '/');
}

// ---------------------------------------------------------------------------
// Flow 7: Client Portal (P2)
// ---------------------------------------------------------------------------

test.describe('Flow 7: Client Portal', () => {
  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display salon page (public, no auth)', { tag: ['@smoke', '@csp'] }, async ({ page }) => {
      await page.goto(SALON_PATH, { waitUntil: 'load' });

      await expect(page).toHaveURL((url) => url.pathname === SALON_PATH);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      await expectSalonPageRendered(page);
    });

    test('should display client login page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/login');
      await page.waitForLoadState('domcontentloaded');

      await expect(page.locator('#email')).toBeVisible();
      await expect(page.locator('#password')).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^zaloguj sie$/i })
      ).toBeVisible();
    });

    test('should display client registration page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/register');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.locator('#email').or(page.locator('input[name="email"]')).first()
      ).toBeVisible();
    });

    test('salon list is frozen: /salons redirects to home page', { tag: '@smoke' }, async ({ page }) => {
      await expectRedirectedHome(page, '/salons');
      // Strona glowna to oferta dla salonow, nie wybor roli.
      await expect(page.locator('#pricing')).toBeAttached({ timeout: 15000 });
      await expect(page.locator('a[href="/salons"]')).toHaveCount(0);
    });

    test('client landing is frozen: /dla-klientow redirects to home page', { tag: '@full' }, async ({ page }) => {
      await expectRedirectedHome(page, '/dla-klientow');
    });

    test('should view salon detail page', { tag: '@full' }, async ({ page }) => {
      await page.goto(SALON_PATH, { waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === SALON_PATH);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should view salon service page', { tag: '@full' }, async ({ page }) => {
      // Osobnej listy uslug nie ma — jest strona jednej uslugi `services/[serviceId]`.
      const servicePath = `${SALON_PATH}/services/${SERVICE_ID}`;
      await page.goto(servicePath, { waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === servicePath);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      await expect(page.getByTestId('service-name')).toHaveText(SERVICE_NAME, { timeout: 15000 });
    });

    test('should view salon gallery', { tag: '@full' }, async ({ page }) => {
      await page.goto(`${SALON_PATH}/gallery`, { waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === `${SALON_PATH}/gallery`);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should display appointments page for logged-in client', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/appointments');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        page.getByText(/wizyt|appointment|rezerwacj/i).first()
          .or(page.getByText(/brak|no.*appointment|pust/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('favorites are frozen: logged-in client is redirected home', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await expectRedirectedHome(page, '/favorites');
    });

    test('should display waiting list page for logged-in client', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/waiting-list');
      await page.waitForLoadState('domcontentloaded');

      await expect(
        // UI: "Lista oczekujacych" / "Oczekujace" (no diacritics)
        page.getByText(/oczekuj[aą]c|waiting|lista/i).first()
          .or(page.getByText(/brak|pust|no/i).first())
          .first()
      ).toBeVisible({ timeout: 5000 });
    });

    test('guest can open salon booking page', { tag: '@full' }, async ({ page }) => {
      // Rezerwacja goscia bez konta zostaje mimo zamrozenia katalogu.
      await page.goto(`${SALON_PATH}/book`, { waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === `${SALON_PATH}/book`);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
      // Formularz sie wyrenderowal: krok wyboru uslugi z usluga z seeda.
      await expect(page.getByTestId(`booking-service-option-${SERVICE_ID}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/salon nie znaleziony/i)).toHaveCount(0);
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should show error for invalid client login', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/login');
      await page.waitForSelector('form button[type="submit"]', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
      await page.fill('#email', failedLoginEmail());
      await page.fill('#password', 'WrongPass123!');
      await page.locator('form button[type="submit"]').click();

      await expect(
        // UI shows: "Nie udalo sie zalogowac. Sprawdz dane i sprobuj ponownie."
        page.getByText(/nie uda[lł]o si[eę]|nieprawidl|bl[aą]d|error|invalid/i).first()
      ).toBeVisible({ timeout: 15000 });
    });

    test('should redirect unauthenticated user from appointments page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/appointments', { waitUntil: 'load' });
      // Logowanie klienta z powrotem na wizyty — nie logowanie panelu salonu (/login).
      await expect(page).toHaveURL(
        (url) => url.pathname === '/portal/login' && url.searchParams.get('returnTo') === '/appointments',
        { timeout: 15000 }
      );
    });

    test('should redirect unauthenticated user from favorites page', { tag: '@full' }, async ({ page }) => {
      // Ulubione zamrozone: proxy przekierowuje na strone glowna przed logowaniem.
      await expectRedirectedHome(page, '/favorites');
    });

    test('should handle non-existent salon ID gracefully', { tag: '@full' }, async ({ page }) => {
      await page.goto('/salons/nonexistent-uuid-12345');
      await page.waitForLoadState('domcontentloaded');
      // Should show 404 or error message — NOT crash
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle empty registration form submission', { tag: '@full' }, async ({ page }) => {
      await page.goto('/portal/register');
      await page.waitForLoadState('domcontentloaded');

      const submitBtn = page.getByRole('button', { name: /zarejestruj|register|utw[oó]rz/i });
      if (await submitBtn.isVisible()) {
        // Po publikacji dokumentów przycisk jest nieaktywny do zaznaczenia akceptacji;
        // bez zaznaczenia klik nie dotarłby do walidacji pustych pól.
        await acceptLegalDocuments(page.locator('form'));
        await expect(submitBtn).toBeEnabled({ timeout: 15000 });
        await submitBtn.click();
        // Should show validation errors
        await expect(
          page.getByText(/wymagane|required|email|has[lł]o|wpisz/i).first()
        ).toBeVisible({ timeout: 3000 });
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle salon list query string (still redirected)', { tag: '@full' }, async ({ page }) => {
      await expectRedirectedHome(page, '/salons?q=%3Cscript%3E');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle rapid navigation between client pages', { tag: '@full' }, async ({ page }) => {
      const clientPages = [SALON_PATH, '/appointments', '/salons', '/waiting-list'];
      for (const path of clientPages) {
        await page.goto(path, { waitUntil: 'load' });
      }
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should render salon page on mobile viewport', { tag: '@full' }, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(SALON_PATH, { waitUntil: 'load' });
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should render salon page on tablet viewport', { tag: '@full' }, async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1194 });
      await page.goto(SALON_PATH, { waitUntil: 'load' });
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle back/forward browser navigation', { tag: '@full' }, async ({ page }) => {
      // Strona glowna -> strona salonu -> wstecz -> naprzod. Kazdy krok czeka
      // na zatwierdzony adres (wczesniej goBack startowal za wczesnie).
      await page.goto('/', { waitUntil: 'load' });
      await page.goto(SALON_PATH, { waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === SALON_PATH);
      await page.goBack({ waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === '/');
      await page.goForward({ waitUntil: 'load' });
      await expect(page).toHaveURL((url) => url.pathname === SALON_PATH);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle page refresh on appointments page', { tag: '@full' }, async ({ page }) => {
      await loginAsClient(page);
      await page.goto('/appointments');
      await page.waitForLoadState('domcontentloaded');
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
