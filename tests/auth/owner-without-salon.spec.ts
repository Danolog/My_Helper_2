import { test, expect } from '../fixtures';

/**
 * Konto bez salonu w panelu: zakładanie salonu zamiast przekierowania.
 *
 * Tak wygląda właściciel po potwierdzeniu e-maila: konto istnieje, sesja jest,
 * salonu nie ma (rejestracja bez sesji nie zakłada salonu). Wcześniej layout
 * panelu odsyłał go na /salons i nie miał jak założyć salonu.
 *
 * Konto testu powstaje przez /api/auth/sign-up/email w kontekście strony
 * (`page.request` dzieli ciasteczka ze stroną). W CI nie ma dostawcy poczty,
 * więc potwierdzanie e-maila jest wyłączone i rejestracja od razu daje sesję —
 * ten sam stan konta co po kliknięciu linku z e-maila, bez prawdziwej poczty.
 * Samego kliknięcia linku test nie odtwarza.
 *
 * Projekt `auth` (bez storageState): test nie może startować jako seedowany
 * właściciel. Własne konto testu, bo założenie salonu zmienia stan konta.
 *
 * Beta na zaproszenie: salon zakłada tylko konto z listy
 * BETA_ALLOWED_OWNER_EMAILS serwera. Test ścieżki udanej używa adresu z
 * E2E_INVITED_OWNER_EMAIL — workflow CI ustawia ten sam adres w obu zmiennych.
 * Bramka wymaga też potwierdzonego e-maila; bez poczty w CI konto testu ma
 * niepotwierdzony adres, więc workflow ustawia BETA_ALLOW_UNVERIFIED_OWNER=1
 * (przełącznik ignorowany na każdym hostingu).
 * Test odmowy używa losowego adresu spoza listy.
 */
const PANEL_PATHS = ['/dashboard', '/dashboard/clients'] as const;
const LAST_PANEL_PATH = PANEL_PATHS.at(-1) ?? '/dashboard';
const pathRegExp =(path: string) => new RegExp(`${path}$`);
const PASSWORD = 'NoSalonPass123!';

test.describe('Panel: konto bez salonu', () => {
  test(
    'rejestracja bez salonu -> /dashboard -> zakladanie salonu -> panel',
    { tag: '@full' },
    async ({ page, baseURL }) => {
      const origin = baseURL ?? 'http://localhost:3000';
      const email = process.env.E2E_INVITED_OWNER_EMAIL?.trim();
      if (!email) {
        expect(process.env.CI, 'CI: brak E2E_INVITED_OWNER_EMAIL (adres z listy bety)').toBeFalsy();
        test.skip(true, 'Brak E2E_INVITED_OWNER_EMAIL: adresu z listy BETA_ALLOWED_OWNER_EMAILS serwera');
        return;
      }

      // 1. Konto bez salonu, sesja w ciasteczkach kontekstu strony. Adres jest
      //    stały (z listy bety): przy ponownej próbie konto już istnieje —
      //    wtedy logowanie tym samym hasłem.
      const signUp = await page.request.post('/api/auth/sign-up/email', {
        data: { name: 'Bez Salonu E2E', email, password: PASSWORD },
        headers: { Origin: origin },
      });
      if (signUp.status() !== 200) {
        const signIn = await page.request.post('/api/auth/sign-in/email', {
          data: { email, password: PASSWORD },
          headers: { Origin: origin },
        });
        expect(signIn.status(), 'rejestracja albo logowanie konta testu').toBe(200);
      }

      const createHeading = page.getByText('Utworz swoj salon');
      const sidebar = page.locator('aside[aria-label="Panel nawigacyjny"]');
      const clientLink = page.getByRole('link', { name: /Jestem klientem/ });

      // 2. /dashboard i dowolna podstrona: tylko zakładanie salonu, bez przekierowania.
      for (const path of PANEL_PATHS) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(pathRegExp(path));
        await expect(createHeading).toBeVisible({ timeout: 15000 });
        await expect(sidebar).toHaveCount(0);
        await expect(clientLink).toHaveAttribute('href', '/salons');
      }

      // 3. Założenie salonu. Pola akceptacji regulaminu i DPA są tylko po
      //    publikacji dokumentów — zaznaczamy wszystkie, które są.
      const createButton = page.getByRole('button', { name: /Utworz salon z/ });
      const checkboxes = page.getByRole('checkbox');
      for (const box of await checkboxes.all()) {
        await box.check();
      }
      await expect(createButton).toBeEnabled({ timeout: 15000 });

      const createResponse = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/register-subscription'
      );
      await createButton.click();
      expect((await createResponse).status(), 'zalozenie salonu').toBe(200);

      // 4. router.refresh(): layout liczy dostęp na nowo i pokazuje panel.
      await expect(sidebar).toBeVisible({ timeout: 30000 });
      await expect(createHeading).toHaveCount(0);
      await expect(clientLink).toHaveCount(0);
      await expect(page).toHaveURL(pathRegExp(LAST_PANEL_PATH));
    }
  );

  test(
    'konto spoza listy bety -> zakladanie salonu -> 403 i komunikat o zaproszeniu',
    { tag: '@full' },
    async ({ page, baseURL }) => {
      const origin = baseURL ?? 'http://localhost:3000';
      const email = `not-invited-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

      const signUp = await page.request.post('/api/auth/sign-up/email', {
        data: { name: 'Bez Zaproszenia E2E', email, password: PASSWORD },
        headers: { Origin: origin },
      });
      expect(signUp.status(), 'rejestracja konta testu').toBe(200);

      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Utworz swoj salon')).toBeVisible({ timeout: 15000 });

      const createButton = page.getByRole('button', { name: /Utworz salon z/ });
      for (const box of await page.getByRole('checkbox').all()) {
        await box.check();
      }
      await expect(createButton).toBeEnabled({ timeout: 15000 });

      const createResponse = page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/register-subscription'
      );
      await createButton.click();
      expect((await createResponse).status(), 'zalozenie salonu poza lista bety').toBe(403);

      await expect(page.getByText(/tylko na zaproszenie/)).toBeVisible({ timeout: 15000 });
      await expect(page.locator('aside[aria-label="Panel nawigacyjny"]')).toHaveCount(0);
    }
  );
});
