import { e2eNotes } from '../e2e-cleanup';
import { test, expect, type Page } from '../fixtures';

// ---------------------------------------------------------------------------
// „Nie przyszedł” w szczegółach wizyty (właściciel z storageState).
//
// Wizyta wczorajsza przez API (Marta Nowak, bez grafiku — POST go nie
// sprawdza), godzina 16:00, której nie używają inne spec-e. Oznaczenie
// i cofnięcie przyciskiem w panelu, stan sprawdzany też w API.
// ---------------------------------------------------------------------------

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SEED_CLIENT_ID = '00000000-0000-4000-8000-c10000000001'; // Maria Kaczmarek
const SEED_SERVICE_ID = '00000000-0000-4000-8000-5e0000000001'; // Strzyzenie damskie, 60 min
const API_EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000002'; // Marta Nowak
const NO_SHOW_TIME = '16:00';
const NOTES = e2eNotes('nie przyszedl');

type ApiAppointment = { id: string; status: string };

function yesterdayInWarsaw(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // YYYY-MM-DD
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
  return { 'x-csrf-token': decodeURIComponent(token) };
}

/**
 * Zwalnia termin po przerwanym przebiegu: wizyta oznaczona „Nie przyszedł”
 * nadal zajmuje termin, a anulowanie wymaga najpierw cofnięcia oznaczenia.
 */
async function freeSlot(page: Page, startIso: string, endIso: string) {
  const params = new URLSearchParams({ salonId: SALON_ID, startDate: startIso, endDate: endIso, employeeId: API_EMPLOYEE_ID });
  const res = await page.request.get(`/api/appointments?${params}`);
  const body = await res.text();
  expect(res.status(), `lista wizyt w terminie: ${body}`).toBe(200);
  const list = (JSON.parse(body) as { data?: ApiAppointment[] }).data ?? [];
  const headers = await csrfHeaders(page);
  for (const a of list) {
    if (a.status === 'cancelled') continue;
    if (a.status === 'no_show') {
      const undo = await page.request.delete(`/api/appointments/${a.id}/no-show`, { headers });
      expect(undo.status(), `cofnięcie pozostałości ${a.id}: ${await undo.text()}`).toBe(200);
    }
    const del = await page.request.delete(`/api/appointments/${a.id}`, { headers });
    expect(del.status(), `anulowanie pozostałości ${a.id}: ${await del.text()}`).toBe(200);
  }
}

async function apiStatus(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`/api/appointments/${id}`);
  const body = await res.text();
  expect(res.status(), `odczyt wizyty: ${body}`).toBe(200);
  return (JSON.parse(body) as { data: ApiAppointment }).data.status;
}

test.describe('Nie przyszedł', () => {
  test.use({ timezoneId: 'Europe/Warsaw' });

  let appointmentId: string | null = null;

  test.afterEach(async ({ page }) => {
    const id = appointmentId;
    appointmentId = null;
    if (!id) return;
    const headers = await csrfHeaders(page);
    // Gdy test przerwał się po oznaczeniu: najpierw cofnięcie, potem anulowanie.
    // Wiersz usuwa globalTeardown po znaczniku [E2E] w notes.
    await page.request.delete(`/api/appointments/${id}/no-show`, { headers });
    const res = await page.request.delete(`/api/appointments/${id}`, { headers });
    expect.soft(res.status(), `sprzątanie: anulowanie wizyty ${id}: ${await res.text()}`).toBe(200);
  });

  test('oznaczenie i cofnięcie w szczegółach wizyty', { tag: '@full' }, async ({ page }) => {
    await page.goto('/dashboard/calendar');
    await page.waitForLoadState('domcontentloaded');

    const startIso = await page.evaluate((l) => new Date(l).toISOString(), `${yesterdayInWarsaw()}T${NO_SHOW_TIME}:00`);
    const endIso = new Date(new Date(startIso).getTime() + 60 * 60000).toISOString();
    await freeSlot(page, startIso, endIso);

    const created = await page.request.post('/api/appointments', {
      headers: await csrfHeaders(page),
      data: {
        salonId: SALON_ID, employeeId: API_EMPLOYEE_ID, clientId: SEED_CLIENT_ID, serviceId: SEED_SERVICE_ID,
        startTime: startIso, endTime: endIso, notes: NOTES,
      },
    });
    const createdBody = await created.text();
    expect(created.status(), `założenie wizyty przez API: ${createdBody}`).toBe(201);
    const id = (JSON.parse(createdBody) as { data: { id: string } }).data.id;
    appointmentId = id;

    await page.goto(`/dashboard/appointments/${id}`);
    await page.waitForLoadState('domcontentloaded');

    // Przycisk pojawia się po hydracji i pobraniu wizyty.
    const markBtn = page.getByTestId('no-show-mark-btn');
    await expect(markBtn).toBeVisible({ timeout: 30000 });
    await markBtn.click();

    const undoBtn = page.getByTestId('no-show-undo-btn');
    await expect(undoBtn).toBeVisible({ timeout: 15000 });
    await expect(markBtn).toBeHidden();
    // Status w karcie wizyty (przycisk cofnięcia ma inną nazwę).
    await expect(page.getByText('Nie przyszedł', { exact: true })).toBeVisible();
    expect(await apiStatus(page, id)).toBe('no_show');

    await undoBtn.click();
    await expect(markBtn).toBeVisible({ timeout: 15000 });
    await expect(undoBtn).toBeHidden();
    expect(await apiStatus(page, id)).toBe('scheduled');
  });
});
