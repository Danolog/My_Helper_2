import { TEST_PHONE } from '../../src/lib/test-phone';
import { e2eGuestName } from '../e2e-cleanup';
import { test, expect } from '../fixtures';
import type { Browser, Page } from '@playwright/test';

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
// Zapis do bazy: udane create-session tworzy wizyte "scheduled" bez wplaty.
// Sprzatanie: afterEach anuluje ja przez DELETE /api/appointments/[id] (sesja
// wlasciciela): wizyta -> "cancelled", termin wraca do puli, nic "scheduled"
// nie zostaje. Wiersze (wizyta i jej deposit_payments, kaskada FK) usuwa
// dopiero globalTeardown po znaczniku [E2E] w imieniu goscia (#175; formularz
// portalu nie ma pola uwag). Unikalne dane per przebieg nic by nie daly: kazdy przebieg
// i tak zostawialby wizyte "scheduled", tylko na innym terminie.
//
// Telefon goscia: TEST_PHONE (src/lib/test-phone.ts) — sendSms blokuje go
// przed dostawca, wiec zaden przebieg nie wysle SMS do realnej osoby.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-5e0000000004';
const EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003';
const FULL_PRICE_DEPOSIT = 60; // 30% z 200 PLN
const HAPPY_HOURS_DEPOSIT = 30; // 30% z 100 PLN (200 PLN - 50%) — kwota, ktorej NIE wolno przyjac
// Znacznik #175 w imieniu goscia: po nim globalTeardown rozpoznaje wizyty E2E.
const GUEST_NAME = e2eGuestName('Gosc');

type CreateSessionJson = { success: boolean; data?: { simulated?: boolean; paymentUrl?: string; appointmentId?: string; amount?: number }; error?: string; details?: unknown };

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
    async ({ salonId, serviceId, employeeId, amount, localStart, testPhone, guestName }) => {
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
          guestName, guestPhone: testPhone,
        }),
      });
      return { status: res.status, json: (await res.json()) as { success: boolean; data?: { simulated?: boolean; appointmentId?: string }; error?: string } };
    },
    { salonId: SALON_ID, serviceId: SERVICE_ID, employeeId: EMPLOYEE_ID, amount, localStart, testPhone: TEST_PHONE, guestName: GUEST_NAME }
  );
}

/** Anuluje wizyty jako wlasciciel salonu (portal biegnie bez sesji wlasciciela). */
async function cancelAsOwner(browser: Browser, baseURL: string, appointmentIds: string[]) {
  const context = await browser.newContext({ storageState: 'tests/.auth/owner.json', baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }); // ustawia ciasteczka CSRF
    const token = (await context.cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
    for (const id of appointmentIds) {
      // Zapisane imie goscia ma miec znacznik [E2E] — inaczej globalTeardown cicho przestalby sprzatac.
      // Wszystkie asercje miekkie: test jest czerwony, ale petla anuluje kazde id do konca.
      const got = await page.request.get(`/api/appointments/${id}`);
      const gotBody = await got.text();
      const res = await page.request.delete(`/api/appointments/${id}`, { headers: { 'x-csrf-token': decodeURIComponent(token) } });
      expect.soft(res.status(), `sprzatanie: anulowanie wizyty ${id}: ${await res.text()}`).toBe(200);
      expect.soft(got.status(), `odczyt wizyty ${id}: ${gotBody}`).toBe(200);
      let savedGuestName: string | null | undefined;
      try {
        savedGuestName = (JSON.parse(gotBody) as { data?: { guestName?: string | null } }).data?.guestName;
      } catch {
        savedGuestName = undefined; // odpowiedz nie-JSON: status wyzej juz czerwony
      }
      expect.soft(savedGuestName, `zapisany guest_name wizyty ${id} bez znacznika [E2E] — teardown nie usunie wizyty`).toBe(GUEST_NAME);
    }
  } finally {
    await context.close();
  }
}

test.describe('Portal: zadatek przy zamrozonych happy hours', () => {
  test.use({ timezoneId: 'Europe/Warsaw' });

  let createdAppointmentIds: string[] = [];
  test.afterEach(async ({ browser, baseURL }) => {
    const ids = createdAppointmentIds;
    createdAppointmentIds = [];
    if (ids.length > 0) await cancelAsOwner(browser, baseURL!, ids);
  });

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
    // Gdyby serwer jednak przyjal kwote (regresja), wizyta powstala — sprzatamy ja tez.
    if (tampered.json.data?.appointmentId) createdAppointmentIds.push(tampered.json.data.appointmentId);
    expect(tampered.status, `kwota z rabatem happy hours powinna byc odrzucona: ${JSON.stringify(tampered.json)}`).toBe(400);
    expect(String(tampered.json.error)).toMatch(/nieprawidlowa kwota zadatku/i);

    // Pelna cena: przyjeta, sciezka bez Stripe.
    const accepted = await postCreateSession(page, FULL_PRICE_DEPOSIT, localStart);
    if (accepted.json.data?.appointmentId) createdAppointmentIds.push(accepted.json.data.appointmentId);
    expect(accepted.status, `create-session z pelna cena: ${JSON.stringify(accepted.json)}`).toBe(201);
    expect(accepted.json.success).toBe(true);
    expect(accepted.json.data?.simulated, 'serwer poszedl sciezka Stripe — uruchom go bez STRIPE_SECRET_KEY').toBe(true);

    expect(frozenCalls, 'portal nie pyta tras zamrozonych').toEqual([]);
  });

  // Prawdziwe body formularza gościa: clientId/variantId/guestEmail = null
  // i telefon w formacie placeholdera (ze spacjami). Do #65 trasa odrzucała je
  // 400 "Validation failed" — kazda rezerwacja z zadatkiem z portalu.
  //
  // Zakres (Ethan, #61): ten test dowodzi, ze formularz wysyla poprawny
  // ksztalt body i serwer go przyjmuje. NIE dowodzi, ze serwer sam liczy
  // kwote — formularz wysyla 60 i serwer odpowiada 60. Odrzucenie kwoty
  // z rabatem happy hours (30 PLN) dowodzi test wyzej ("30 PLN rejected,
  // 60 PLN accepted"); oba razem pokrywaja sciezke. Wariant "podmien w body
  // 59,99 i oczekuj 60 w odpowiedzi" (w tolerancji serwera |roznica| <= 0,01)
  // odrzucony: ten test przestalby wysylac prawdziwe body formularza, a to
  // jest jego jedyny przedmiot. Kolejnosc testow nie ma znaczenia — kazdy
  // otwiera wlasny termin i sprzata swoja wizyte.
  test('guest submits the booking form with a deposit and create-session accepts it', { tag: '@full' }, async ({ page }) => {
    let sentBody: Record<string, unknown> | null = null;
    let created: { status: number; json: CreateSessionJson } | null = null;
    await page.route('**/api/deposits/create-session', async (route) => {
      sentBody = route.request().postDataJSON();
      const response = await route.fetch();
      created = { status: response.status(), json: await response.json() };
      if (created.json.data?.appointmentId) createdAppointmentIds.push(created.json.data.appointmentId);
      await route.fulfill({ response });
    });

    await openDepositSummary(page);
    // Format numeru jak w placeholderze pola.
    await page.getByPlaceholder('Twoje imie').fill(GUEST_NAME);
    await page.getByPlaceholder('+48 123 456 789').fill(TEST_PHONE);
    await page.getByTestId('book-appointment-btn').click();

    await expect.poll(() => created, { timeout: 15000 }).not.toBeNull();
    // Test ma sens tylko na prawdziwym ksztalcie body (null + telefon ze spacjami).
    expect(sentBody, 'formularz wyslal body w ksztalcie, ktory psul walidacje').toMatchObject({
      depositAmount: FULL_PRICE_DEPOSIT,
      serviceId: SERVICE_ID,
      clientId: null,
      variantId: null,
      guestEmail: null,
      guestName: GUEST_NAME,
      guestPhone: TEST_PHONE,
    });
    expect(created!.status, `create-session: ${JSON.stringify(created!.json)}`).toBe(201);
    expect(created!.json.success).toBe(true);
    expect(created!.json.data?.simulated, 'serwer poszedl sciezka Stripe — uruchom go bez STRIPE_SECRET_KEY').toBe(true);
    expect(created!.json.data?.amount).toBe(FULL_PRICE_DEPOSIT);
  });
});
