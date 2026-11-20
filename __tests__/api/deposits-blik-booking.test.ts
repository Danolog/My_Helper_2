/**
 * POST /api/deposits/blik-booking — rezerwacja z zadatkiem płatnym BLIK-iem
 * na telefon salonu.
 *
 * Trasa: limit IP → schemat → gość/sesja → przynależność refów → kwota z
 * serwera → numer BLIK salonu → kolizja i blokady → zapis wizyty
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

const at = (hm: string) => new Date(`2026-12-01T${hm}:00.000Z`);
const iso = (hm: string) => at(hm).toISOString();

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

/** Wiersz salonu (WHERE po `id`) z poddrzewem `deposits.blikPhone`. */
const salonRow = (blikPhone: unknown = BLIK_PHONE, phone: string | null = SALON_PHONE) => ({
  id: SALON,
  name: SALON_NAME,
  phone,
  blikPhone,
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

/** Kolejka zapytań ścieżki szczęśliwej: salon, kolizje, blokady. */
function primeHappyPath() {
  h.queue.push([salonRow()], [], []);
}

const insertedTables = () => h.insert.mock.calls.map((c) => c[0]);

beforeEach(() => {
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
});

const PRIVATE_DIGITS = ["000600703", "000600700", "000 600 700"];

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
    expect(h.forSalon.mock.calls.map((c) => c[0])).toEqual([SALON]);
    // Dwie transakcje: odczyt salonu, potem kolizja + blokady + zapis razem.
    expect(h.raw.mock.calls.map((c) => c[0])).toEqual([SALON, SALON]);
    expect(h.selectArgs).toHaveLength(3);
    for (const cols of h.selectArgs) {
      expect(cols).toBeTypeOf("object");
      expect(Object.keys(cols as object).length).toBeGreaterThan(0);
    }
    expect(Object.keys(h.insertReturning.mock.calls[0]![0] as object).sort()).toEqual(
      ["depositPaid", "endTime", "id", "startTime", "status"]
    );
  });

  it("assertSalonRefs dostaje salonId z body i wszystkie refy (z wariantem)", async () => {
    primeHappyPath();
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
    ["service_not_found", "Service not found"],
    ["variant_not_found", "Variant not found"],
  ])("%s → 404", async (error, msg) => {
    h.calc.mockResolvedValue({ ok: false, error });
    const { status, body } = await parseResponse<Err>(await post());
    expect(status).toBe(404);
    expect(body.error).toBe(msg);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("salon niewidoczny w kontekście forSalon → 404, bez zapisu", async () => {
    h.queue.push([]);
    const { status } = await parseResponse<Err>(await post());
    expect(status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
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
