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
//   - salon ma numer BLIK w settingsJson.deposits.blikPhone (krok 3; numer
//     testowy +48 000 600 704 z src/lib/test-phone.ts).
// Gdyby zamrozenie przestalo dzialac (portal albo serwer), zadatek spadlby
// do 30 PLN albo serwer odrzucilby kwote 60 PLN — testy padaja w obu przypadkach.
//
// Test 1 (kwota liczona przez serwer): POST /api/deposits/blik-booking —
// rezerwacja z zadatkiem BLIK na telefon salonu. Trasa nie dotyka Stripe
// i dziala niezaleznie od przelacznika sciezki zadatku w portalu; 201 zwraca
// dane przelewu (numer BLIK z seeda, kwota). Bez wymagan co do STRIPE_SECRET_KEY.
//
// Test 2 (prawdziwe body formularza): portal wysyla POST /api/deposits/blik-booking
// (platnosc zadatku online zamrozona modulem onlineDeposits, przelacznik
// isBlikDepositFlow() zwraca true). Serwer odpowiada 201 z danymi przelewu,
// a ekran potwierdzenia pokazuje instrukcje BLIK z kwota z odpowiedzi.
// Do create-session nie idzie zadne zadanie. Bez wymagan co do STRIPE_SECRET_KEY.
//
// Zapis do bazy: udana rezerwacja (oba testy) tworzy wizyte "scheduled" bez wplaty
// (bez wiersza deposit_payments). Sprzatanie: afterEach anuluje ja przez
// DELETE /api/appointments/[id] (sesja wlasciciela): wizyta -> "cancelled",
// termin wraca do puli, nic "scheduled" nie zostaje. Wiersze wizyt
// usuwa dopiero globalTeardown po znaczniku [E2E] w imieniu goscia (#175;
// formularz portalu nie ma pola uwag). Unikalne dane per przebieg nic by nie daly:
// kazdy przebieg i tak zostawialby wizyte "scheduled", tylko na innym terminie.
//
// Telefon goscia: TEST_PHONE (src/lib/test-phone.ts) — sendSms blokuje go
// przed dostawca, wiec zaden przebieg (takze SMS z danymi przelewu BLIK
// w obu testach) nie wysle SMS do realnej osoby.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-5e0000000004';
const EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003';
const FULL_PRICE_DEPOSIT = 60; // 30% z 200 PLN
const HAPPY_HOURS_DEPOSIT = 30; // 30% z 100 PLN (200 PLN - 50%) — kwota, ktorej NIE wolno przyjac
// Numer BLIK salonu z seeda (settingsJson.deposits.blikPhone, E.164) — numer testowy.
const SEED_BLIK_PHONE = '+48000600704';
// Znacznik #175 w imieniu goscia: po nim globalTeardown rozpoznaje wizyty E2E.
const GUEST_NAME = e2eGuestName('Gosc');

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

type BlikBookingJson = {
  success: boolean;
  data?: { appointmentId?: string; depositAmount?: number; blik?: { phone?: string; recipient?: string; title?: string } };
  error?: string;
  code?: string;
};

/** blik-booking z przegladarki (gosc portalu): ta sama sesja, ciasteczka i token CSRF co formularz. Body wg blikBookingSchema. */
async function postBlikBooking(page: Page, amount: number, localStart: string) {
  return page.evaluate(
    async ({ salonId, serviceId, employeeId, amount, localStart, testPhone, guestName }) => {
      const token = document.cookie.match(/(?:^|; )csrf-token=([^;]*)/)?.[1] ?? '';
      const start = new Date(localStart); // bez strefy = czas lokalny przegladarki (timezoneId Europe/Warsaw)
      const res = await fetch('/api/deposits/blik-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': decodeURIComponent(token) },
        body: JSON.stringify({
          salonId, serviceId, employeeId,
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 60 * 60000).toISOString(),
          depositAmount: amount,
          guestName, guestPhone: testPhone,
        }),
      });
      return { status: res.status, json: (await res.json()) as BlikBookingJson };
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

  test('server prices the BLIK deposit at full price in happy hours window: 30 PLN rejected, 60 PLN accepted', { tag: '@full' }, async ({ page }) => {
    const frozenCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/promotions\/check/.test(new URL(r.url()).pathname)) frozenCalls.push(r.url());
    });

    // Ten sam wolny termin, ktory pokazal portal: kontrola kwoty jest przed kontrola kolizji,
    // a odrzucona proba niczego nie zapisuje.
    const localStart = await openDepositSummary(page);

    // Kwota z rabatem happy hours: odrzucona przed odczytem numeru BLIK i przed zapisem.
    const tampered = await postBlikBooking(page, HAPPY_HOURS_DEPOSIT, localStart);
    // Gdyby serwer jednak przyjal kwote (regresja), wizyta powstala — sprzatamy ja tez.
    if (tampered.json.data?.appointmentId) createdAppointmentIds.push(tampered.json.data.appointmentId);
    expect(tampered.status, `kwota z rabatem happy hours powinna byc odrzucona: ${JSON.stringify(tampered.json)}`).toBe(400);
    expect(tampered.json.success).toBe(false);
    expect(String(tampered.json.error)).toMatch(/nieprawidlowa kwota zadatku/i);

    // Pelna cena: przyjeta, odpowiedz niesie dane przelewu BLIK na telefon salonu.
    const accepted = await postBlikBooking(page, FULL_PRICE_DEPOSIT, localStart);
    if (accepted.json.data?.appointmentId) createdAppointmentIds.push(accepted.json.data.appointmentId);
    expect(accepted.status, `blik-booking z pelna cena: ${JSON.stringify(accepted.json)}`).toBe(201);
    expect(accepted.json.success).toBe(true);
    expect(accepted.json.data?.appointmentId, 'brak appointmentId — nie da sie posprzatac').toBeTruthy();
    expect(accepted.json.data?.depositAmount).toBe(FULL_PRICE_DEPOSIT);
    expect(accepted.json.data?.blik?.phone, 'numer BLIK z seeda (settingsJson.deposits.blikPhone)').toBe(SEED_BLIK_PHONE);

    expect(frozenCalls, 'portal nie pyta tras zamrozonych').toEqual([]);
  });

  // Prawdziwe body formularza gościa: clientId/variantId/guestEmail = null
  // i telefon w formacie placeholdera (ze spacjami). Do #65 trasa odrzucała je
  // 400 "Validation failed" — kazda rezerwacja z zadatkiem z portalu.
  //
  // Zakres (Ethan, #61): ten test dowodzi, ze formularz wysyla poprawny
  // ksztalt body i serwer go przyjmuje. NIE dowodzi, ze serwer sam liczy
  // kwote — formularz wysyla 60 i serwer odpowiada 60. Odrzucenie kwoty
  // z rabatem happy hours (30 PLN) dowodzi test wyzej. Wariant "podmien w body
  // 59,99 i oczekuj 60 w odpowiedzi" (w tolerancji serwera |roznica| <= 0,01)
  // odrzucony: ten test przestalby wysylac prawdziwe body formularza, a to
  // jest jego jedyny przedmiot. Kolejnosc testow nie ma znaczenia — kazdy
  // otwiera wlasny termin i sprzata swoja wizyte.
  test('guest submits the booking form with a deposit and blik-booking accepts it', { tag: '@full' }, async ({ page }) => {
    // Platnosc online zamrozona — formularz nie moze pytac create-session.
    const createSessionCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/deposits\/create-session(\/|$)/.test(new URL(r.url()).pathname)) createSessionCalls.push(r.url());
    });

    let sentBody: Record<string, unknown> | null = null;
    let booked: { status: number; json: BlikBookingJson } | null = null;
    await page.route('**/api/deposits/blik-booking', async (route) => {
      sentBody = route.request().postDataJSON();
      const response = await route.fetch();
      booked = { status: response.status(), json: await response.json() };
      if (booked.json.data?.appointmentId) createdAppointmentIds.push(booked.json.data.appointmentId);
      await route.fulfill({ response });
    });

    await openDepositSummary(page);
    // Format numeru jak w placeholderze pola.
    await page.getByPlaceholder('Twoje imie').fill(GUEST_NAME);
    await page.getByPlaceholder('+48 123 456 789').fill(TEST_PHONE);
    await page.getByTestId('book-appointment-btn').click();

    await expect.poll(() => booked, { timeout: 15000 }).not.toBeNull();
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
    // Trasa BLIK nie przyjmuje metody platnosci — hook ja usuwa.
    expect(sentBody).not.toHaveProperty('paymentMethod');
    expect(booked!.status, `blik-booking: ${JSON.stringify(booked!.json)}`).toBe(201);
    expect(booked!.json.success).toBe(true);
    expect(booked!.json.data?.depositAmount).toBe(FULL_PRICE_DEPOSIT);

    // Ekran potwierdzenia: dane przelewu z odpowiedzi 201, kwota z serwera.
    await expect(page.getByTestId('blik-instructions')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('blik-amount')).toHaveText(`${booked!.json.data!.depositAmount!.toFixed(2)} PLN`);

    expect(createSessionCalls, 'portal nie wola create-session (modul onlineDeposits zamrozony)').toEqual([]);
  });
});
