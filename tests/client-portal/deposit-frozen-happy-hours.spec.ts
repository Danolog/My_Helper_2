import { test, expect } from '../fixtures';

// Rezerwacja z zadatkiem w oknie happy hours, gdy happy hours sa zamrozone
// (FROZEN_PROMOTION_TYPES, modul complexPromotions — B2/#59, #60).
//
// Dane (scripts/seed-test.ts, krok 8):
//   - usluga "Zabieg z zadatkiem (E2E)": 200 PLN, zadatek 30% -> 60 PLN,
//   - pracowniczka Ewa Zadatkowa, przypisana do uslugi, grafik 7 dni 08:00-20:00,
//   - aktywna promocja happy_hours -50% przez cala dobe, codziennie, bez dat.
// Gdyby zamrozenie przestalo dzialac (portal albo serwer), zadatek spadlby
// do 30 PLN albo serwer odrzucilby kwote 60 PLN — test pada w obu przypadkach.
//
// Bez wywolan zewnetrznych: serwer E2E w CI dziala BEZ STRIPE_SECRET_KEY, wiec
// create-session idzie sciezka "simulated" (bez Stripe). Test to sprawdza
// (simulated === true) i nie dopuszcza przekierowania do Stripe. Lokalnie:
// uruchamiaj serwer z pustym STRIPE_SECRET_KEY (jak w CI).
// Zapis do bazy: create-session tworzy wizyte "scheduled" bez wplaty (jak
// prawdziwa rezerwacja); kolejny przebieg bierze nastepny wolny termin.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-5e0000000004';
const EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003';
const FULL_PRICE_DEPOSIT = 60; // 30% z 200 PLN
const HAPPY_HOURS_DEPOSIT = 30; // 30% z 100 PLN (200 PLN - 50%) — kwota, ktorej NIE wolno przyjac

function tomorrowInWarsaw(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // YYYY-MM-DD
}

test.describe('Portal: zadatek przy zamrozonych happy hours', () => {
  test.use({ timezoneId: 'Europe/Warsaw' });

  test('deposit equals full price in happy hours window and create-session accepts it', { tag: '@full' }, async ({ page }) => {
    test.skip(!!process.env.STRIPE_SECRET_KEY, 'Serwer E2E ma dzialac bez STRIPE_SECRET_KEY (jak CI) — inaczej create-session wola Stripe');

    const frozenCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/promotions\/check/.test(new URL(r.url()).pathname)) frozenCalls.push(r.url());
    });
    // Potwierdzenie platnosci (dev-only, w buildzie produkcyjnym 404) nie jest przedmiotem testu.
    await page.route('**/api/deposits/confirm', (route) => route.abort());

    let sentBody: Record<string, unknown> | null = null;
    let created: { status: number; json: { success: boolean; data?: { simulated?: boolean; paymentUrl?: string }; error?: string } } | null = null;
    await page.route('**/api/deposits/create-session', async (route) => {
      sentBody = route.request().postDataJSON();
      const response = await route.fetch();
      created = { status: response.status(), json: await response.json() };
      await route.fulfill({ response });
    });

    await page.goto(`/salons/${SALON_ID}/book`);
    await page.waitForLoadState('load');

    await page.getByTestId(`booking-service-option-${SERVICE_ID}`).click();
    await page.getByTestId(`booking-employee-option-${EMPLOYEE_ID}`).click();

    const dateInput = page.getByTestId('booking-date-input');
    await dateInput.fill(tomorrowInWarsaw());
    await expect(page.getByTestId('time-slots-grid')).toBeVisible({ timeout: 15000 });
    const slot = page.locator('[data-testid^="time-slot-"]:not([disabled])').first();
    await expect(slot, 'brak wolnego terminu jutro — sprawdz grafik z seeda (08:00-20:00, 7 dni)').toBeVisible();
    await slot.click();

    // Podsumowanie: pelna cena, bez rabatu happy hours.
    await expect(page.getByTestId('deposit-amount-display')).toHaveText(`${FULL_PRICE_DEPOSIT} PLN`, { timeout: 10000 });
    await expect(page.getByTestId('discount-row')).toHaveCount(0);

    await page.getByPlaceholder('Twoje imie').fill('Gosc E2E');
    await page.getByPlaceholder('+48 123 456 789').fill('+48 500 600 700');

    // Kontrola serwera: kwota z rabatem happy hours ma byc odrzucona (400,
    // przed zapisem). Ta sama sesja i token CSRF co prawdziwy formularz.
    const tampered = await page.evaluate(
      async ({ salonId, serviceId, employeeId, amount }) => {
        const token = document.cookie.match(/(?:^|; )csrf-token=([^;]*)/)?.[1] ?? '';
        const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
        start.setMinutes(0, 0, 0);
        const res = await fetch('/api/deposits/create-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(token) },
          body: JSON.stringify({
            salonId, serviceId, employeeId, clientId: null, variantId: null,
            startTime: start.toISOString(),
            endTime: new Date(start.getTime() + 60 * 60000).toISOString(),
            depositAmount: amount, paymentMethod: 'stripe',
            guestName: 'Gosc E2E', guestPhone: '+48500600700', guestEmail: null,
          }),
        });
        return { status: res.status, json: await res.json() };
      },
      { salonId: SALON_ID, serviceId: SERVICE_ID, employeeId: EMPLOYEE_ID, amount: HAPPY_HOURS_DEPOSIT }
    );
    expect(tampered.status, `kwota z rabatem happy hours powinna byc odrzucona: ${JSON.stringify(tampered.json)}`).toBe(400);
    expect(String(tampered.json.error)).toMatch(/nieprawidlowa kwota zadatku/i);

    await page.getByTestId('book-appointment-btn').click();
    await expect.poll(() => created, { timeout: 15000 }).not.toBeNull();

    expect(sentBody, 'formularz wyslal kwote zadatku').toMatchObject({ depositAmount: FULL_PRICE_DEPOSIT, serviceId: SERVICE_ID });
    expect(created!.status, `create-session: ${JSON.stringify(created!.json)}`).toBe(200);
    expect(created!.json.success).toBe(true);
    expect(created!.json.data?.simulated, 'serwer poszedl sciezka Stripe — uruchom go bez STRIPE_SECRET_KEY').toBe(true);
    expect(frozenCalls, 'portal nie pyta tras zamrozonych').toEqual([]);
  });
});
