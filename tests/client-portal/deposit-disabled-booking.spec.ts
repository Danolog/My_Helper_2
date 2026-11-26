import { TEST_PHONE } from '../../src/lib/test-phone';
import { e2eGuestName } from '../e2e-cleanup';
import { test, expect } from '../fixtures';
import type { Browser } from '@playwright/test';

// Zadatki wylaczone w kodzie (isDepositEnabled w src/lib/features.ts zwraca false),
// a usluga ma w bazie zapisana flage zadatku. Portal ma ja pominac: klient nie widzi
// kroku ani kwoty zadatku, rezerwacja idzie zwykla sciezka (POST /api/appointments)
// i konczy sie zwyklym potwierdzeniem.
//
// Dane (scripts/seed-test.ts, krok 8): usluga "Zabieg z zadatkiem (E2E)" z
// depositRequired = true i zadatkiem 30%, pracowniczka Ewa Zadatkowa, grafik
// 7 dni 08:00-20:00. Te same dane co w deposit-frozen-happy-hours.spec.ts.
//
// Wlaczenie zadatku = ten test przestaje obowiazywac i trzeba go usunac
// albo odwrocic w tym samym PR.
//
// Zapis do bazy: rezerwacja tworzy wizyte "scheduled". afterEach anuluje ja
// przez DELETE /api/appointments/[id] (sesja wlasciciela); wiersz usuwa
// globalTeardown po znaczniku [E2E] w imieniu goscia.
//
// Telefon goscia: TEST_PHONE (src/lib/test-phone.ts) — sendSms blokuje go
// przed dostawca, wiec SMS potwierdzenia nie trafi do realnej osoby.

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-5e0000000004';
const EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003';
const GUEST_NAME = e2eGuestName('Gosc');

type CreatedAppointmentJson = { success: boolean; data?: { id?: string; depositAmount?: string | null }; error?: string };

function tomorrowInWarsaw(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // YYYY-MM-DD
}

/** Anuluje wizyty jako wlasciciel salonu (portal biegnie bez sesji wlasciciela). */
async function cancelAsOwner(browser: Browser, baseURL: string, appointmentIds: string[]) {
  const context = await browser.newContext({ storageState: 'tests/.auth/owner.json', baseURL });
  try {
    const page = await context.newPage();
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' }); // ustawia ciasteczka CSRF
    const token = (await context.cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
    for (const id of appointmentIds) {
      const res = await page.request.delete(`/api/appointments/${id}`, { headers: { 'x-csrf-token': decodeURIComponent(token) } });
      expect.soft(res.status(), `sprzatanie: anulowanie wizyty ${id}: ${await res.text()}`).toBe(200);
    }
  } finally {
    await context.close();
  }
}

test.describe('Portal: usluga z flaga zadatku przy wylaczonych zadatkach', () => {
  test.use({ timezoneId: 'Europe/Warsaw' });

  let createdAppointmentIds: string[] = [];
  test.afterEach(async ({ browser, baseURL }) => {
    const ids = createdAppointmentIds;
    createdAppointmentIds = [];
    if (ids.length > 0) await cancelAsOwner(browser, baseURL!, ids);
  });

  test('guest books a service with a stored deposit flag as a plain booking, without any deposit step', { tag: '@full' }, async ({ page }) => {
    // Kazde zapytanie do tras zadatku to regresja: portal nie powinien ich wolac.
    const depositCalls: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/deposits/')) depositCalls.push(`${r.method()} ${r.url()}`);
    });

    let created: { status: number; json: CreatedAppointmentJson } | null = null;
    await page.route('**/api/appointments', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      created = { status: response.status(), json: await response.json() };
      if (created.json.data?.id) createdAppointmentIds.push(created.json.data.id);
      await route.fulfill({ response });
    });

    await page.goto(`/salons/${SALON_ID}/book`, { waitUntil: 'load' });

    // Hydration: lista uslug renderuje sie po pobraniu salonu w komponencie klienta.
    const serviceOption = page.getByTestId(`booking-service-option-${SERVICE_ID}`);
    await expect(serviceOption, 'brak uslugi z seeda (krok 8: Zabieg z zadatkiem)').toBeVisible({ timeout: 15000 });
    // Wiersz uslugi bez znacznika "Zadatek 30%".
    await expect(serviceOption).not.toContainText(/zadatek/i);

    await serviceOption.click();
    await page.getByTestId(`booking-employee-option-${EMPLOYEE_ID}`).click();

    await page.getByTestId('booking-date-input').fill(tomorrowInWarsaw());
    await expect(page.getByTestId('time-slots-grid')).toBeVisible({ timeout: 15000 });
    const slot = page.locator('[data-testid^="time-slot-"]:not([disabled])').first();
    await expect(slot, 'brak wolnego terminu jutro — sprawdz grafik z seeda (08:00-20:00, 7 dni)').toBeVisible();
    await slot.click();

    // Podsumowanie bez kroku i kwoty zadatku.
    const summary = page.getByTestId('booking-step-summary');
    const bookButton = page.getByTestId('book-appointment-btn');
    await expect(bookButton).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('deposit-info-section')).toHaveCount(0);
    await expect(page.getByTestId('deposit-amount-display')).toHaveCount(0);
    await expect(page.getByTestId('blik-deposit-notice')).toHaveCount(0);
    await expect(page.getByTestId('payment-method-stripe')).toHaveCount(0);
    await expect(summary).not.toContainText(/zadatek/i);
    await expect(bookButton).toHaveText(/potwierdz rezerwacje/i);

    await page.getByPlaceholder('Twoje imie').fill(GUEST_NAME);
    await page.getByPlaceholder('+48 123 456 789').fill(TEST_PHONE);
    await bookButton.click();

    await expect.poll(() => created, { timeout: 15000 }).not.toBeNull();
    expect(created!.status, `POST /api/appointments: ${JSON.stringify(created!.json)}`).toBe(201);
    expect(created!.json.success).toBe(true);
    expect(created!.json.data?.id, 'brak id wizyty — nie da sie posprzatac').toBeTruthy();

    // Zwykle potwierdzenie: bez instrukcji BLIK i bez wiersza zadatku.
    const confirmationHeading = page.getByRole('heading', { name: /wizyta zarezerwowana/i });
    await expect(confirmationHeading).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('blik-instructions')).toHaveCount(0);
    await expect(page.getByTestId('blik-instructions-missing')).toHaveCount(0);
    await expect(page.getByTestId('blik-refund-notice')).toHaveCount(0);
    // Tylko karta potwierdzenia — naglowek i stopka strony nie sa przedmiotem testu.
    const confirmationCard = confirmationHeading.locator('xpath=ancestor::div[contains(@class, "container")][1]');
    await expect(confirmationCard).not.toContainText(/zadatek/i);

    expect(depositCalls, 'portal nie wola tras zadatku').toEqual([]);
  });
});
