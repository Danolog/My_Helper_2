/**
 * POST /api/appointments/[id]/treatment — zapis zabiegu NIE zmienia statusu
 * wizyty (zamyka ją tylko /complete) i nie trafia do wizyty „Nie przyszedł”.
 *
 * - Wizyta `no_show` przy odczycie → 409 `APPOINTMENT_NO_SHOW` (ten sam kod
 *   i komunikat co /complete), bez transakcji.
 * - Dla każdego innego statusu: zabieg zapisany (201 / 200), zero UPDATE
 *   tabeli wizyt.
 *
 * Atrapą jest baza (forSalon), sesja i salon z sesji.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, makeAppointment, parseResponse, TEST_IDS } from "./helpers";

const SALON = TEST_IDS.SALON_UUID;
const APPOINTMENT = TEST_IDS.APPOINTMENT_UUID;

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  salonId: vi.fn(),
  findOne: vi.fn(),
  /** Kolejne wyniki tx.select (odczyt zabiegu, ponowny odczyt statusu). */
  selectResults: [] as unknown[][],
  selects: [] as Array<{ cols: unknown; where: unknown }>,
  /** Wynik UPDATE wizyty (returning). */
  appointmentUpdateRows: [] as unknown[],
  updates: [] as Array<{ table: unknown; set: unknown; where: unknown }>,
  inserts: [] as unknown[],
  transactions: 0,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => h.auth(...a),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/get-user-salon", () => ({ getUserSalonId: (...a: unknown[]) => h.salonId(...a) }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({ _name: name }, { get: (t, col) => (col === "_name" ? t._name : `${name}.${String(col)}`) });
  return { appointments: table("appointments"), treatmentHistory: table("treatmentHistory") };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  notInArray: (col: unknown, val: unknown) => ({ op: "notInArray", col, val }),
}));

vi.mock("@/lib/server/repository", () => {
  const thenable = (result: () => unknown[], chain: Record<string, unknown>) => {
    chain.then = (resolve: (v: unknown) => unknown) => resolve(result());
    return chain;
  };
  const tx = {
    select: (cols?: unknown) => {
      const entry = { cols, where: undefined as unknown };
      h.selects.push(entry);
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.limit = () => chain;
      chain.where = (w: unknown) => {
        entry.where = w;
        return chain;
      };
      return thenable(() => h.selectResults.shift() ?? [], chain);
    },
    update: (table: unknown) => {
      const entry = { table, set: undefined as unknown, where: undefined as unknown };
      h.updates.push(entry);
      const isAppointments = (table as { _name?: string })._name === "appointments";
      const chain: Record<string, unknown> = {};
      chain.set = (v: unknown) => {
        entry.set = v;
        return chain;
      };
      chain.where = (w: unknown) => {
        entry.where = w;
        return chain;
      };
      chain.returning = () => chain;
      return thenable(() => (isAppointments ? h.appointmentUpdateRows : [{ id: "treatment-1" }]), chain);
    },
    insert: (table: unknown) => {
      h.inserts.push(table);
      const chain: Record<string, unknown> = {};
      chain.values = () => chain;
      chain.returning = () => chain;
      return thenable(() => [{ id: "treatment-1" }], chain);
    },
  };
  return {
    forSalon: (salonId: string) => ({
      salonId,
      findOne: (...a: unknown[]) => h.findOne(...a),
      raw: (fn: (t: typeof tx) => unknown) => {
        h.transactions++;
        return Promise.resolve().then(() => fn(tx));
      },
    }),
  };
});

import { POST } from "@/app/api/appointments/[id]/treatment/route";
import { NO_SHOW_COMPLETE_BLOCKED_CODE, NO_SHOW_COMPLETE_BLOCKED_MESSAGE } from "@/lib/no-show";

type Body = { success: boolean; error?: string; code?: string };

function post(body: unknown = { notes: "Zabieg bez uwag" }) {
  return POST(
    createMockRequest(`http://localhost:3000/api/appointments/${APPOINTMENT}/treatment`, { method: "POST", body }),
    createRouteParams(APPOINTMENT)
  );
}

function givenAppointment(status: string) {
  h.findOne.mockResolvedValue(makeAppointment({ id: APPOINTMENT, salonId: SALON, status }));
}

function appointmentUpdates() {
  return h.updates.filter((u) => (u.table as { _name?: string })._name === "appointments");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults = [];
  h.selects = [];
  h.appointmentUpdateRows = [{ id: APPOINTMENT }];
  h.updates = [];
  h.inserts = [];
  h.transactions = 0;
  h.auth.mockResolvedValue({ session: { id: "s-1" }, user: { id: "u-owner" } });
  h.salonId.mockResolvedValue(SALON);
  givenAppointment("scheduled");
});

describe("POST /api/appointments/[id]/treatment — status wizyty bez zmian, „Nie przyszedł” odrzucone", () => {
  it("wizyta no_show przy odczycie → 409 jak /complete, bez transakcji i zapisów", async () => {
    givenAppointment("no_show");

    const { status, body } = await parseResponse<Body>(await post());

    expect(status).toBe(409);
    expect(body).toEqual({
      success: false,
      code: NO_SHOW_COMPLETE_BLOCKED_CODE,
      error: NO_SHOW_COMPLETE_BLOCKED_MESSAGE,
    });
    expect(h.transactions).toBe(0);
    expect(h.inserts).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it.each(["scheduled", "confirmed", "completed", "cancelled"])(
    "wizyta %s: nowy zabieg zapisany (201), status wizyty bez zmian",
    async (current) => {
      givenAppointment(current);

      const { status, body } = await parseResponse<Body>(await post());

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(h.inserts).toEqual([expect.objectContaining({ _name: "treatmentHistory" })]);
      expect(appointmentUpdates()).toEqual([]);
      // Jedyny odczyt w transakcji to istniejący zabieg — bez odczytu statusu.
      expect(h.selects).toHaveLength(1);
    }
  );

  it("wizyta zaplanowana z istniejącym zabiegiem: aktualizacja zabiegu (200), status bez zmian", async () => {
    h.selectResults = [[{ id: "treatment-1", appointmentId: APPOINTMENT }]];

    const { status } = await parseResponse<Body>(await post({ notes: "Poprawka" }));

    expect(status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect((h.updates[0]!.table as { _name?: string })._name).toBe("treatmentHistory");
    expect(appointmentUpdates()).toEqual([]);
  });

  it("obca wizyta → 404, bez transakcji", async () => {
    h.findOne.mockResolvedValue(null);

    const { status } = await parseResponse<Body>(await post());

    expect(status).toBe(404);
    expect(h.transactions).toBe(0);
  });
});
