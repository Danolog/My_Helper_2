import { test, expect, type Page } from '../fixtures';
import { e2eNotes } from '../e2e-cleanup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function navigateToCalendar(page: Page) {
  await page.goto('/dashboard/calendar');
  await page.waitForLoadState('domcontentloaded');
  // Wait for calendar to fully load — either the appointment button appears
  // or the empty state ("Brak pracownikow") or the time grid renders
  await expect(
    page.getByTestId('new-appointment-btn')
      .or(page.getByText(/brak pracownik/i).first())
      .or(page.locator('[class*="time-grid"], [class*="calendar"]').first())
      .first()
  ).toBeVisible({ timeout: 30000 });
}

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const SEED_CLIENT_ID = '00000000-0000-4000-8000-c10000000001'; // Maria Kaczmarek
const SEED_SERVICE_ID = '00000000-0000-4000-8000-5e0000000001'; // Strzyzenie damskie, 60 min
const SCHEDULED_EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000003'; // Ewa Zadatkowa, grafik 08:00-20:00
const APPOINTMENT_TIME = '19:00';
// Wizyty zakladane przez API w testach widoku: Marta Nowak (bez grafiku —
// POST go nie sprawdza), zeby nie wchodzic w terminy Ewy, ktore spec zadatku
// (tests/client-portal/) bierze rownolegle jako "pierwszy wolny". Godziny
// 08/10/12/14 z przerwa: od #165 kolizja jest polotwarta [start, end), wiec
// wizyty stykajace sie nie koliduja; przerwa zostaje, zeby wizyty nie lezaly
// obok siebie na siatce (#175: wczesniejszy komentarz mowil o kolizji z granica).
const API_EMPLOYEE_ID = '00000000-0000-4000-8000-e00000000002'; // Marta Nowak

function tomorrowInWarsaw(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // YYYY-MM-DD
}

/**
 * Radix Select: otwiera trigger po data-testid i wybiera opcje po nazwie.
 * Portal z opcjami bywa poza viewportem CI (klik nie dochodzi) — fokus + Enter.
 */
async function selectOption(page: Page, triggerTestId: string, name: RegExp) {
  await page.getByTestId(triggerTestId).click();
  const option = page.getByRole('option', { name });
  await expect(option, `opcja ${name} w ${triggerTestId} (dane z seeda)`).toHaveCount(1, { timeout: 10000 });
  await option.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const token = (await page.context().cookies()).find((c) => c.name === 'csrf-token')?.value ?? '';
  return { 'x-csrf-token': decodeURIComponent(token) };
}

/** Czas lokalny (kontekst testu = Europe/Warsaw) -> ISO, liczone w przegladarce. */
async function localToIso(page: Page, local: string): Promise<string> {
  return page.evaluate((l) => new Date(l).toISOString(), local);
}

type ApiAppointment = { id: string; status: string; startTime: string; endTime: string };

/**
 * Anuluje aktywne wizyty pracownika nachodzace na [startIso, endIso) —
 * pozostalosc po przerwanym przebiegu (afterEach sie nie wykonal) dawalaby
 * 409 przy kolejnym zapisie w tym terminie (uwaga Leo do #107).
 */
async function cancelActiveInSlot(page: Page, employeeId: string, startIso: string, endIso: string) {
  const params = new URLSearchParams({ salonId: SALON_ID, startDate: startIso, endDate: endIso, employeeId });
  const res = await page.request.get(`/api/appointments?${params}`);
  const body = await res.text();
  expect(res.status(), `lista wizyt w terminie: ${body}`).toBe(200);
  const list = (JSON.parse(body) as { data?: ApiAppointment[] }).data ?? [];
  const headers = await csrfHeaders(page);
  for (const a of list) {
    if (a.status === 'cancelled') continue;
    const del = await page.request.delete(`/api/appointments/${a.id}`, { headers });
    expect(del.status(), `anulowanie pozostalosci ${a.id}: ${await del.text()}`).toBe(200);
  }
}

/** Wizyta przez API: Maria Kaczmarek, "Strzyzenie damskie" (60 min), Marta Nowak, jutro o `time`. */
async function createAppointmentViaApi(page: Page, time: string): Promise<string> {
  const startIso = await localToIso(page, `${tomorrowInWarsaw()}T${time}:00`);
  const endIso = new Date(new Date(startIso).getTime() + 60 * 60000).toISOString();
  await cancelActiveInSlot(page, API_EMPLOYEE_ID, startIso, endIso);
  const res = await page.request.post('/api/appointments', {
    headers: await csrfHeaders(page),
    data: {
      salonId: SALON_ID, employeeId: API_EMPLOYEE_ID, clientId: SEED_CLIENT_ID, serviceId: SEED_SERVICE_ID,
      startTime: startIso, endTime: endIso,
      // Znacznik #175: globalTeardown usuwa wiersz twardo (DELETE w aplikacji tylko anuluje).
      notes: e2eNotes('kalendarz API'),
    },
  });
  const body = await res.text();
  expect(res.status(), `zalozenie wizyty przez API: ${body}`).toBe(201);
  return (JSON.parse(body) as { data: { id: string } }).data.id;
}

/** Naglowek widoku dnia (h2 w calendar-grid) dla dzis + offsetDays, sformatowany jak w aplikacji. */
async function expectDayHeader(page: Page, offsetDays: number) {
  const label = await page.evaluate((days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }, offsetDays);
  await expect(page.locator('h2.capitalize')).toHaveText(label, { timeout: 10000 });
}

/**
 * Nawigacja kalendarza. Strzalki to same ikony bez nazwy dostepnej — stary
 * test szukal nazw "next"/">"/"prev"/"<", nigdy ich nie znajdowal, a warunek
 * `if (isVisible)` pomijal cala nawigacje. Lokalizujemy je obok "Dzisiaj".
 */
function navButtons(page: Page) {
  const today = page.getByRole('button', { name: 'Dzisiaj', exact: true });
  return {
    today,
    prev: today.locator('xpath=preceding-sibling::button[1]'),
    next: today.locator('xpath=following-sibling::button[1]'),
  };
}

function viewButtons(page: Page) {
  return {
    day: page.getByRole('button', { name: 'Dzien', exact: true }),
    week: page.getByRole('button', { name: 'Tydzien', exact: true }),
  };
}

/** Kalendarz na jutrze z widoczna wizyta `id`. */
async function openTomorrowWithEvent(page: Page, id: string) {
  await navigateToCalendar(page);
  await navButtons(page).next.click();
  await expectDayHeader(page, 1);
  const event = page.locator(`[data-event-id="${id}"]`);
  await expect(event, `wizyta ${id} na jutrzejszym kalendarzu`).toBeVisible({ timeout: 15000 });
  return event;
}

// ---------------------------------------------------------------------------
// Flow 4: Appointment System (P0)
// ---------------------------------------------------------------------------

test.describe('Flow 4: Appointment System', () => {
  // Auth handled by storageState — no login needed
  test.use({ timezoneId: 'Europe/Warsaw' });

  // Sprzatanie: wizyty utworzone w tescie sa anulowane (DELETE = status
  // "cancelled"; termin wraca do puli, kolizje pomijaja anulowane). Wiersze
  // usuwa globalTeardown po znaczniku [E2E] w notes (#175, tests/e2e-cleanup.ts).
  let createdAppointmentIds: string[] = [];
  test.afterEach(async ({ page }) => {
    const ids = createdAppointmentIds;
    createdAppointmentIds = [];
    if (ids.length === 0) return;
    const headers = await csrfHeaders(page);
    for (const id of ids) {
      const res = await page.request.delete(`/api/appointments/${id}`, { headers });
      expect(res.status(), `sprzatanie: anulowanie wizyty ${id}: ${await res.text()}`).toBe(200);
    }
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  test.describe('Happy path', () => {
    test('should display calendar page with controls', { tag: '@smoke' }, async ({ page }) => {
      await navigateToCalendar(page);
      // Calendar page should show controls or empty state
      await expect(
        page.getByTestId('new-appointment-btn')
          .or(page.getByText(/kalendarz|calendar/i).first())
          .first()
      ).toBeVisible({ timeout: 10000 });
    });

    test('should open new appointment dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('new-appointment-btn').click();
      const dialog = page.getByTestId('new-appointment-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await expect(dialog.getByRole('heading', { name: 'Nowa wizyta' })).toBeVisible();
      for (const id of ['client-select', 'service-select', 'employee-select', 'appointment-date-input', 'appointment-time-input']) {
        await expect(dialog.getByTestId(id), id).toBeVisible();
      }

      await dialog.getByTestId('cancel-appointment-btn').click();
      await expect(dialog).toBeHidden();
    });

    test('should create a new appointment', { tag: '@full' }, async ({ page }) => {
      // Realny zapis z dialogu (#105 cz. 1). Poprzednia wersja byla w warunkach
      // `if (await x.isVisible())`, ktore nie czekaja: gdy dialog jeszcze sie nie
      // otworzyl, test konczyl sie zielono bez zadnej akcji, a gdy zdazyl —
      // klikal zawsze zablokowany przycisk (nie ustawial pracownika ani godziny).
      //
      // Dane z seeda: klientka Maria Kaczmarek, usluga "Strzyzenie damskie"
      // (60 min, bez zadatku), Ewa Zadatkowa (grafik 7 dni 08:00-20:00).
      // Jutro 19:00-20:00 — w grafiku i poza pierwszym wolnym terminem, ktory
      // bierze spec zadatku (tests/client-portal/) dla tej samej pracowniczki.
      await navigateToCalendar(page);
      const date = tomorrowInWarsaw();
      const expectedStart = await localToIso(page, `${date}T${APPOINTMENT_TIME}:00`);
      await cancelActiveInSlot(
        page, SCHEDULED_EMPLOYEE_ID, expectedStart,
        new Date(new Date(expectedStart).getTime() + 60 * 60000).toISOString()
      );

      await page.getByTestId('new-appointment-btn').click();

      const dialog = page.getByTestId('new-appointment-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await selectOption(page, 'client-select', /^Maria Kaczmarek/);
      await selectOption(page, 'service-select', /^Strzyzenie damskie - /);
      await selectOption(page, 'employee-select', /Ewa Zadatkowa/);

      await dialog.getByTestId('appointment-date-input').fill(date);
      await dialog.getByTestId('appointment-time-input').fill(APPOINTMENT_TIME);
      // Znacznik #175 przez prawdziwe pole formularza: globalTeardown usuwa wizyte twardo.
      await dialog.getByTestId('appointment-notes-input').fill(e2eNotes('formularz Nowa wizyta'));

      const saveBtn = dialog.getByTestId('save-appointment-btn');
      await expect(saveBtn).toBeEnabled({ timeout: 10000 });

      const responsePromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/appointments',
        { timeout: 15000 }
      );
      await saveBtn.click();
      const res = await responsePromise;
      const body = await res.text();
      // Status przed parsowaniem (uwaga Leo do #107): odpowiedz 500 w HTML ma
      // pokazac tresc, a nie blad JSON.parse.
      expect(res.status(), `POST /api/appointments: ${body}`).toBe(201);
      const appointmentId = (JSON.parse(body) as { data: { id: string } }).data.id;
      createdAppointmentIds.push(appointmentId);

      await expect(dialog).toBeHidden({ timeout: 10000 });

      // Zapis w bazie z danymi z formularza
      const getRes = await page.request.get(`/api/appointments/${appointmentId}`);
      expect(getRes.status()).toBe(200);
      const saved = (await getRes.json()).data as {
        clientId: string; serviceId: string; employeeId: string; startTime: string; endTime: string; status: string; notes: string | null;
      };
      expect(saved).toMatchObject({
        notes: e2eNotes('formularz Nowa wizyta'),
        clientId: SEED_CLIENT_ID,
        serviceId: SEED_SERVICE_ID,
        employeeId: SCHEDULED_EMPLOYEE_ID,
        status: 'scheduled',
      });
      expect(new Date(saved.startTime).toISOString()).toBe(expectedStart);
      expect(new Date(saved.endTime).getTime() - new Date(saved.startTime).getTime()).toBe(60 * 60000);
    });

    test('should filter calendar by employee', { tag: '@full' }, async ({ page }) => {
      const id = await createAppointmentViaApi(page, '08:00');
      createdAppointmentIds.push(id);
      const event = await openTomorrowWithEvent(page, id);

      // Filtr na inna pracowniczke: wizyta Marty znika z siatki
      await selectOption(page, 'employee-filter', /^Ewa Zadatkowa$/);
      await expect(page.getByTestId('employee-filter')).toContainText('Ewa Zadatkowa');
      await expect(event).toHaveCount(0);

      // Filtr na Marte: wraca
      await selectOption(page, 'employee-filter', /^Marta Nowak$/);
      await expect(event).toBeVisible();

      // Wszyscy: nadal widoczna
      await selectOption(page, 'employee-filter', /^Wszyscy pracownicy$/);
      await expect(event).toBeVisible();

      // Widok tygodnia: kolumny to dni, nie pracownicy, wiec wizyte chowa tylko
      // filtr wizyt (w widoku dnia znika razem z kolumna pracownika — sam filtr
      // wizyt byl tam nieobserwowalny, mutant przezywal; pomiar run-105c).
      await viewButtons(page).week.click();
      await expect(event).toBeVisible();
      await selectOption(page, 'employee-filter', /^Ewa Zadatkowa$/);
      await expect(event).toHaveCount(0);
      await selectOption(page, 'employee-filter', /^Wszyscy pracownicy$/);
      await expect(event).toBeVisible();
    });

    test('should switch between day and week view', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const { day, week } = viewButtons(page);
      await expect(day).toHaveAttribute('data-variant', 'default');
      await expectDayHeader(page, 0);

      await week.click();
      await expect(week).toHaveAttribute('data-variant', 'default');
      await expect(day).toHaveAttribute('data-variant', 'ghost');
      // Widok tygodnia: naglowek to zakres "d mmm - d mmm rrrr"
      await expect(page.locator('h2.capitalize')).toHaveText(/^\d{1,2} \S+ - \d{1,2} \S+ \d{4}$/);

      await day.click();
      await expect(day).toHaveAttribute('data-variant', 'default');
      await expectDayHeader(page, 0);
    });

    test('should navigate between days', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const nav = navButtons(page);
      await expectDayHeader(page, 0);

      await nav.next.click();
      await expectDayHeader(page, 1);

      await nav.prev.click();
      await nav.prev.click();
      await expectDayHeader(page, -1);

      await nav.today.click();
      await expectDayHeader(page, 0);
    });

    test('should open block time dialog', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('block-time-btn').click();
      await expect(page.getByTestId('block-time-dialog')).toBeVisible({ timeout: 10000 });
    });

    test('should navigate to booking page', { tag: '@full' }, async ({ page }) => {
      await page.goto('/dashboard/booking');
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should view appointment details', { tag: '@full' }, async ({ page }) => {
      const id = await createAppointmentViaApi(page, '10:00');
      createdAppointmentIds.push(id);
      const event = await openTomorrowWithEvent(page, id);
      await expect(event).toHaveAttribute('data-status', 'scheduled');

      // Prawdziwy klik. Anulowane wizyty z poprzednich przebiegow w tym samym
      // terminie sa nadal rysowane, ale warstwe nizej (#164) — klik trafia w aktywna.
      await event.click();
      await expect(page.getByText('Klient: Maria Kaczmarek | Status: Zaplanowana')).toBeVisible({ timeout: 10000 });
    });

    test('should open details of a cancelled appointment by click', { tag: '@full' }, async ({ page }) => {
      // Anulowana wizyta jest warstwe nizej niz aktywna, ale sama w terminie ma
      // dalej przyjmowac klikniecie (granica jsdom z #173: pointer-events nie da
      // sie sprawdzic w testach jednostkowych).
      const id = await createAppointmentViaApi(page, '16:00');
      const del = await page.request.delete(`/api/appointments/${id}`, { headers: await csrfHeaders(page) });
      expect(del.status(), `anulowanie wizyty ${id}: ${await del.text()}`).toBe(200);
      const event = await openTomorrowWithEvent(page, id);
      await expect(event).toHaveAttribute('data-status', 'cancelled');

      // Klik myszy w srodek wizyty, nie locator.click(): anulowane z poprzednich
      // przebiegow leza w tym samym miejscu i ktoras z nich moze byc na wierzchu
      // (Playwright odmowilby kliku "intercepts pointer events"). Trafienie
      // w dowolna z nich daje te same szczegoly; aktywnych w tym terminie nie ma
      // (16:00 zaklada tylko ten test, a createAppointmentViaApi anuluje pozostalosci).
      // mouse.click nie przewija strony (16:00 jest ponizej pierwszego ekranu).
      await event.scrollIntoViewIfNeeded();
      const box = await event.boundingBox();
      expect(box, `polozenie wizyty ${id}`).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await expect(page.getByText('Klient: Maria Kaczmarek | Status: Anulowana').first()).toBeVisible({ timeout: 10000 });
    });

    test('should stack an active appointment above a cancelled one in the same slot', { tag: '@full' }, async ({ page }) => {
      // Wlasna para (#164): anulowana C i aktywna A w tym samym terminie, bez
      // polegania na resztkach z poprzednich przebiegow. 18:00 u Marty zaklada
      // tylko ten test (16:00-17:00 z testu wyzej nie koliduje: od #165 kolizja
      // jest polotwarta [start, end); 18:00 zostawia odstep na siatce).
      // Resztki (anulowane C z poprzednich przebiegow) nie zmieniaja wyniku:
      // asercja dotyczy tylko warstw A i tej C, a anulowane sa zawsze pod aktywna.
      const cancelledId = await createAppointmentViaApi(page, '18:00');
      const del = await page.request.delete(`/api/appointments/${cancelledId}`, { headers: await csrfHeaders(page) });
      expect(del.status(), `anulowanie wizyty ${cancelledId}: ${await del.text()}`).toBe(200);
      const activeId = await createAppointmentViaApi(page, '18:00');
      createdAppointmentIds.push(activeId);

      const active = await openTomorrowWithEvent(page, activeId);
      const cancelled = page.locator(`[data-event-id="${cancelledId}"]`);
      await expect(cancelled).toHaveAttribute('data-status', 'cancelled');
      await expect(active).toHaveAttribute('data-status', 'scheduled');

      // Warstwa = pozycjonowany rodzic [data-event-id] rysowany przez siatke.
      // Prawdziwy CSS w przegladarce (w jsdom Tailwind nie dziala).
      const zIndexOfLayer = (el: Element) => Number(getComputedStyle(el.parentElement!).zIndex);
      const activeZ = await active.evaluate(zIndexOfLayer);
      const cancelledZ = await cancelled.evaluate(zIndexOfLayer);
      expect(activeZ, `z-index warstwy aktywnej (${activeZ}) nad anulowana (${cancelledZ})`).toBeGreaterThan(cancelledZ);

      // Sciezka uzytkownika: klik w tym terminie trafia w aktywna.
      await active.click();
      await expect(page.getByText('Klient: Maria Kaczmarek | Status: Zaplanowana')).toBeVisible({ timeout: 10000 });
    });
  });

  // ── Error path ──────────────────────────────────────────────────────────

  test.describe('Error path', () => {
    test('should prevent creating appointment without required fields', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      await page.getByTestId('new-appointment-btn').click();
      const dialog = page.getByTestId('new-appointment-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      const saveBtn = dialog.getByTestId('save-appointment-btn');

      // Bez pracownika i godziny: zapis zablokowany
      await expect(saveBtn).toBeDisabled();

      // Pracownik bez godziny: nadal zablokowany
      await selectOption(page, 'employee-select', /Ewa Zadatkowa/);
      await dialog.getByTestId('appointment-date-input').fill(tomorrowInWarsaw());
      await dialog.getByTestId('appointment-time-input').fill('');
      await expect(saveBtn).toBeDisabled();

      // Kontrola pozytywna: komplet pol odblokowuje zapis (inaczej "disabled"
      // mogloby znaczyc zawsze zablokowany przycisk). Bez klikniecia zapisu.
      await dialog.getByTestId('appointment-time-input').fill(APPOINTMENT_TIME);
      await expect(saveBtn).toBeEnabled();

      await dialog.getByTestId('cancel-appointment-btn').click();
      await expect(dialog).toBeHidden();
    });

    test('should handle calendar page without appointments', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      // Should display calendar grid even with no appointments
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should prevent access to calendar without auth', { tag: '@full' }, async ({ browser }) => {
      // Kontekst bez sesji. Uwaga: browser.newContext() w Playwright Test dziedziczy
      // storageState z `use` projektu — bez jawnego pustego stanu test byl
      // zalogowany (stary if/else na URL to maskowal).
      const newContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const newPage = await newContext.newPage();
      try {
        await newPage.goto('/dashboard/calendar');
        await expect(newPage).toHaveURL(/\/login\?returnTo=%2Fdashboard%2Fcalendar$/);
        await expect(newPage.getByTestId('new-appointment-btn')).toHaveCount(0);
      } finally {
        await newContext.close();
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  test.describe('Edge cases', () => {
    test('should handle rapid view switching', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const { day, week } = viewButtons(page);
      for (let i = 0; i < 5; i++) {
        await week.click();
        await day.click();
      }
      await expect(day).toHaveAttribute('data-variant', 'default');
      await expect(week).toHaveAttribute('data-variant', 'ghost');
      await expectDayHeader(page, 0);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should handle rapid date navigation', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      const { next } = navButtons(page);
      for (let i = 0; i < 10; i++) {
        await next.click();
      }
      await expectDayHeader(page, 10);
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });

    test('should display appointment cancel dialog', { tag: '@full' }, async ({ page }) => {
      const id = await createAppointmentViaApi(page, '12:00');
      createdAppointmentIds.push(id);
      const event = await openTomorrowWithEvent(page, id);

      // Prawdziwy klik na przycisku ✕ (anulowane pozostalosci leza warstwe nizej, #164).
      const cancelBtn = event.getByTestId('cancel-event-btn');
      await expect(cancelBtn).toHaveCount(1);
      await cancelBtn.click();
      const dialog = page.getByTestId('cancel-appointment-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      // Zamkniecie bez potwierdzenia nie zmienia statusu
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(event).toHaveAttribute('data-status', 'scheduled');

      // Enter na przycisku ✕ otwiera dialog anulowania, nie szczegoly wizyty (#164)
      await cancelBtn.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Klient: Maria Kaczmarek | Status: Zaplanowana')).toHaveCount(0);
      await expect(event).toHaveAttribute('data-status', 'scheduled');
    });

    test('should display complete appointment dialog', { tag: '@full' }, async ({ page }) => {
      const id = await createAppointmentViaApi(page, '14:00');
      createdAppointmentIds.push(id);
      const event = await openTomorrowWithEvent(page, id);

      // Prawdziwy klik na przycisku ✓ (jak w tescie dialogu anulowania).
      const completeBtn = event.getByTestId('complete-event-btn');
      await expect(completeBtn).toHaveCount(1);
      await completeBtn.click();
      const dialog = page.getByTestId('complete-appointment-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(event).toHaveAttribute('data-status', 'scheduled');

      // Enter na przycisku ✓ otwiera dialog zakonczenia, nie szczegoly wizyty (#164)
      await completeBtn.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Klient: Maria Kaczmarek | Status: Zaplanowana')).toHaveCount(0);
      await expect(event).toHaveAttribute('data-status', 'scheduled');
    });

    test('should handle calendar with multiple employee colors', { tag: '@full' }, async ({ page }) => {
      await navigateToCalendar(page);
      // Calendar should render without errors even with multiple employees
      await expect(page.locator('body')).not.toContainText(/Internal Server Error/i);
    });
  });
});
