/**
 * POST /api/deposits/blik-booking — rezerwacja z zadatkiem płatnym BLIK-iem
 * na telefon salonu.
 *
 * Trasa: limit IP → schemat → termin nie w przeszłości → gość/sesja →
 * przynależność refów → kwota z serwera → salon z długością usługi (długość
 * wizyty = usługa + wariant) → numer BLIK salonu → kolizja i blokady → zapis wizyty
 * `scheduled/false` (bez wiersza `deposit_payments`) w transakcji forSalon.
 *
 * Wiersze-fikstury przechodzą przez WHERE trasy (prawdziwy drizzle,
 * `sqlMatches`), więc test pilnuje też znaczenia predykatów: salon, pracownik,
 * przedział półotwarty. Po KAŻDYM teście argumenty wywołań atrapy loggera
 * (z treścią obiektów `Error`: message, stack, cause) nie zawierają cyfr
 * testowego numeru BLIK salonu ani telefonu gościa w zapisach użytych w testach.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// vi.mock niżej jest wynoszony nad importy — trasa ładuje się już z atrapami.
import { POST } from "@/app/api/deposits/blik-booking/route";
import { appointments, depositPayments } from "@/lib/schema";
import { SMS_PROVIDER_UNAVAILABLE_ERROR, SMS_SEND_FAILED_ERROR, SMS_TEST_PHONE_ERROR } from "@/lib/sms";
import { TEST_PHONE } from "@/lib/test-phone";
import { deadlock, wrapped } from "./deadlock-fixture";
import { createChainMock, createMockRequest, parseResponse } from "./helpers";
import { sqlMatches } from "./sql-predicate";

const SALON = "11111111-1111-4111-8111-111111111111";
const OTHER_SALON = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE = "22222222-2222-4222-8222-999999999999";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const SERVICE = "44444444-4444-4444-8444-444444444444";
const VARIANT = "55555555-5555-4555-8555-555555555555";
const APPOINTMENT = "a1b2c3d4-6666-4666-8666-666666666666";

// Wyłącznie numery testowe (src/lib/test-phone.ts).
const BLIK_PHONE = "+48000600703";
const SALON_PHONE = "+48000600704";
const GUEST_PHONE_E164 = "+48000600700";
const SALON_NAME = "Salon Testowy";

const SERVICE_UNAVAILABLE = "Wybrana usluga nie jest juz dostepna. Odswiez strone i wybierz ponownie.";
const VARIANT_UNAVAILABLE = "Wybrany wariant uslugi nie jest juz dostepny. Odswiez strone i wybierz ponownie.";
const PAST_START_MESSAGE = "Wybrany termin juz minal. Wybierz inny termin.";

const h = vi.hoisted(() => ({
  /** Wyniki kolejnych select w transakcjach forSalon (każdy filtrowany przez WHERE). */
  queue: [] as Record<string, unknown>[][],
  /** Argument każdego tx.select(...) — jawna lista kolumn. */
  selectArgs: [] as unknown[],
  selectCalls: 0,
  /** Numer wywołania select, które rzuca (0 = żadne). */
  failAt: 0,
  insert: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  insertResult: [] as Record<string, unknown>[],
  insertError: null as unknown,
  forSalon: vi.fn(),
  raw: vi.fn(),
  dbTouched: vi.fn(),
  session: vi.fn(),
  salonCtx: vi.fn(),
  refs: vi.fn(),
  calc: vi.fn(),
  rate: vi.fn(),
  sms: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function filteringChain(rows: Record<string, unknown>[]) {
  const c = createChainMock([]);
  let where: unknown;
  c.where = vi.fn((w: unknown) => {
    where = w;
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown) =>
    resolve(where === undefined ? rows : rows.filter((r) => sqlMatches(where as Parameters<typeof sqlMatches>[0], r)));
  return c;
}

function insertChain() {
  const c: Record<string, unknown> = {};
  c.values = vi.fn((v: unknown) => {
    h.insertValues(v);
    return c;
  });
  c.returning = vi.fn((cols: unknown) => {
    h.insertReturning(cols);
    return c;
  });
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    h.insertError ? reject(h.insertError) : resolve(h.insertResult);
  return c;
}

vi.mock("@/lib/server/repository", () => {
  const tx = {
    select: (cols?: unknown) => {
      h.selectArgs.push(cols);
      h.selectCalls++;
      if (h.failAt === h.selectCalls) throw new Error("db down");
      return filteringChain(h.queue.shift() ?? []);
    },
    insert: (table: unknown) => {
      h.insert(table);
      return insertChain();
    },
  };
  return {
    forSalon: (salonId: string) => {
      h.forSalon(salonId);
      return {
        raw: (fn: (t: typeof tx) => unknown) => {
          h.raw(salonId);
          return Promise.resolve().then(() => fn(tx));
        },
      };
    },
  };
});

// Trasa nie importuje surowego db — każde dotknięcie atrapy jest błędem testu.
vi.mock("@/lib/db", () => {
  const touched = (..._a: unknown[]) => {
    h.dbTouched();
    throw new Error("surowe db w trasie blik-booking");
  };
  return { db: { select: touched, insert: touched, update: touched, delete: touched, transaction: touched } };
});
vi.mock("@/lib/session", () => ({ getOptionalSession: (...a: unknown[]) => h.session(...a) }));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: (...a: unknown[]) => h.refs(...a) }));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: (...a: unknown[]) => h.rate(...a) },
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
// Argumenty atrapy SMS nie są logami — strażnik prywatności ich nie sprawdza.
// Atrapa częściowa: stałe błędów SMS prawdziwe, bo trasa porównuje z nimi wynik.
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendBlikDepositBookingSms: (...a: unknown[]) => h.sms(...a),
}));

/** Zegar testu: termin `validBody` (10:00–11:00 tego dnia) jest w przyszłości. */
const NOW = new Date("2026-12-01T09:00:00.000Z");
const MINUTE_MS = 60_000;

const at = (hm: string) => new Date(`2026-12-01T${hm}:00.000Z`);
const iso = (hm: string) => at(hm).toISOString();
/** Chwila przesunięta względem NOW o podaną liczbę ms, jako ISO z `Z`. */
const isoFromNow = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

const GUEST = { guestName: "Jan Testowy", guestPhone: TEST_PHONE };
const validBody = {
  salonId: SALON,
  employeeId: EMPLOYEE,
  serviceId: SERVICE,
  startTime: iso("10:00"),
  endTime: iso("11:00"),
  depositAmount: 50,
  ...GUEST,
};

/**
 * Wiersz salonu (WHERE po `id`) z poddrzewem `deposits.blikPhone` i długością
 * usługi z joinu (60 min = `validBody` 10:00–11:00, bez wariantu).
 */
const salonRow = (blikPhone: unknown = BLIK_PHONE, phone: string | null = SALON_PHONE) => ({
  id: SALON,
  name: SALON_NAME,
  phone,
  blikPhone,
  serviceDuration: 60 as number | null,
  variantRowId: null as string | null,
  variantDurationModifier: null as number | null,
});
/** Wizyta w nazwach kolumn bazy (WHERE kolizji). */
const appt = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  salon_id: SALON,
  employee_id: EMPLOYEE,
  status: "scheduled",
  start_time: at(start),
  end_time: at(end),
  ...extra,
});
/** Blokada czasu: `salon_id` to salon pracownika z joinu employees. */
const block = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  employee_id: EMPLOYEE,
  salon_id: SALON,
  start_time: at(start),
  end_time: at(end),
  ...extra,
});

function post(body: unknown = validBody) {
  return POST(createMockRequest("http://localhost:3000/api/deposits/blik-booking", { method: "POST", body }));
}

type Ok = {
  success: true;
  data: {
    appointmentId: string;
    startTime: string;
    endTime: string;
    depositAmount: number;
    blik: { phone: string; recipient: string; title: string };
    status: string;
    depositPaid: boolean;
  };
};
type Err = { success: false; error: string; code?: string; details?: Record<string, string> };

/**
 * Szczegóły do SMS (WHERE po `appointments.id` i `appointments.salon_id`):
 * wiersz wizyty z kolumnami z joinów klienta, usługi i pracownika.
 */
const detailsRow = (extra: Record<string, unknown> = {}) => ({
  id: APPOINTMENT,
  salon_id: SALON,
  clientFirstName: null,
  clientPhone: null,
  serviceName: "Strzyzenie",
  employeeFirstName: "Anna",
  employeeLastName: "Testowa",
  ...extra,
});

/** Kolejka zapytań ścieżki szczęśliwej: salon, kolizje, blokady, szczegóły do SMS. */
function primeHappyPath(details: Record<string, unknown>[] = [detailsRow()]) {
  h.queue.push([salonRow()], [], [], details);
}

const insertedTables = () => h.insert.mock.calls.map((c) => c[0]);

beforeEach(() => {
  // Stały zegar: bez niego terminy z 2026-12-01 stałyby się przeszłością.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  h.queue.length = 0;
  h.selectArgs.length = 0;
  h.selectCalls = 0;
  h.failAt = 0;
  h.insertError = null;
  h.insertResult = [
    {
      id: APPOINTMENT,
      startTime: at("10:00"),
      endTime: at("11:00"),
      status: "scheduled",
      depositPaid: false,
    },
  ];
  h.session.mockResolvedValue(null);
  h.salonCtx.mockResolvedValue(null);
  h.refs.mockResolvedValue(null);
  h.calc.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
  h.rate.mockReturnValue({ success: true, remaining: 4, reset: 60_000 });
  h.sms.mockResolvedValue({ success: true, notificationId: "notif-1" });
});

const PRIVATE_DIGITS = ["000600703", "000600700", "000 600 700", "000600701", "000600705"];

/**
 * Argumenty logów jako tekst. Sam `JSON.stringify(new Error(...))` daje `{}`,
 * a prawdziwy logger zachowuje treść błędu — replacer ją przenosi.
 */
function serializeLogCalls(calls: unknown[][]): string {
  return JSON.stringify(calls, (_k, v: unknown) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack, cause: v.cause } : v
  );
}

// Prywatność: po każdym teście żaden log nie zawiera numeru BLIK ani telefonu gościa.
afterEach(() => {
  const logged = serializeLogCalls(Object.values(h.logger).flatMap((fn) => fn.mock.calls));
  for (const digits of PRIVATE_DIGITS) {
    expect(logged, `log zawiera ${digits}`).not.toContain(digits);
  }
  expect(h.dbTouched).not.toHaveBeenCalled();
  // Nigdy, w żadnej ścieżce, wiersz płatności zadatku.
  expect(insertedTables()).not.toContain(depositPayments);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Kontrola strażnika logów ───────────────────────────────────────────────

describe("strażnik prywatności logów", () => {
  it("log z obiektem Error, którego message zawiera numer, zostałby wykryty", () => {
    const calls = [["[BlikBooking] failed", { error: new Error(`params: ${BLIK_PHONE}`) }]];
    // Bez replacera treść błędu ginie — strażnik byłby ślepy.
    expect(JSON.stringify(calls)).not.toContain("000600703");
    const logged = serializeLogCalls(calls);
    expect(PRIVATE_DIGITS.filter((d) => logged.includes(d))).toEqual(["000600703"]);
  });

  it("numer w cause błędu też zostałby wykryty", () => {
    const calls = [["x", Object.assign(new Error("db"), { cause: new Error(`params: ${GUEST_PHONE_E164}`) })]];
    expect(serializeLogCalls(calls)).toContain("000600700");
  });
});

// ─── 201 ────────────────────────────────────────────────────────────────────

describe("201 — wizyta scheduled/false z danymi BLIK", () => {
  it("gość: kwota serwerowa, numer i nazwa salonu, tytuł przelewu; zapis tylko wizyty", async () => {
    primeHappyPath();
    const { status, body } = await parseResponse<Ok>(await post());

    expect(status).toBe(201);
    expect(body).toEqual({
      success: true,
      data: {
        appointmentId: APPOINTMENT,
        startTime: iso("10:00"),
        endTime: iso("11:00"),
        depositAmount: 50,
        blik: { phone: BLIK_PHONE, recipient: SALON_NAME, title: "Zadatek MH-A1B2C3" },
        status: "scheduled",
        depositPaid: false,
      },
    });

    expect(insertedTables()).toEqual([appointments]);
    expect(h.insertValues).toHaveBeenCalledTimes(1);
    expect(h.insertValues.mock.calls[0]![0]).toMatchObject({
      salonId: SALON,
      employeeId: EMPLOYEE,
      serviceId: SERVICE,
      variantId: null,
      clientId: null,
      bookedByUserId: null,
      status: "scheduled",
      depositPaid: false,
      depositAmount: "50",
      guestName: "Jan Testowy",
      guestPhone: GUEST_PHONE_E164,
      startTime: at("10:00"),
      endTime: at("11:00"),
    });
  });

  it("log info po sukcesie: tylko salonId, appointmentId i kwota", async () => {
    primeHappyPath();
    await post();
    const success = h.logger.info.mock.calls.find((c) => String(c[0]).includes("created"));
    expect(success?.[1]).toEqual({ salonId: SALON, appointmentId: APPOINTMENT, amount: 50 });
  });

  it("zalogowany klient portalu: bookedByUserId z sesji, bez pól gościa → 201", async () => {
    h.session.mockResolvedValue({ user: { id: "user-1", email: "klient@example.invalid" } });
    primeHappyPath();
    const { status } = await parseResponse<Ok>(
      await post({ ...validBody, guestName: undefined, guestPhone: undefined })
    );
    expect(status).toBe(201);
    expect(h.insertValues.mock.calls[0]![0]).toMatchObject({ bookedByUserId: "user-1", guestPhone: null });
    expect(h.calc.mock.calls[0]![0]).toMatchObject({ sessionUser: { id: "user-1" } });
  });

  it("kwota w odpowiedzi i zapisie jest serwerowa, nie z body (50.004 → 50)", async () => {
    primeHappyPath();
    const { status, body } = await parseResponse<Ok>(await post({ ...validBody, depositAmount: "50.004" }));
    expect(status).toBe(201);
    expect(body.data.depositAmount).toBe(50);
    expect(h.insertValues.mock.calls[0]![0]).toMatchObject({ depositAmount: "50" });
  });

  it("forSalon wyłącznie z salonId z body; każde zapytanie z jawną listą kolumn", async () => {
    primeHappyPath();
    await post();
    expect(h.forSalon.mock.calls.map((c) => c[0])).toEqual([SALON, SALON]);
    // Trzy transakcje: odczyt salonu, potem kolizja + blokady + zapis razem,
    // potem szczegóły do SMS.
    expect(h.raw.mock.calls.map((c) => c[0])).toEqual([SALON, SALON, SALON]);
    expect(h.selectArgs).toHaveLength(4);
    for (const cols of h.selectArgs) {
      expect(cols).toBeTypeOf("object");
      expect(Object.keys(cols as object).length).toBeGreaterThan(0);
    }
    expect(Object.keys(h.insertReturning.mock.calls[0]![0] as object).sort()).toEqual(
      ["depositPaid", "endTime", "id", "startTime", "status"]
    );
  });

  it("assertSalonRefs dostaje salonId z body i wszystkie refy (z wariantem)", async () => {
    h.queue.push([{ ...salonRow(), variantRowId: VARIANT }], [], [], [detailsRow()]);
    await post({ ...validBody, variantId: VARIANT });
    expect(h.refs).toHaveBeenCalledWith(SALON, {
      clientId: null,
      employeeId: EMPLOYEE,
      serviceId: SERVICE,
      variantId: VARIANT,
    });
  });

  it("clientId od osoby spoza personelu jest pomijany; personel tego salonu go podpina", async () => {
    primeHappyPath();
    await post({ ...validBody, clientId: CLIENT });
    expect(h.insertValues.mock.calls[0]![0]).toMatchObject({ clientId: null });

    vi.clearAllMocks();
    h.session.mockResolvedValue({ user: { id: "owner-1" } });
    h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });
    h.refs.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
    h.rate.mockReturnValue({ success: true, remaining: 4, reset: 60_000 });
    primeHappyPath();
    expect((await post({ ...validBody, clientId: CLIENT })).status).toBe(201);
    expect(h.insertValues.mock.calls[0]![0]).toMatchObject({ clientId: CLIENT });
  });

  it("wizyta tego pracownika zapisana pod innym salonem nie trafia w warunek kolizji → 201", async () => {
    h.queue.push([salonRow()], [appt("10:30", "11:30", { salon_id: OTHER_SALON })], []);
    expect((await post()).status).toBe(201);
  });

  it("styk z istniejącą wizytą (11–12 po 10–11) i anulowana w tym terminie → 201", async () => {
    h.queue.push([salonRow()], [appt("11:00", "12:00"), appt("10:00", "11:00", { status: "cancelled" })], []);
    expect((await post()).status).toBe(201);
  });

  it("blokada INNEGO pracownika albo pracownika innego salonu → 201", async () => {
    h.queue.push(
      [salonRow()],
      [],
      [block("10:00", "11:00", { employee_id: OTHER_EMPLOYEE }), block("10:00", "11:00", { salon_id: OTHER_SALON })]
    );
    expect((await post()).status).toBe(201);
  });
});

// ─── SMS do klienta ─────────────────────────────────────────────────────────

/** Inny numer testowy: gdyby SMS czytał numer drugi raz, dostałby właśnie ten. */
const OTHER_BLIK_PHONE = "+48000600705";
const STAFF_CLIENT_PHONE = "+48000600701";

const smsArgs = () => h.sms.mock.calls[0]![0] as Record<string, unknown>;

describe("SMS z numerem BLIK, kwotą i tytułem — tylko po 201", () => {
  it("gość: dokładnie jeden SMS na telefon gościa; numer i tytuł identyczne z data.blik", async () => {
    primeHappyPath();
    const { status, body } = await parseResponse<Ok>(await post());

    expect(status).toBe(201);
    expect(h.sms).toHaveBeenCalledTimes(1);
    expect(smsArgs().blikPhone).toBe(body.data.blik.phone);
    expect(smsArgs().title).toBe(body.data.blik.title);
    expect(smsArgs()).toEqual({
      clientPhone: GUEST_PHONE_E164,
      clientName: "Jan Testowy",
      serviceName: "Strzyzenie",
      employeeName: "Anna Testowa",
      appointmentDate: at("10:00"),
      salonName: SALON_NAME,
      salonId: SALON,
      blikPhone: BLIK_PHONE,
      amount: 50,
      title: "Zadatek MH-A1B2C3",
    });
  });

  it("numer do SMS to zmienna z odczytu trasy — inny numer w bazie przy drugim odczycie nie trafia do SMS", async () => {
    // Szczegóły niosą inny numer, a kolejne zapytanie zwróciłoby salon z innym
    // numerem: trasa, która czyta numer drugi raz, wysłałaby OTHER_BLIK_PHONE.
    primeHappyPath([detailsRow({ blikPhone: OTHER_BLIK_PHONE })]);
    h.queue.push([salonRow(OTHER_BLIK_PHONE)]);
    const { status, body } = await parseResponse<Ok>(await post());

    expect(status).toBe(201);
    expect(body.data.blik.phone).toBe(BLIK_PHONE);
    expect(smsArgs().blikPhone).toBe(BLIK_PHONE);
    expect(JSON.stringify(h.sms.mock.calls)).not.toContain(OTHER_BLIK_PHONE);
  });

  it("SMS dopiero po zapisie wizyty", async () => {
    primeHappyPath();
    await post();
    expect(h.sms.mock.invocationCallOrder[0]!).toBeGreaterThan(h.insertValues.mock.invocationCallOrder[0]!);
  });

  it("personel z klientem z kartoteki: SMS na telefon z kartoteki, z clientId i imieniem klienta", async () => {
    h.session.mockResolvedValue({ user: { id: "owner-1" } });
    h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });
    primeHappyPath([detailsRow({ clientFirstName: "Maria", clientPhone: STAFF_CLIENT_PHONE })]);
    const { status, body } = await parseResponse<Ok>(
      await post({ ...validBody, clientId: CLIENT, guestName: undefined, guestPhone: undefined })
    );

    expect(status).toBe(201);
    expect(h.sms).toHaveBeenCalledTimes(1);
    expect(smsArgs()).toMatchObject({
      clientPhone: STAFF_CLIENT_PHONE,
      clientName: "Maria",
      clientId: CLIENT,
      blikPhone: body.data.blik.phone,
      title: body.data.blik.title,
    });
  });

  it("brak telefonu (klient portalu bez pól gościa, bez kartoteki) → 201 bez SMS", async () => {
    h.session.mockResolvedValue({ user: { id: "user-1" } });
    primeHappyPath();
    const res = await post({ ...validBody, guestName: undefined, guestPhone: undefined });
    expect(res.status).toBe(201);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("odczyt szczegółów przez forSalon(salonId) z jawną listą kolumn i warunkiem na id wizyty i salon", async () => {
    primeHappyPath();
    await post();
    expect(h.forSalon.mock.calls.at(-1)![0]).toBe(SALON);
    expect(Object.keys(h.selectArgs[3] as object).sort()).toEqual(
      ["clientFirstName", "clientPhone", "employeeFirstName", "employeeLastName", "serviceName"]
    );
  });

  it("szczegóły dla wizyty innego salonu nie przechodzą WHERE → 201 bez SMS", async () => {
    primeHappyPath([detailsRow({ salon_id: OTHER_SALON })]);
    expect((await post()).status).toBe(201);
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("SMS rzuca błąd z numerami → ta sama odpowiedź 201; log: id wizyty i tożsamość błędu", async () => {
    primeHappyPath();
    const ok = await parseResponse<Ok>(await post());

    vi.clearAllMocks();
    h.queue.length = 0;
    h.session.mockResolvedValue(null);
    h.refs.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "Strzyzenie" });
    h.rate.mockReturnValue({ success: true, remaining: 4, reset: 60_000 });
    h.sms.mockRejectedValue(new Error(`SMSAPI: ${GUEST_PHONE_E164} ${BLIK_PHONE}`));
    primeHappyPath();
    const failed = await parseResponse<Ok>(await post());

    expect(failed).toEqual(ok);
    const call = h.logger.warn.mock.calls.find((c) => String(c[0]).includes("SMS failed"));
    expect(call?.[1]).toEqual({ appointmentId: APPOINTMENT, errorName: "Error" });
  });

  it("błąd odczytu szczegółów → 201 bez SMS, log bez treści błędu", async () => {
    primeHappyPath();
    h.failAt = 4;
    const { status, body } = await parseResponse<Ok>(await post());
    expect(status).toBe(201);
    expect(body.data.blik.phone).toBe(BLIK_PHONE);
    expect(h.sms).not.toHaveBeenCalled();
    const call = h.logger.warn.mock.calls.find((c) => String(c[0]).includes("SMS failed"));
    expect(call?.[1]).toEqual({ appointmentId: APPOINTMENT, errorName: "Error" });
  });

  it.each<[string, () => void, Record<string, unknown>?]>([
    ["409 brak numeru BLIK", () => h.queue.push([salonRow(null)])],
    ["409 termin zajęty", () => h.queue.push([salonRow()], [appt("10:30", "11:30")], [], [detailsRow()])],
    ["409 wyścig EXCLUDE", () => {
      primeHappyPath();
      h.insertError = wrapped({ code: "23P01", constraint_name: "appointments_no_overlap" });
    }],
    ["400 zła kwota", () => {
      h.calc.mockResolvedValue({ ok: true, required: true, amount: 60, serviceName: "S" });
      primeHappyPath();
    }],
    ["400 walidacja", () => primeHappyPath(), { employeeId: undefined }],
    ["429 limit", () => {
      h.rate.mockReturnValue({ success: false, remaining: 0, reset: 30_000 });
      primeHappyPath();
    }],
    ["503 wyliczenie kwoty", () => {
      h.calc.mockRejectedValue(new Error("db down"));
      primeHappyPath();
    }],
    ["500 insert bez wiersza", () => {
      primeHappyPath();
      h.insertResult = [];
    }],
  ])("%s → bez SMS", async (_n, arrange, patch = {}) => {
    arrange();
    const res = await post({ ...validBody, ...patch });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.sms).not.toHaveBeenCalled();
  });
});

// ─── 401 / 403 nie dotyczą ──────────────────────────────────────────────────

describe("401/403 nie dotyczą — trasa publiczna", () => {
  it("gość bez sesji przechodzi (bez requireAuth i bez kontekstu salonu)", async () => {
    primeHappyPath();
    expect((await post()).status).toBe(201);
    expect(h.salonCtx).not.toHaveBeenCalled();
  });
});

// ─── 400 ────────────────────────────────────────────────────────────────────

describe("400 — walidacja, kwota, brak wymogu zadatku, obce refy", () => {
  it.each([
    ["brak employeeId", { employeeId: undefined }, "employeeId"],
    ["brak serviceId", { serviceId: undefined }, "serviceId"],
    ["zły salonId", { salonId: "abc" }, "salonId"],
    ["koniec przed początkiem", { startTime: iso("11:00"), endTime: iso("10:00") }, "endTime"],
    ["kwota 0", { depositAmount: 0 }, "depositAmount"],
    ["zły telefon gościa", { guestPhone: "+48 000 600 70" }, "guestPhone"],
  ])("%s → 400 VALIDATION_FAILED, bez zapytań", async (_n, patch, field) => {
    const { status, body } = await parseResponse<Err>(await post({ ...validBody, ...patch }));
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(body.details ?? {})).toContain(field);
    expect(h.forSalon).not.toHaveBeenCalled();
    expect(h.calc).not.toHaveBeenCalled();
  });

  it("błąd schematu: do logu same nazwy pól", async () => {
    await post({ ...validBody, guestPhone: "+48 000 600 70", employeeId: "x" });
    const call = h.logger.warn.mock.calls.find((c) => String(c[0]).includes("Validation failed"));
    expect(call?.[1]).toEqual({ fields: expect.arrayContaining(["employeeId", "guestPhone"]) });
  });

  it("niepoprawny JSON → 400", async () => {
    const res = await POST(
      new Request("http://localhost:3000/api/deposits/blik-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: `{"guestPhone":"${TEST_PHONE}"`,
      })
    );
    expect(res.status).toBe(400);
  });

  it.each([
    ["bez imienia", { guestName: undefined }, "Imię i nazwisko jest wymagane (min. 2 znaki)"],
    ["bez telefonu", { guestPhone: undefined }, "Podaj prawidłowy numer telefonu (9 cyfr)"],
  ])("gość %s → 400", async (_n, patch, msg) => {
    const { status, body } = await parseResponse<Err>(await post({ ...validBody, ...patch }));
    expect(status).toBe(400);
    expect(body.error).toBe(msg);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("kwota z body różna od serwerowej → 400, bez odczytu salonu i zapisu", async () => {
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 60, serviceName: "Strzyzenie" });
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(400);
    expect(body.error).toBe("Nieprawidlowa kwota zadatku. Odswiez strone i sprobuj ponownie.");
    expect(h.forSalon).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it.each([
    ["usługa bez wymogu zadatku", { ok: true, required: false, amount: 0, serviceName: "S" }],
    ["wymóg z kwotą 0", { ok: true, required: true, amount: 0, serviceName: "S" }],
  ])("%s → 400 DEPOSIT_NOT_APPLICABLE", async (_n, calc) => {
    h.calc.mockResolvedValue(calc);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(400);
    expect(body.code).toBe("DEPOSIT_NOT_APPLICABLE");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("obcy employeeId/serviceId (assertSalonRefs) → 400, bez wyliczenia i zapisu", async () => {
    h.refs.mockResolvedValue(
      Response.json({ success: false, error: "Nieprawidlowe dane dla tego salonu" }, { status: 400 })
    );
    const { status, body } = await parseResponse<Err>(await post({ ...validBody, employeeId: OTHER_EMPLOYEE }));
    expect(status).toBe(400);
    expect(body.error).toBe("Nieprawidlowe dane dla tego salonu");
    expect(h.calc).not.toHaveBeenCalled();
    expect(h.forSalon).not.toHaveBeenCalled();
  });
});

// ─── 404 ────────────────────────────────────────────────────────────────────

describe("404 — usługa, wariant, salon", () => {
  it.each([
    ["service_not_found", SERVICE_UNAVAILABLE],
    ["variant_not_found", VARIANT_UNAVAILABLE],
  ])("%s → 404", async (error, msg) => {
    h.calc.mockResolvedValue({ ok: false, error });
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(404);
    expect(body.error).toBe(msg);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("salon niewidoczny w kontekście forSalon → 404, bez zapisu", async () => {
    h.queue.push([]);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(404);
    expect(body.error).toBe("Nie znaleziono salonu.");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("wariant w body, a odczyt salonu go nie widzi → 404 z tekstem wariantu, bez zapisu", async () => {
    h.queue.push([salonRow()]);
    const { status, body } = await parseResponse<Err>(await post({ ...validBody, variantId: VARIANT }));
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: VARIANT_UNAVAILABLE });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.sms).not.toHaveBeenCalled();
  });

  it("usługa niewidoczna w odczycie salonu → 404 z tekstem usługi, bez zapisu", async () => {
    h.queue.push([{ ...salonRow(), serviceDuration: null }]);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: SERVICE_UNAVAILABLE });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.sms).not.toHaveBeenCalled();
  });
});

// ─── Termin w przeszłości ───────────────────────────────────────────────────

const PAST_START_BODY = {
  success: false,
  error: PAST_START_MESSAGE,
  code: "VALIDATION_FAILED",
  details: { startTime: PAST_START_MESSAGE },
};

/** Body z początkiem przesuniętym względem NOW i wizytą 60 min. */
const bodyStartingAt = (offsetMs: number) => ({
  ...validBody,
  startTime: isoFromNow(offsetMs),
  endTime: isoFromNow(offsetMs + 60 * MINUTE_MS),
});

describe("termin w przeszłości — tolerancja 5 min względem zegara serwera", () => {
  it.each([
    ["dokładnie 5 min temu", -5 * MINUTE_MS],
    ["za minutę", MINUTE_MS],
  ])("początek %s → 201", async (_n, offset) => {
    primeHappyPath();
    expect((await post(bodyStartingAt(offset))).status).toBe(201);
  });

  it("początek 5 min i 1 ms temu → 400 VALIDATION_FAILED przed sesją i bazą", async () => {
    primeHappyPath();
    const { status, body } = await parseResponse<Err>(await post(bodyStartingAt(-5 * MINUTE_MS - 1)));
    expect(status).toBe(400);
    expect(body).toEqual(PAST_START_BODY);
    expect(h.session).not.toHaveBeenCalled();
    expect(h.forSalon).not.toHaveBeenCalled();
    expect(h.calc).not.toHaveBeenCalled();
    expect(h.refs).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.sms).not.toHaveBeenCalled();
    const call = h.logger.warn.mock.calls.find((c) => String(c[0]).includes("Validation failed"));
    expect(call?.[1]).toEqual({ fields: ["startTime"] });
  });

  it("przeszłość i zła kwota → 400 z tekstem przeszłości, nie kwoty", async () => {
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 60, serviceName: "Strzyzenie" });
    const { status, body } = await parseResponse<Err>(await post(bodyStartingAt(-60 * MINUTE_MS)));
    expect(status).toBe(400);
    expect(body).toEqual(PAST_START_BODY);
  });
});

// ─── Długość wizyty z usługi i wariantu ─────────────────────────────────────

const DURATION_MISMATCH_BODY = {
  success: false,
  error: "Czas wizyty nie zgadza sie z wybrana usluga. Odswiez strone i sprobuj ponownie.",
  code: "BOOKING_DURATION_MISMATCH",
};

describe("długość wizyty = baseDuration usługi + durationModifier wariantu z bazy", () => {
  it.each([
    ["59 min", "10:59"],
    ["61 min", "11:01"],
  ])("usługa 60 min, wizyta %s → 400 BOOKING_DURATION_MISMATCH przed kalendarzem", async (_n, end) => {
    primeHappyPath();
    const { status, body } = await parseResponse<Err>(await post({ ...validBody, endTime: iso(end) }));
    expect(status).toBe(400);
    expect(body).toEqual(DURATION_MISMATCH_BODY);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.selectCalls).toBe(1); // kalendarz nieodpytywany
  });

  it("log niezgodności: salonId, serviceId, długość żądana i oczekiwana", async () => {
    primeHappyPath();
    await post({ ...validBody, endTime: iso("10:59") });
    const call = h.logger.warn.mock.calls.find((c) => String(c[0]).includes("duration mismatch"));
    expect(call?.[1]).toEqual({ salonId: SALON, serviceId: SERVICE, requestedMinutes: 59, expectedMinutes: 60 });
  });

  it("usługa 60 min, wizyta 60 min → 201", async () => {
    primeHappyPath();
    expect((await post()).status).toBe(201);
  });

  it.each<[string, number | null, string, number]>([
    ["modyfikator 15, wizyta 75 min", 15, "11:15", 201],
    ["modyfikator 15, wizyta 60 min", 15, "11:00", 400],
    ["modyfikator null, wizyta 60 min", null, "11:00", 201],
  ])("wariant: %s → %i", async (_n, modifier, end, expectedStatus) => {
    h.queue.push(
      [{ ...salonRow(), variantRowId: VARIANT, variantDurationModifier: modifier }],
      [],
      [],
      [detailsRow()]
    );
    const res = await post({ ...validBody, variantId: VARIANT, endTime: iso(end) });
    expect(res.status).toBe(expectedStatus);
    if (expectedStatus === 400) {
      expect(await res.json()).toEqual(DURATION_MISMATCH_BODY);
      expect(h.insert).not.toHaveBeenCalled();
    }
  });

  it("zła długość i brak numeru BLIK → 400 długości, nie 409", async () => {
    h.queue.push([salonRow(null)]);
    const { status, body } = await parseResponse<Err>(await post({ ...validBody, endTime: iso("10:59") }));
    expect(status).toBe(400);
    expect(body).toEqual(DURATION_MISMATCH_BODY);
  });

  it("odczyt salonu: numer, dane odbiorcy i długość usługi w jednym zapytaniu", async () => {
    primeHappyPath();
    await post();
    expect(Object.keys(h.selectArgs[0] as object).sort()).toEqual([
      "blikPhone",
      "name",
      "phone",
      "serviceDuration",
      "variantDurationModifier",
      "variantRowId",
    ]);
  });
});

// ─── Log wyniku SMS ─────────────────────────────────────────────────────────

const OK_BODY = {
  success: true,
  data: {
    appointmentId: APPOINTMENT,
    startTime: iso("10:00"),
    endTime: iso("11:00"),
    depositAmount: 50,
    blik: { phone: BLIK_PHONE, recipient: SALON_NAME, title: "Zadatek MH-A1B2C3" },
    status: "scheduled",
    depositPaid: false,
  },
};

const logCallsMatching = (fn: typeof h.logger.warn, text: string) =>
  fn.mock.calls.filter((c) => String(c[0]).includes(text));

describe("log wyniku SMS — id wizyty i powód z zamkniętej listy", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["numer testowy", { success: false, skipped: "test_phone", error: SMS_TEST_PHONE_ERROR }, "test_phone"],
    ["brak dostawcy", { success: false, error: SMS_PROVIDER_UNAVAILABLE_ERROR }, "provider_unavailable"],
    ["błąd wysyłki", { success: false, error: SMS_SEND_FAILED_ERROR }, "send_failed"],
    [
      "zły numer",
      { success: false, error: "Invalid phone number: +48 *** *** 700. Expected 9 digits or +48 followed by 9 digits." },
      "rejected",
    ],
  ])("%s → 201 bez zmian; warn z appointmentId i powodem", async (_n, result, reason) => {
    h.sms.mockResolvedValue(result);
    primeHappyPath();
    const { status, body } = await parseResponse<Ok>(await post());

    expect(status).toBe(201);
    expect(body).toEqual(OK_BODY);
    const calls = logCallsMatching(h.logger.warn, "Booking SMS not sent");
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({ appointmentId: APPOINTMENT, reason });
    const logged = serializeLogCalls(Object.values(h.logger).flatMap((fn) => fn.mock.calls));
    expect(logged).not.toContain("Invalid phone");
    expect(logged).not.toContain("***");
  });

  it.each<[string, unknown]>([
    ["SMS wysłany", { success: true, notificationId: "notif-1" }],
    ["atrapa bez wyniku (undefined, jak w teście pg)", undefined],
  ])("%s → 201 bez wpisu o błędzie, niewysłaniu ani pominięciu", async (_n, result) => {
    h.sms.mockResolvedValue(result);
    primeHappyPath();
    const { status, body } = await parseResponse<Ok>(await post());
    expect(status).toBe(201);
    expect(body).toEqual(OK_BODY);
    expect(logCallsMatching(h.logger.warn, "Booking SMS failed")).toHaveLength(0);
    expect(logCallsMatching(h.logger.warn, "Booking SMS not sent")).toHaveLength(0);
    expect(logCallsMatching(h.logger.info, "Booking SMS skipped")).toHaveLength(0);
  });

  it("klient portalu bez telefonu → info „skipped” z powodem no_phone", async () => {
    h.session.mockResolvedValue({ user: { id: "user-1" } });
    primeHappyPath();
    expect((await post({ ...validBody, guestName: undefined, guestPhone: undefined })).status).toBe(201);
    const calls = logCallsMatching(h.logger.info, "Booking SMS skipped");
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({ appointmentId: APPOINTMENT, reason: "no_phone" });
  });

  it("szczegóły wizyty niewidoczne (inny salon) → info „skipped” z powodem no_details", async () => {
    primeHappyPath([detailsRow({ salon_id: OTHER_SALON })]);
    expect((await post()).status).toBe(201);
    const calls = logCallsMatching(h.logger.info, "Booking SMS skipped");
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({ appointmentId: APPOINTMENT, reason: "no_details" });
  });
});

// ─── 409 ────────────────────────────────────────────────────────────────────

describe("409 — termin, blokada, brak numeru BLIK, wyścig", () => {
  it("nakładająca się wizyta tego pracownika → 409, bez zapisu", async () => {
    h.queue.push([salonRow()], [appt("10:30", "11:30")], []);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(409);
    expect(body.error).toBe("Wybrany termin jest juz zajety. Wybierz inny termin.");
    expect(h.insert).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(BLIK_PHONE);
  });

  it("blokada czasu tego pracownika → 409, bez zapisu", async () => {
    h.queue.push([salonRow()], [], [block("10:59", "18:00")]);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(409);
    expect(body.error).toBe("Pracownik nie jest dostepny w wybranym terminie.");
    expect(h.insert).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain(BLIK_PHONE);
  });

  it.each([
    ["brak klucza", undefined],
    ["null", null],
    ["pusty napis", ""],
    ["same spacje", "   "],
    ["nie napis", 600700800],
  ])("numer BLIK: %s → 409 DEPOSIT_BLIK_NOT_CONFIGURED z telefonem salonu, bez zapisu", async (_n, blik) => {
    // Bez domyślnego argumentu fikstury: `undefined` ma znaczyć „brak klucza”.
    h.queue.push([{ ...salonRow(), blikPhone: blik }]);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(409);
    expect(body).toEqual({
      success: false,
      code: "DEPOSIT_BLIK_NOT_CONFIGURED",
      error: `Ten salon nie przyjmuje teraz rezerwacji online z zadatkiem. Zadzwoń: ${SALON_PHONE}`,
    });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.selectCalls).toBe(1); // kalendarz nieodpytywany
  });

  it("brak numeru BLIK i telefonu salonu → zdanie bez numeru", async () => {
    h.queue.push([salonRow(null, null)]);
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(409);
    expect(body.error).toBe("Ten salon nie przyjmuje teraz rezerwacji online z zadatkiem.");
  });

  it("numeru BLIK nie ma w ciele 409 innego niż brak numeru (zajęty termin przy ustawionym numerze)", async () => {
    h.queue.push([salonRow()], [appt("10:00", "11:00")], []);
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("000600703");
  });

  it.each([
    ["EXCLUDE 23P01", wrapped({ code: "23P01", constraint_name: "appointments_no_overlap" })],
    ["zakleszczenie 40P01 przy sprawdzaniu EXCLUDE", wrapped(deadlock())],
  ])("wyścig przy zapisie (%s) → 409", async (_n, err) => {
    primeHappyPath();
    h.insertError = err;
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(409);
    expect(body.error).toBe("Wybrany termin jest juz zajety. Wybierz inny termin.");
    expect(JSON.stringify(body)).not.toContain(BLIK_PHONE);
  });
});

// ─── 429 / 500 / 503 ────────────────────────────────────────────────────────

describe("429, 500, 503", () => {
  it("limit IP wyczerpany → 429 z Retry-After, przed czymkolwiek", async () => {
    h.rate.mockReturnValue({ success: false, remaining: 0, reset: 30_000 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(h.session).not.toHaveBeenCalled();
    expect(h.forSalon).not.toHaveBeenCalled();
  });

  it("błąd zapisu (inny niż EXCLUDE) → 500; log bez treści błędu z parametrami zapytania", async () => {
    primeHappyPath();
    h.insertError = Object.assign(
      new Error(`Failed query: insert into appointments\nparams: Jan,${GUEST_PHONE_E164},${BLIK_PHONE}`),
      { cause: { code: "23502" } }
    );
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(500);
    expect(body.error).toBe("Nie udalo sie utworzyc rezerwacji");
    const call = h.logger.error.mock.calls.find((c) => String(c[0]).includes("failed"));
    expect(call?.[1]).toEqual({ salonId: SALON, errorName: "Error", errorCode: "23502" });
  });

  it("błąd odczytu kalendarza → 500, bez zapisu", async () => {
    h.queue.push([salonRow()]);
    h.failAt = 2;
    expect((await post()).status).toBe(500);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("insert bez zwróconego wiersza → 500", async () => {
    primeHappyPath();
    h.insertResult = [];
    expect((await post()).status).toBe(500);
  });

  it("wyliczenie kwoty rzuca → 503 z Retry-After, bez zapisu", async () => {
    h.calc.mockRejectedValue(new Error(`params: ${GUEST_PHONE_E164}`));
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(h.forSalon).not.toHaveBeenCalled();
  });

  it("kwota nie jest liczbą skończoną → 503, bez zapisu", async () => {
    h.calc.mockResolvedValue({ ok: true, required: true, amount: Number.NaN, serviceName: "S" });
    expect((await post()).status).toBe(503);
    expect(h.insert).not.toHaveBeenCalled();
  });
});
