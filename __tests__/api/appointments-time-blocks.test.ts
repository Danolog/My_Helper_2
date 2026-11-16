/**
 * #168: blokady czasu pracownika (urlop, przerwa…) przy zapisie wizyty.
 * - PUT /api/appointments/[id]: nowe sprawdzenie (wcześniej tylko kolizja z wizytami).
 * - POST /api/appointments (Q8 Quinn): blokada INNEGO pracownika nie blokuje.
 *
 * Wiersze-fikstury przechodzą przez WHERE trasy (prawdziwy drizzle, `sqlMatches`),
 * więc test pilnuje znaczenia predykatu: pracownik, przedział półotwarty [start, end).
 * Pakiet i zadatek: appointments-book-package.test.ts, deposits-create-session.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createChainMock, createMockRequest, parseResponse } from "./helpers";
import { sqlMatches } from "./sql-predicate";

const SALON = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE = "22222222-2222-4222-8222-999999999999";
const SERVICE = "44444444-4444-4444-8444-444444444444";
const APPOINTMENT = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  /** Wyniki kolejnych select (db i tx): każdy filtrowany przez WHERE trasy. */
  queue: [] as Record<string, unknown>[][],
  selectCalls: 0,
  /** Numer wywołania select, które rzuca (0 = żadne). */
  failAt: 0,
  insert: vi.fn(),
  update: vi.fn(),
  findOne: vi.fn(),
  salonCtx: vi.fn(),
  session: vi.fn(),
  calc: vi.fn(),
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

function nextSelect() {
  h.selectCalls++;
  if (h.failAt === h.selectCalls) throw new Error("db down");
  return filteringChain(h.queue.shift() ?? []);
}

vi.mock("@/lib/db", () => {
  const select = () => nextSelect();
  return {
    db: {
      select,
      insert: (...a: unknown[]) => h.insert(...a),
      update: (...a: unknown[]) => h.update(...a),
    },
  };
});

vi.mock("@/lib/server/repository", () => {
  const tx = {
    select: () => nextSelect(),
    update: (...a: unknown[]) => h.update(...a),
  };
  return {
    forSalon: (salonId: string) => ({
      salonId,
      findOne: (...a: unknown[]) => h.findOne(...a),
      raw: (fn: (t: typeof tx) => unknown) => fn(tx),
    }),
  };
});

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({ session: { user: { id: "owner-user" } }, user: { id: "owner-user" } }),
  isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: vi.fn(async () => null) }));
vi.mock("@/lib/session", () => ({ getOptionalSession: (...a: unknown[]) => h.session(...a) }));
vi.mock("@/lib/rate-limit", () => {
  const ok = { check: () => ({ success: true, remaining: 10, reset: 60000 }) };
  return { strictRateLimit: ok, apiRateLimit: ok, getClientIp: () => "127.0.0.1" };
});
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));
vi.mock("@/lib/sms", () => ({ sendBookingConfirmationSms: vi.fn() }));
vi.mock("@/lib/waiting-list", () => ({ notifyWaitingList: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { PUT } from "@/app/api/appointments/[id]/route";
import { POST } from "@/app/api/appointments/route";
import { timeBlockConflictMessage } from "@/lib/time-block-conflict";

const at = (hm: string) => new Date(`2026-12-01T${hm}:00.000Z`);
const iso = (hm: string) => at(hm).toISOString();

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
/** Blokada: kolumny do WHERE + pola zwracane do komunikatu. */
const block = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  employee_id: EMPLOYEE,
  start_time: at(start),
  end_time: at(end),
  blockType: "vacation",
  reason: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.queue.length = 0;
  h.selectCalls = 0;
  h.failAt = 0;
  h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });
  h.session.mockResolvedValue(null);
  h.calc.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "Strzyzenie" });
  h.insert.mockReturnValue(createChainMock([{ id: "apt-new", clientId: null }]));
  h.update.mockReturnValue(createChainMock([{ id: APPOINTMENT }]));
});

// ─── PUT ────────────────────────────────────────────────────────────────────

describe("PUT /api/appointments/[id] — blokady czasu (#168)", () => {
  // Istniejąca wizyta: 12:00–13:00 u EMPLOYEE.
  const existing = (extra: Record<string, unknown> = {}) => ({
    id: APPOINTMENT,
    salonId: SALON,
    employeeId: EMPLOYEE,
    status: "scheduled",
    startTime: at("12:00"),
    endTime: at("13:00"),
    notes: null,
    ...extra,
  });

  function put(body: Record<string, unknown>) {
    return PUT(
      createMockRequest(`http://localhost:3000/api/appointments/${APPOINTMENT}`, { method: "PUT", body }),
      { params: Promise.resolve({ id: APPOINTMENT }) }
    );
  }
  const move = (start: string, end: string, extra: Record<string, unknown> = {}) =>
    put({ startTime: iso(start), endTime: iso(end), ...extra });

  beforeEach(() => {
    h.findOne.mockResolvedValue(existing());
  });

  it("przesunięcie na urlop (nakładanie o 1 min) → 409 z komunikatem jak w POST, bez zapisu", async () => {
    h.queue.push([], [block("10:59", "18:00")]);
    const { status, body } = await parseResponse<{ success: boolean; error: string }>(await move("10:00", "11:00"));
    expect(status).toBe(409);
    expect(body).toEqual({ success: false, error: "Pracownik ma urlop w tym terminie" });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("komunikat z typem i powodem blokady", async () => {
    h.queue.push([], [block("10:30", "10:45", { blockType: "break", reason: "Obiad" })]);
    const { status, body } = await parseResponse<{ error: string }>(await move("10:00", "11:00"));
    expect(status).toBe(409);
    expect(body.error).toBe("Pracownik ma przerwa w tym terminie (Obiad)");
  });

  it.each([
    ["kończy się na początku wizyty (09–10)", "09:00", "10:00"],
    ["zaczyna się na końcu wizyty (11–12)", "11:00", "12:00"],
  ])("blokada na styku: %s → 200, zapis", async (_n, bs, be) => {
    h.queue.push([], [block(bs, be)]);
    const res = await move("10:00", "11:00");
    expect(res.status).toBe(200);
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it("blokada INNEGO pracownika w tym terminie nie blokuje → 200", async () => {
    h.queue.push([], [block("10:00", "11:00", { employee_id: OTHER_EMPLOYEE })]);
    expect((await move("10:00", "11:00")).status).toBe(200);
  });

  it("zmiana pracownika (bez zmiany czasu) na pracownika z blokadą → 409", async () => {
    h.queue.push([], [block("12:00", "13:00", { employee_id: OTHER_EMPLOYEE })]);
    const res = await put({ employeeId: OTHER_EMPLOYEE });
    expect(res.status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("zmiana pracownika: blokada STAREGO pracownika w tym terminie nie blokuje → 200", async () => {
    h.queue.push([], [block("12:00", "13:00")]);
    expect((await put({ employeeId: OTHER_EMPLOYEE })).status).toBe(200);
  });

  it("kolizja z wizytą ma pierwszeństwo: 409 kolizji, blokady nieodpytywane", async () => {
    h.queue.push([appt("10:30", "11:30")], [block("10:00", "11:00")]);
    const { status, body } = await parseResponse<{ error: string }>(await move("10:00", "11:00"));
    expect(status).toBe(409);
    expect(body.error).toBe("Termin koliduje z istniejaca wizyta. Wybierz inna godzine");
    expect(h.selectCalls).toBe(1);
  });

  it("sama notatka (dialog wysyła też ten sam czas i pracownika) na wizycie leżącej na blokadzie → 200, blokady nieodpytywane", async () => {
    h.queue.push([], [block("12:00", "13:00")]);
    const res = await put({ startTime: iso("12:00"), endTime: iso("13:00"), employeeId: EMPLOYEE, notes: "kawa" });
    expect(res.status).toBe(200);
    expect(h.selectCalls).toBe(1); // tylko kolizja z wizytami
  });

  it("anulacja wizyty leżącej na blokadzie → 200, blokady nieodpytywane", async () => {
    h.queue.push([], [block("12:00", "13:00")]);
    expect((await put({ status: "cancelled" })).status).toBe(200);
    expect(h.selectCalls).toBe(1);
  });

  it("przesunięcie z jednoczesną anulacją → bez sprawdzania blokad (wynik nie zajmuje kalendarza)", async () => {
    h.queue.push([], [block("10:00", "11:00")]);
    expect((await move("10:00", "11:00", { status: "cancelled" })).status).toBe(200);
    expect(h.selectCalls).toBe(1);
  });

  it("przywrócenie anulowanej wizyty na blokadę (sam status) → 409", async () => {
    h.findOne.mockResolvedValue(existing({ status: "cancelled" }));
    h.queue.push([], [block("12:30", "14:00")]);
    const res = await put({ status: "scheduled" });
    expect(res.status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("przywrócenie anulowanej wizyty bez blokady → 200", async () => {
    h.findOne.mockResolvedValue(existing({ status: "cancelled" }));
    h.queue.push([], []);
    expect((await put({ status: "confirmed" })).status).toBe(200);
  });

  it("zmiana samego statusu bez anulowanej wizyty (scheduled → confirmed) → blokady nieodpytywane", async () => {
    h.queue.push([], [block("12:00", "13:00")]);
    expect((await put({ status: "confirmed" })).status).toBe(200);
    expect(h.selectCalls).toBe(1);
  });

  it("samo endTime wydłużone na blokadę → 409 (scalony przedział 12:00–14:00)", async () => {
    h.queue.push([], [block("13:30", "15:00")]);
    expect((await put({ endTime: iso("14:00") })).status).toBe(409);
  });

  it("błąd zapytania o blokady → 500, bez zapisu", async () => {
    h.queue.push([]);
    h.failAt = 2; // drugi select = blokady
    const res = await move("10:00", "11:00");
    expect(res.status).toBe(500);
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe("timeBlockConflictMessage", () => {
  it.each([
    [{ blockType: "vacation", reason: null }, "Pracownik ma urlop w tym terminie"],
    [{ blockType: "personal", reason: "Lekarz" }, "Pracownik ma czas osobisty w tym terminie (Lekarz)"],
    [{ blockType: "other", reason: "" }, "Pracownik ma blokada czasu w tym terminie"],
    [{ blockType: "szkolenie", reason: null }, "Pracownik ma szkolenie w tym terminie"],
    [null, "Pracownik ma blokada czasu w tym terminie"],
  ])("%o → %s", (blockArg, expected) => {
    expect(timeBlockConflictMessage(blockArg)).toBe(expected);
  });
});

// ─── POST (Q8) ──────────────────────────────────────────────────────────────

describe("POST /api/appointments — filtr pracownika w blokadach (Q8, #168)", () => {
  const GUEST = { guestName: "Jan Kowalski", guestPhone: "123 456 789" };
  function post(extra: Record<string, unknown> = {}) {
    return POST(
      createMockRequest("http://localhost:3000/api/appointments", {
        method: "POST",
        body: {
          salonId: SALON,
          employeeId: EMPLOYEE,
          serviceId: SERVICE,
          startTime: iso("10:00"),
          endTime: iso("11:00"),
          ...GUEST,
          ...extra,
        },
      })
    );
  }

  it("blokada INNEGO pracownika w tym samym terminie → 201", async () => {
    h.queue.push([], [block("10:00", "11:00", { employee_id: OTHER_EMPLOYEE })]);
    const res = await post();
    expect(res.status).toBe(201);
    expect(h.insert).toHaveBeenCalledTimes(1);
  });

  it("kontrast: blokada TEGO pracownika w tym terminie → 409 z dotychczasowym komunikatem", async () => {
    h.queue.push([], [block("10:00", "11:00", { blockType: "holiday" })]);
    const { status, body } = await parseResponse<{ error: string }>(await post());
    expect(status).toBe(409);
    expect(body.error).toBe("Pracownik ma dzien wolny w tym terminie");
    expect(h.insert).not.toHaveBeenCalled();
  });
});
