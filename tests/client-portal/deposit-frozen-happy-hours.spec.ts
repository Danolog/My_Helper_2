import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures';

// Rezerwacja z zadatkiem w oknie happy hours, gdy happy hours sa zamrozone
// (FROZEN_PROMOTION_TYPES, modul complexPromotions — B2/#59, #60).
//
// Dane (scripts/seed-test.ts, krok 8):
//   - usluga "Zabieg z zadatkiem (E2E)": 200 PLN, zadatek 30% -> 60 PLN,
//   - pracowniczka Ewa Zadatkowa, przypisana do uslugi, grafik 7 dni 08:00-20:00,
//   - aktywna promocja happy_hours -50% przez cala dobe, codziennie, bez dat.
// Gdyby zamrozenie przestalo dzialac (portal albo serwer), zadatek spadlby
// do 30 PLN albo serwer odrzucilby kwote 60 PLN — testy padaja w obu przypadkach.
//
// Bez wywolan zewnetrznych: serwer E2E w CI dziala BEZ STRIPE_SECRET_KEY, wiec
// create-session idzie sciezka "simulated" (bez Stripe). Test to sprawdza
// (simulated === true). Lokalnie: uruchamiaj serwer z pustym STRIPE_SECRET_KEY.
// Zapis do bazy: udane create-session tworzy wizyte "scheduled" bez wplaty
// (jak prawdziwa rezerwacja); kolejny przebieg bierze nastepny wolny termin.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-5e0000000004';
const EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003';
const FULL_PRICE_DEPOSIT = 60; // 30% z 200 PLN
const HAPPY_HOURS_DEPOSIT = 30; // 30% z 100 PLN (200 PLN - 50%) — kwota, ktorej NIE wolno przyjac

type CreateSessionJson = { success: boolean; data?: { simulated?: boolean; paymentUrl?: string }; error?: string; details?: unknown };

function tomorrowInWarsaw(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // YYYY-MM-DD
}

/** Portal: usluga z zadatkiem -> pracowniczka -> jutro -> pierwszy wolny termin. Zwraca start terminu (czas lokalny Europe/Warsaw). */
async function openDepositSummary(page: Page): Promise<string> {
  await page.goto(`/salons/${SALON_ID}/book`);
  await page.waitForLoadState('load');

  await page.getByTestId(`booking-service-option-${SERVICE_ID}`).click();
  await page.getByTestId(`booking-employee-option-${EMPLOYEE_ID}`).click();

  const date = tomorrowInWarsaw();
  await page.getByTestId('booking-date-input').fill(date);
  await expect(page.getByTestId('time-slots-grid')).toBeVisible({ timeout: 15000 });
  const slot = page.locator('[data-testid^="time-slot-"]:not([disabled])').first();
  await expect(slot, 'brak wolnego terminu jutro — sprawdz grafik z seeda (08:00-20:00, 7 dni)').toBeVisible();
  const time = (await slot.getAttribute('data-testid'))!.replace('time-slot-', ''); // HH:MM
  await slot.click();

  // Podsumowanie: pelna cena, bez rabatu happy hours.
  await expect(page.getByTestId('deposit-amount-display')).toHaveText(`${FULL_PRICE_DEPOSIT} PLN`, { timeout: 10000 });
  await expect(page.getByTestId('discount-row')).toHaveCount(0);
  return `${date}T${time}:00`;
}

/** create-session z przegladarki: ta sama sesja, ciasteczka i token CSRF co formularz. */
async function postCreateSession(page: Page, amount: number, localStart: string) {
  return page.evaluate(
    async ({ salonId, serviceId, employeeId, amount, localStart }) => {
      const token = document.cookie.match(/(?:^|; )csrf-token=([^;]*)/)?.[1] ?? '';
      const start = new Date(localStart); // bez strefy = czas lokalny przegladarki (timezoneId Europe/Warsaw)
      const res = await fetch('/api/deposits/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(token) },
        body: JSON.stringify({
          salonId, serviceId, employeeId,
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 60 * 60000).toISOString(),
          depositAmount: amount, paymentMethod: 'stripe',
          guestName: 'Gosc E2E', guestPhone: '+48500600700',
        }),
      });
      return { status: res.status, json: (await res.json()) as { success: boolean; data?: { simulated?: boolean }; error?: string } };
    },
    { salonId: SALON_ID, serviceId: SERVICE_ID, employeeId: EMPLOYEE_ID, amount, localStart }
  );
}

test.describe('Portal: zadatek przy zamrozonych happy hours', () => {
  test.use({ timezoneId: 'Europe/Warsaw' });

  test.beforeEach(async ({ page }) => {
    test.skip(!!process.env.STRIPE_SECRET_KEY, 'Serwer E2E ma dzialac bez STRIPE_SECRET_KEY (jak CI) — inaczej create-session wola Stripe');
    // Potwierdzenie platnosci (dev-only, w buildzie produkcyjnym 404) nie jest przedmiotem testu.
    await page.route('**/api/deposits/confirm', (route) => route.abort());
  });

  test('server prices the deposit at full price in happy hours window: 30 PLN rejected, 60 PLN accepted', { tag: '@full' }, async ({ page }) => {
    const frozenCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/promotions\/check/.test(new URL(r.url()).pathname)) frozenCalls.push(r.url());
    });

    // Ten sam wolny termin, ktory pokazal portal: kontrola kwoty jest przed kontrola kolizji,
    // a odrzucona proba niczego nie zapisuje.
    const localStart = await openDepositSummary(page);

    // Kwota z rabatem happy hours: odrzucona przed zapisem.
    const tampered = await postCreateSession(page, HAPPY_HOURS_DEPOSIT, localStart);
    expect(tampered.status, `kwota z rabatem happy hours powinna byc odrzucona: ${JSON.stringify(tampered.json)}`).toBe(400);
    expect(String(tampered.json.error)).toMatch(/nieprawidlowa kwota zadatku/i);

    // Pelna cena: przyjeta, sciezka bez Stripe.
    const accepted = await postCreateSession(page, FULL_PRICE_DEPOSIT, localStart);
    expect(accepted.status, `create-session z pelna cena: ${JSON.stringify(accepted.json)}`).toBe(201);
    expect(accepted.json.success).toBe(true);
    expect(accepted.json.data?.simulated, 'serwer poszedl sciezka Stripe — uruchom go bez STRIPE_SECRET_KEY').toBe(true);

    expect(frozenCalls, 'portal nie pyta tras zamrozonych').toEqual([]);
  });

  // ZNANY BLAD (zgloszony w PR): formularz portalu wysyla clientId: null,
  // variantId: null, guestEmail: null (use-booking-data.ts), a
  // depositCreateSessionSchema ma .optional(), ktore odrzuca null -> 400
  // "Validation failed" dla KAZDEJ rezerwacji z zadatkiem. Do tego placeholder
  // telefonu "+48 123 456 789" ma spacje, ktorych regex nie przyjmuje.
  // test.fail: test opisuje poprawne zachowanie i dzis pada. Po naprawie zacznie
  // przechodzic, Playwright zglosi "expected to fail" jako blad — wtedy zdejmij test.fail.
  test('guest submits the booking form with a deposit and create-session accepts it', { tag: '@full' }, async ({ page }) => {
    test.fail(true, 'Znany blad walidacji create-session (null w body formularza, telefon ze spacjami) — zgloszony w PR');

    let sentBody: Record<string, unknown> | null = null;
    let created: { status: number; json: CreateSessionJson } | null = null;
    await page.route('**/api/deposits/create-session', async (route) => {
      sentBody = route.request().postDataJSON();
      const response = await route.fetch();
      created = { status: response.status(), json: await response.json() };
      await route.fulfill({ response });
    });

    await openDepositSummary(page);
    // Format numeru jak w placeholderze pola.
    await page.getByPlaceholder('Twoje imie').fill('Gosc E2E');
    await page.getByPlaceholder('+48 123 456 789').fill('+48 500 600 700');
    await page.getByTestId('book-appointment-btn').click();

    await expect.poll(() => created, { timeout: 15000 }).not.toBeNull();
    expect(sentBody, 'formularz wyslal kwote zadatku').toMatchObject({ depositAmount: FULL_PRICE_DEPOSIT, serviceId: SERVICE_ID });
    expect(created!.status, `create-session: ${JSON.stringify(created!.json)}`).toBe(201);
    expect(created!.json.data?.simulated).toBe(true);
  });
});
