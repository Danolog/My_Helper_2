/**
 * GET, PUT i DELETE /api/appointments/[id] — wspólne kody wizyty i statusy HTTP.
 *
 * - Każda odpowiedź 4xx GET, PUT i DELETE ze wspólnej sytuacji (zły id, brak
 *   salonu, brak wizyty, wizyta anulowana, zły JSON, zmiana przypisania przez
 *   pracownika) ma `code` z `@/lib/appointment-codes` i status z mapy
 *   `APPOINTMENT_ERROR_STATUS`. Test deklaruje, które trasy i metody wysyłają
 *   dany kod, i porównuje to z tym, co widzi.
 * - Dla każdego wspólnego kodu (i dla `APPOINTMENT_COMPLETED`) status w trasie
 *   zakończenia jest taki sam jak w GET/PUT/DELETE.
 * - Pracownik w swojej wizycie zmienia termin i notatkę; pracownika, klienta
 *   i usługę zmienia tylko właściciel albo recepcja (inna wartość → 403, ta
 *   sama wartość przechodzi).
 * - Teksty odpowiedzi po polsku; wizyta cudza i nieistniejąca — to samo body.
 * - DELETE po zatwierdzeniu anulowania odpowiada zawsze 200: błąd odczytu
 *   nazw, zwrotu, SMS-a, powiadomienia albo listy oczekujących zostawia ślad
 *   w logu, a nie 500.
 * - DELETE ze złym identyfikatorem → 400 `INVALID_APPOINTMENT_ID` bez odczytu wizyty.
 * - Kolejność: wizyta zakończona innego salonu albo innego pracownika → 404,
 *   nie 409 (odpowiedź nie zdradza, że wizyta istnieje ani jaki ma status).
 * - PUT, którego zapis nie trafił w wiersz, nie odpowiada 200 z `data: null`
 *   (wizyta zniknęła albo, przy zapisie pracownika, przepisana na innego
 *   pracownika → 404).
 * - DELETE: wizyta zniknęła albo, przy odwołaniu przez pracownika, przepisana
 *   na innego pracownika pod blokadą → 404, to samo body co wizyta
 *   nieistniejąca, bez zwrotu, SMS-a, listy oczekujących i bez logu.
 * - DELETE po transakcji bierze kwotę, termin, pracownika, usługę i klienta
 *   ze stanu spod blokady.
 * - Dialog edycji wysyła termin, pracownika, klienta i usługę także przy samej
 *   zmianie notatki: zakończenie wizyty między odczytem a zapisem nie blokuje
 *   samej notatki, jeśli te pola są takie jak w zakończonej wizycie.
 * - Logi błędów GET, PUT i DELETE: nazwa i kod błędu, bez obiektu błędu
 *   (dokładny zestaw kluczy; treść przeszukiwana także w polach `Error`
 *   niewyliczalnych, `loggedText`).
 * - Statusy według ról: 200, 400, 401, 403, 404, 409, 500.
 *
 * Atrapą jest baza (forSalon), sesja i kontekst salonu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, makeAppointment, parseResponse, TEST_IDS } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  salonCtx: vi.fn(),
  refs: vi.fn(),
  findOne: vi.fn(),
  /** Kolejne wyniki tx.select. */
  selectResults: [] as unknown[][],
  /** Kolejne wyniki tx.update(...).returning(); pusta kolejka → `updated`. */
  updateResults: [] as unknown[][],
  update: vi.fn(),
  set: vi.fn(),
  updated: [] as Record<string, unknown>[],
  transactions: 0,
  /** Wartości przekazane do tx.insert(...).values(...). */
  insertValues: vi.fn(),
  /** Błąd zwracany przez tx.insert (null = zapis bez błędu). */
  insertError: null as Error | null,
  cancelInTx: vi.fn(),
  buildSms: vi.fn(),
  expireSessions: vi.fn(),
  notifyWaitingList: vi.fn(),
  refund: vi.fn(),
  NoShowError: class AppointmentMarkedNoShowError extends Error {},
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(actual.eq) };
});
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...a: unknown[]) => h.auth(...a),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: (...a: unknown[]) => h.refs(...a) }));
vi.mock("@/lib/server/repository", () => {
  const select = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "leftJoin", "innerJoin", "for", "orderBy"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      const next = h.selectResults.shift() ?? [];
      return next instanceof Error ? reject(next) : resolve(next);
    };
    return chain;
  };
  const update = (table: unknown) => {
    h.update(table);
    const chain: Record<string, unknown> = {};
    chain.set = (data: unknown) => {
      h.set(data);
      return chain;
    };
    chain.where = () => chain;
    chain.returning = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(h.updateResults.length > 0 ? h.updateResults.shift() : h.updated);
    return chain;
  };
  const insert = () => {
    const chain: Record<string, unknown> = {};
    chain.values = (values: unknown) => {
      h.insertValues(values);
      return chain;
    };
    chain.returning = () => chain;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      h.insertError ? reject(h.insertError) : resolve([]);
    return chain;
  };
  const tx = { select, update, insert };
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
vi.mock("@/lib/deposit-status-events", () => ({ recordDepositStatusEvent: vi.fn() }));
vi.mock("@/lib/refund", () => ({ refundAppointmentDeposits: (...a: unknown[]) => h.refund(...a) }));
vi.mock("@/lib/salon-cancellation", () => ({
  AppointmentMarkedNoShowError: h.NoShowError,
  buildSalonCancellationSms: (...a: unknown[]) => h.buildSms(...a),
  cancelAppointmentInTx: (...a: unknown[]) => h.cancelInTx(...a),
  expireCheckoutSessions: (...a: unknown[]) => h.expireSessions(...a),
}));
vi.mock("@/lib/waiting-list", () => ({ notifyWaitingList: (...a: unknown[]) => h.notifyWaitingList(...a) }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

import { eq } from "drizzle-orm";
import { POST as COMPLETE } from "@/app/api/appointments/[id]/complete/route";
import { DELETE, GET, PUT } from "@/app/api/appointments/[id]/route";
import {
  APPOINTMENT_ERROR_CODES,
  APPOINTMENT_ERROR_STATUS,
  appointmentError,
  type AppointmentErrorKey,
} from "@/lib/appointment-codes";
import { AppointmentGoneError } from "@/lib/appointment-access";
import { APPOINTMENT_COMPLETED_CODE, AppointmentCompletedError } from "@/lib/appointment-completion";
import { appointments } from "@/lib/schema";

const AUTH = { session: { id: "s-1" }, user: { id: "u-owner" } };
const OWNER_CTX = { salonId: SALON, userId: "u-owner", role: "owner", employeeId: null };
const RECEPTION_CTX = { salonId: SALON, userId: "u-rec", role: "receptionist", employeeId: null };
const EMPLOYEE_CTX = { salonId: SALON, userId: "u-emp", role: "employee", employeeId: EMPLOYEE };

type Err = { success: false; error: string; code?: string };
type Ok = { success: true; data: Record<string, unknown> | null; message?: string };

const BAD_ID = "nie-uuid";

const OTHER_CLIENT = "abababab-abab-4bab-8bab-abababababab";
const OTHER_SERVICE = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";

/** Teksty odpowiedzi trasy wizyty. */
const TEXT = {
  salonNotFound: "Nie znaleziono salonu powiązanego z tym kontem.",
  invalidId: "Nieprawidłowy identyfikator wizyty.",
  appointmentNotFound: "Nie znaleziono wizyty. Odśwież kalendarz.",
  appointmentCancelled: "Ta wizyta jest już odwołana.",
  updateFailed: "Nie udało się zapisać zmian w wizycie. Spróbuj ponownie.",
  cancelFailed: "Nie udało się odwołać wizyty. Spróbuj ponownie.",
  assignmentForbidden: "Pracownika, klienta i usługę wizyty zmienia właściciel albo recepcja.",
};

const SKIPPED_TRACE = "[Appointments API] anulowanie zatwierdzone, skutek pominięty";

/**
 * Wywołania loggera jako tekst, z polami `Error` niewyliczalnymi (`message`,
 * `stack`) i przyczyną — `JSON.stringify` samego `Error` ich nie pokazuje,
 * więc asercja „nie zawiera” na zwykłym `JSON.stringify` nie złapałaby logu
 * z całym obiektem błędu.
 */
function loggedText(calls: unknown[][]): string {
  return JSON.stringify(calls, (_key, value: unknown) =>
    value instanceof Error
      ? Object.fromEntries(
          Object.getOwnPropertyNames(value).map((name) => [name, (value as unknown as Record<string, unknown>)[name]])
        )
      : value
  );
}

function get(id = APPOINTMENT) {
  return GET(new Request(`http://localhost:3000/api/appointments/${id}`), createRouteParams(id));
}

function put(body: unknown, id = APPOINTMENT) {
  return PUT(
    createMockRequest(`http://localhost:3000/api/appointments/${id}`, { method: "PUT", body }),
    createRouteParams(id)
  );
}

function del(id = APPOINTMENT) {
  return DELETE(
    new Request(`http://localhost:3000/api/appointments/${id}`, { method: "DELETE" }),
    createRouteParams(id)
  );
}

function complete(id = APPOINTMENT) {
  return COMPLETE(
    createMockRequest(`http://localhost:3000/api/appointments/${id}/complete`, { method: "POST", body: {} }),
    createRouteParams(id)
  );
}

function appt(overrides: Record<string, unknown> = {}) {
  return makeAppointment({
    id: APPOINTMENT,
    salonId: SALON,
    employeeId: EMPLOYEE,
    clientId: TEST_IDS.CLIENT_UUID,
    ...overrides,
  });
}

function givenExisting(overrides: Record<string, unknown> = {}) {
  h.findOne.mockResolvedValue(appt(overrides));
}

/** Odczyt DELETE przed transakcją (wizyta z klientem, pracownikiem i usługą). */
function deleteRow(overrides: Record<string, unknown> = {}) {
  return [{ appointment: appt(overrides), client: null, employee: null, service: null }];
}

/** Body dialogu edycji: termin, pracownik, klient i usługa jak w wizycie, nowa notatka. */
const DIALOG_BODY = {
  startTime: "2026-04-01T10:00:00.000Z",
  endTime: "2026-04-01T11:00:00.000Z",
  employeeId: EMPLOYEE,
  clientId: TEST_IDS.CLIENT_UUID,
  serviceId: TEST_IDS.SERVICE_UUID,
  notes: "Nowa notatka",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResults = [];
  h.updateResults = [];
  h.transactions = 0;
  h.insertError = null;
  h.auth.mockResolvedValue(AUTH);
  h.salonCtx.mockResolvedValue(OWNER_CTX);
  h.refs.mockResolvedValue(null);
  givenExisting();
  h.updated = [appt()];
  h.cancelInTx.mockResolvedValue({
    cancelled: appt({ status: "cancelled" }),
    depositPaid: false,
    variant: "none",
    failedPayments: [],
  });
  h.expireSessions.mockResolvedValue(undefined);
  h.notifyWaitingList.mockResolvedValue({ notified: 0, smsCount: 0, pushCount: 0, errors: 0 });
});

describe("appointment-codes — mapa kod → status HTTP", () => {
  it("każdy wspólny kod ma status w mapie", () => {
    for (const code of Object.values(APPOINTMENT_ERROR_CODES)) {
      expect([400, 403, 404]).toContain(APPOINTMENT_ERROR_STATUS[code]);
    }
    expect(APPOINTMENT_ERROR_STATUS.INVALID_JSON).toBe(400);
    expect(APPOINTMENT_ERROR_STATUS.APPOINTMENT_ASSIGNMENT_FORBIDDEN).toBe(403);
    expect(Object.keys(APPOINTMENT_ERROR_STATUS).sort()).toEqual(Object.values(APPOINTMENT_ERROR_CODES).sort());
  });

  it("appointmentError składa body z kodem i statusem z mapy", () => {
    expect(appointmentError("invalidId", "x")).toEqual({
      status: 400,
      body: { success: false, code: "INVALID_APPOINTMENT_ID", error: "x" },
    });
    expect(appointmentError("appointmentNotFound", "y").status).toBe(404);
  });
});

describe("ten sam kod → ten sam status w complete i w GET/PUT/DELETE", () => {
  type Route = "complete POST" | "GET" | "PUT" | "DELETE";
  type Case = { route: Route; run: () => Promise<Response>; arrange: () => void };

  /**
   * Jawna deklaracja: które trasy i metody wysyłają dany kod. Test porównuje
   * ją z trasami, które naprawdę odpowiedziały tym kodem — usunięcie
   * przypadku albo trasy, która przestała wysyłać kod, daje czerwień.
   */
  const EMITTERS: Record<AppointmentErrorKey, Route[]> = {
    invalidId: ["complete POST", "GET", "PUT", "DELETE"],
    salonNotFound: ["complete POST", "GET", "PUT", "DELETE"],
    appointmentNotFound: ["complete POST", "GET", "PUT", "DELETE"],
    appointmentCancelled: ["complete POST", "DELETE"],
    invalidJson: ["complete POST", "PUT"],
    assignmentForbidden: ["PUT"],
  };

  const badJson = (url: string, method: string) =>
    new Request(url, { method, headers: { "Content-Type": "application/json" }, body: "{nie json" });

  /** Dla każdego wspólnego kodu: jak wywołać tę sytuację w każdej z tras. */
  const cases: Record<AppointmentErrorKey, Case[]> = {
    invalidId: [
      { route: "complete POST", arrange: () => {}, run: () => complete(BAD_ID) },
      { route: "GET", arrange: () => {}, run: () => get(BAD_ID) },
      { route: "PUT", arrange: () => {}, run: () => put({ notes: "x" }, BAD_ID) },
      { route: "DELETE", arrange: () => {}, run: () => del(BAD_ID) },
    ],
    salonNotFound: [
      { route: "complete POST", arrange: () => h.salonCtx.mockResolvedValue(null), run: () => complete() },
      { route: "GET", arrange: () => h.salonCtx.mockResolvedValue(null), run: () => get() },
      { route: "PUT", arrange: () => h.salonCtx.mockResolvedValue(null), run: () => put({ notes: "x" }) },
      { route: "DELETE", arrange: () => h.salonCtx.mockResolvedValue(null), run: () => del() },
    ],
    appointmentNotFound: [
      { route: "complete POST", arrange: () => (h.selectResults = [[]]), run: () => complete() },
      { route: "GET", arrange: () => (h.selectResults = [[]]), run: () => get() },
      { route: "PUT", arrange: () => h.findOne.mockResolvedValue(null), run: () => put({ notes: "x" }) },
      { route: "DELETE", arrange: () => (h.selectResults = [[]]), run: () => del() },
    ],
    appointmentCancelled: [
      {
        route: "complete POST",
        arrange: () => (h.selectResults = [[{ appointment: appt({ status: "cancelled" }), service: null }]]),
        run: () => complete(),
      },
      { route: "DELETE", arrange: () => (h.selectResults = [deleteRow({ status: "cancelled" })]), run: () => del() },
    ],
    invalidJson: [
      {
        route: "complete POST",
        arrange: () => {},
        run: () =>
          COMPLETE(
            badJson(`http://localhost:3000/api/appointments/${APPOINTMENT}/complete`, "POST"),
            createRouteParams(APPOINTMENT)
          ),
      },
      {
        route: "PUT",
        arrange: () => {},
        run: () => PUT(badJson(`http://localhost:3000/api/appointments/${APPOINTMENT}`, "PUT"), createRouteParams(APPOINTMENT)),
      },
    ],
    assignmentForbidden: [
      {
        route: "PUT",
        arrange: () => h.salonCtx.mockResolvedValue(EMPLOYEE_CTX),
        run: () => put({ employeeId: OTHER_EMPLOYEE }),
      },
    ],
  };

  it.each(Object.keys(APPOINTMENT_ERROR_CODES) as AppointmentErrorKey[])("%s", async (key) => {
    const code = APPOINTMENT_ERROR_CODES[key];
    const seen: Array<{ route: Route; status: number; code: string | undefined }> = [];
    for (const c of cases[key]) {
      h.selectResults = [];
      h.salonCtx.mockResolvedValue(OWNER_CTX);
      givenExisting();
      c.arrange();
      const { status, body } = await parseResponse<Err>(await c.run());
      seen.push({ route: c.route, status, code: body.code });
    }
    // Trasy, które odpowiedziały tym kodem, są dokładnie tymi z deklaracji.
    expect(seen.filter((s) => s.code === code).map((s) => s.route)).toEqual(EMITTERS[key]);
    for (const s of seen) {
      expect(s).toEqual({ route: s.route, status: APPOINTMENT_ERROR_STATUS[code], code });
    }
  });

  it("deklaracja obejmuje każdy wspólny kod", () => {
    expect(Object.keys(EMITTERS).sort()).toEqual(Object.keys(APPOINTMENT_ERROR_CODES).sort());
    expect(Object.keys(cases).sort()).toEqual(Object.keys(APPOINTMENT_ERROR_CODES).sort());
  });

  it("APPOINTMENT_COMPLETED: 409 w complete, PUT i DELETE", async () => {
    h.selectResults = [[{ appointment: appt({ status: "completed" }), service: null }]];
    const fromComplete = await parseResponse<Err>(await complete());

    givenExisting({ status: "completed" });
    const fromPut = await parseResponse<Err>(await put({ status: "confirmed" }));

    h.selectResults = [deleteRow({ status: "completed" })];
    const fromDelete = await parseResponse<Err>(await del());

    for (const r of [fromComplete, fromPut, fromDelete]) {
      expect(r.status).toBe(409);
      expect(r.body.code).toBe(APPOINTMENT_COMPLETED_CODE);
    }
  });
});

describe("PUT /api/appointments/[id] — kody 4xx", () => {
  it("zły identyfikator → 400 INVALID_APPOINTMENT_ID, bez odczytu wizyty", async () => {
    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }, BAD_ID));

    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_APPOINTMENT_ID");
    expect(h.findOne).not.toHaveBeenCalled();
    expect(h.transactions).toBe(0);
  });

  it("sesja bez salonu → 404 SALON_NOT_FOUND", async () => {
    h.salonCtx.mockResolvedValue(null);

    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(body.code).toBe("SALON_NOT_FOUND");
  });

  it("brak wizyty → 404 APPOINTMENT_NOT_FOUND", async () => {
    h.findOne.mockResolvedValue(null);

    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.transactions).toBe(0);
  });

  it("401 bez sesji — bez odczytu", async () => {
    h.auth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await put({ notes: "x" });

    expect(res.status).toBe(401);
    expect(h.findOne).not.toHaveBeenCalled();
  });

  it("zły JSON → 400 INVALID_JSON z mapy (wcześniej 500), bez odczytu wizyty i bez logu błędu", async () => {
    const res = await PUT(
      new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{nie json",
      }),
      createRouteParams(APPOINTMENT)
    );
    const { status, body } = await parseResponse<Err>(res);

    expect(status).toBe(400);
    expect(body).toEqual({
      success: false,
      code: "INVALID_JSON",
      error: "Nie udało się odczytać danych formularza. Odśwież stronę i spróbuj ponownie.",
    });
    expect(h.findOne).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("kontrola: poprawny JSON z pustym obiektem → 200", async () => {
    const res = await PUT(
      new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      createRouteParams(APPOINTMENT)
    );

    expect(res.status).toBe(200);
  });

  it("teksty: zły identyfikator, brak salonu, brak wizyty — całe body po polsku", async () => {
    const badId = await parseResponse<Err>(await put({ notes: "x" }, BAD_ID));
    h.salonCtx.mockResolvedValue(null);
    const noSalon = await parseResponse<Err>(await put({ notes: "x" }));
    h.salonCtx.mockResolvedValue(OWNER_CTX);
    h.findOne.mockResolvedValue(null);
    const missing = await parseResponse<Err>(await put({ notes: "x" }));

    expect(badId.body).toEqual({ success: false, code: "INVALID_APPOINTMENT_ID", error: TEXT.invalidId });
    expect(noSalon.body).toEqual({ success: false, code: "SALON_NOT_FOUND", error: TEXT.salonNotFound });
    expect(missing.body).toEqual({ success: false, code: "APPOINTMENT_NOT_FOUND", error: TEXT.appointmentNotFound });
  });

  it.each([
    ["pracownik", EMPLOYEE_CTX],
    ["recepcja", RECEPTION_CTX],
  ])("%s z polem zadatku → 403, bez odczytu wizyty", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);

    const res = await put({ depositPaid: true });

    expect(res.status).toBe(403);
    expect(h.findOne).not.toHaveBeenCalled();
  });
});

describe("PUT — 404 przed 409 na wizycie zakończonej", () => {
  it("wizyta zakończona innego salonu (findOne w salonie z sesji nie znajduje) → 404, nie 409", async () => {
    h.findOne.mockResolvedValue(null);

    const { status, body } = await parseResponse<Err>(await put({ status: "confirmed" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("pracownik: zakończona wizyta innego pracownika, zmiana terminu → 404, nie 409", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ status: "completed", employeeId: OTHER_EMPLOYEE });

    const { status, body } = await parseResponse<Err>(await put({ startTime: "2026-04-01T12:00:00.000Z" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("pracownik: zakończona wizyta innego pracownika, sama notatka → 404, nic nie zapisane", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ status: "completed", employeeId: OTHER_EMPLOYEE });

    const { status } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("kontrola: pracownik, własna wizyta zakończona, zmiana terminu → 409", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ status: "completed" });

    const { status, body } = await parseResponse<Err>(await put({ startTime: "2026-04-01T12:00:00.000Z" }));

    expect(status).toBe(409);
    expect(body.code).toBe(APPOINTMENT_COMPLETED_CODE);
  });

  it("pracownik: wizyta przepisana na innego w trakcie zapisu, a potem zakończona → 404, nie 409", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    // 1) kolizje, 2) blokady czasu, 3) ponowny odczyt po UPDATE bez wiersza.
    h.selectResults = [[], [], [appt({ status: "completed", employeeId: OTHER_EMPLOYEE })]];
    h.updateResults = [[]];

    const { status, body } = await parseResponse<Err>(await put({ startTime: "2026-04-01T10:30:00.000Z" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
  });
});

describe("PUT — zapis bez wiersza nie daje 200 z data: null", () => {
  it("wizyta zakończona, sama notatka, wiersz zniknął przed zapisem → 404", async () => {
    givenExisting({ status: "completed" });
    h.updateResults = [[]];

    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("zmiana statusu, wiersz zniknął przed zapisem → 404 (nie 200 z data: null)", async () => {
    // 1) kolizje, 2) ponowny odczyt — brak wiersza.
    h.selectResults = [[], []];
    h.updateResults = [[]];

    const { status, body } = await parseResponse<Err>(await put({ status: "confirmed" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("sama notatka na wizycie niezakończonej, wiersz zniknął → 404", async () => {
    h.selectResults = [[], []];
    h.updateResults = [[]];

    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("puste body → 200 z wizytą, bez zapisu", async () => {
    const { status, body } = await parseResponse<Ok>(await put({}));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("wizyta zakończona, body bez notatki i bez zmian → 200 z wizytą (nie null), bez zapisu", async () => {
    givenExisting({ status: "completed" });

    const { status, body } = await parseResponse<Ok>(await put({ employeeId: EMPLOYEE }));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT, status: "completed" });
    expect(h.update).not.toHaveBeenCalled();
  });

  // Pracownik nie przekazuje już wizyty innemu (403), więc sprawdzenie kolizji
  // woła eq(employeeId, EMPLOYEE) tak samo dla każdej roli. Warunek wiersza
  // wołającego w UPDATE dokłada u pracownika jedno takie wywołanie więcej.
  const ownEmployeeEqCalls = () =>
    vi.mocked(eq).mock.calls.filter(([column, value]) => column === appointments.employeeId && value === EMPLOYEE)
      .length;

  it("pracownik: UPDATE ma warunek własnego pracownika", async () => {
    h.salonCtx.mockResolvedValue(OWNER_CTX);
    expect((await put({ notes: "x" })).status).toBe(200);
    const ownerCalls = ownEmployeeEqCalls();

    vi.mocked(eq).mockClear();
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    expect((await put({ notes: "x" })).status).toBe(200);

    expect(ownerCalls).toBeGreaterThan(0);
    expect(ownEmployeeEqCalls()).toBe(ownerCalls + 1);
  });

  it.each([
    ["właściciel", OWNER_CTX],
    ["recepcja", RECEPTION_CTX],
  ])("kontrola: %s, UPDATE bez warunku pracownika", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);

    const res = await put({ employeeId: OTHER_EMPLOYEE });

    expect(res.status).toBe(200);
    expect(vi.mocked(eq)).toHaveBeenCalledWith(appointments.employeeId, OTHER_EMPLOYEE);
    expect(vi.mocked(eq)).not.toHaveBeenCalledWith(appointments.employeeId, EMPLOYEE);
  });

  it("UPDATE bez wiersza, wizyta jest i nie jest zakończona → 500, jeden log, bez drugiego UPDATE", async () => {
    // 1) kolizje, 2) ponowny odczyt po UPDATE bez wiersza: wizyta niezakończona.
    h.selectResults = [[], [appt({ status: "confirmed" })]];
    h.updateResults = [[]];

    const { status } = await parseResponse<Err>(await put({ status: "confirmed" }));

    expect(status).toBe(500);
    expect(h.set).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toMatchObject({ errorName: "Error" });
  });
});

describe("PUT — dialog edycji przy zakończeniu w trakcie zapisu", () => {
  it("niezmienione pola z dialogu + nowa notatka, zakończenie przed zapisem → 200, zapis samej notatki", async () => {
    const saved = appt({ status: "completed", notes: "Nowa notatka" });
    // 1) kolizje, 2) ponowny odczyt po UPDATE bez wiersza: wizyta zakończona.
    h.selectResults = [[], [appt({ status: "completed" })]];
    h.updateResults = [[], [saved]];

    const { status, body } = await parseResponse<Ok>(await put(DIALOG_BODY));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT, status: "completed", notes: "Nowa notatka" });
    expect(h.set).toHaveBeenCalledTimes(2);
    expect(h.set.mock.calls[1]![0]).toEqual({ notes: "Nowa notatka" });
    expect(h.transactions).toBe(1);
  });

  it("niezmienione pola z dialogu bez notatki, zakończenie przed zapisem → 200 z wizytą, bez drugiego zapisu", async () => {
    const { notes: _notes, ...withoutNotes } = DIALOG_BODY;
    // 1) kolizje, 2) ponowny odczyt po UPDATE bez wiersza, 3) wizyta do odpowiedzi.
    h.selectResults = [[], [appt({ status: "completed" })], [appt({ status: "completed" })]];
    h.updateResults = [[]];

    const { status, body } = await parseResponse<Ok>(await put(withoutNotes));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT, status: "completed" });
    expect(h.set).toHaveBeenCalledTimes(1);
  });

  it("dialog zmienia termin, zakończenie przed zapisem → 409 APPOINTMENT_COMPLETED, notatka nie zapisana", async () => {
    // 1) kolizje, 2) blokady czasu, 3) ponowny odczyt.
    h.selectResults = [[], [], [appt({ status: "completed" })]];
    h.updateResults = [[]];

    const { status, body } = await parseResponse<Err>(
      await put({ ...DIALOG_BODY, startTime: "2026-04-01T10:30:00.000Z", endTime: "2026-04-01T11:30:00.000Z" })
    );

    expect(status).toBe(409);
    expect(body.code).toBe(APPOINTMENT_COMPLETED_CODE);
    expect(h.set).toHaveBeenCalledTimes(1);
  });

  it("kontrola: dialog bez wyścigu → 200, zapis wszystkich pól z body", async () => {
    const { status, body } = await parseResponse<Ok>(await put(DIALOG_BODY));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT });
    expect(h.set).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.set.mock.calls[0]![0] as object).sort()).toEqual(
      ["clientId", "employeeId", "endTime", "notes", "serviceId", "startTime"]
    );
  });
});

describe("PUT — role", () => {
  it.each([
    ["właściciel", OWNER_CTX],
    ["recepcja", RECEPTION_CTX],
    ["pracownik (własna wizyta)", EMPLOYEE_CTX],
  ])("%s zmienia notatkę → 200", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);

    const { status, body } = await parseResponse<Ok>(await put({ notes: "x" }));

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT });
  });

  it("pracownik: cudza wizyta → 404 z kodem", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ employeeId: OTHER_EMPLOYEE });

    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
  });
});

describe("PUT — pracownika, klienta i usługę zmienia właściciel albo recepcja", () => {
  const FORBIDDEN = {
    success: false,
    code: "APPOINTMENT_ASSIGNMENT_FORBIDDEN",
    error: TEXT.assignmentForbidden,
  };

  /** Zmiana jednego pola przypisania względem wizyty z `appt()`. */
  const CHANGES: Array<[string, Record<string, unknown>]> = [
    ["pracownik", { employeeId: OTHER_EMPLOYEE }],
    ["klient", { clientId: OTHER_CLIENT }],
    ["klient wyczyszczony", { clientId: null }],
    ["usługa", { serviceId: OTHER_SERVICE }],
    ["usługa wyczyszczona", { serviceId: null }],
  ];

  it.each(CHANGES)("pracownik zmienia pole „%s” → 403 z kodem i tekstem, nic nie zapisane", async (_n, change) => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status, body } = await parseResponse<Err>(await put({ ...DIALOG_BODY, ...change }));

    expect(status).toBe(403);
    expect(body).toEqual(FORBIDDEN);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.refs).not.toHaveBeenCalled();
    expect(h.transactions).toBe(0);
  });

  it.each(CHANGES)("pracownik zmienia samo pole „%s” (bez reszty dialogu) → 403", async (_n, change) => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status, body } = await parseResponse<Err>(await put(change));

    expect(status).toBe(403);
    expect(body).toEqual(FORBIDDEN);
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([
    ["właściciel", OWNER_CTX],
    ["recepcja", RECEPTION_CTX],
  ])("%s zmienia pracownika, klienta i usługę → 200, wszystkie trzy w zapisie", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);
    const change = { employeeId: OTHER_EMPLOYEE, clientId: OTHER_CLIENT, serviceId: OTHER_SERVICE };

    const { status } = await parseResponse<Ok>(await put({ ...DIALOG_BODY, ...change }));

    expect(status).toBe(200);
    expect(h.set).toHaveBeenCalledTimes(1);
    expect(h.set.mock.calls[0]![0]).toMatchObject(change);
  });

  it.each([
    ["właściciel", OWNER_CTX],
    ["recepcja", RECEPTION_CTX],
  ])("%s czyści klienta i usługę → 200", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);

    const { status } = await parseResponse<Ok>(await put({ clientId: null, serviceId: null }));

    expect(status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ clientId: null, serviceId: null });
  });

  it("pracownik: body dialogu z tymi samymi wartościami, nowy termin i notatka → 200, w zapisie tylko termin i notatka", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status } = await parseResponse<Ok>(
      await put({ ...DIALOG_BODY, startTime: "2026-04-01T12:00:00.000Z", endTime: "2026-04-01T13:00:00.000Z" })
    );

    expect(status).toBe(200);
    expect(h.set).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.set.mock.calls[0]![0] as object).sort()).toEqual(["endTime", "notes", "startTime"]);
  });

  it("pracownik: puste employeeId (trasa go nie zapisuje) nie jest zmianą → 200", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status } = await parseResponse<Ok>(await put({ employeeId: "", notes: "x" }));

    expect(status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ notes: "x" });
  });

  it("pracownik: wizyta bez klienta i usługi, body z null → 200 (null = null)", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ clientId: null, serviceId: null });

    const { status } = await parseResponse<Ok>(await put({ clientId: null, serviceId: null, notes: "x" }));

    expect(status).toBe(200);
    expect(h.set.mock.calls[0]![0]).toEqual({ notes: "x" });
  });

  it("pracownik: same wartości przypisania bez innych pól → 200 z wizytą, bez zapisu", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);

    const { status, body } = await parseResponse<Ok>(
      await put({ employeeId: EMPLOYEE, clientId: TEST_IDS.CLIENT_UUID, serviceId: TEST_IDS.SERVICE_UUID })
    );

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("pracownik: własna wizyta zakończona, inny klient → 403 (przed 409)", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ status: "completed" });

    const { status, body } = await parseResponse<Err>(await put({ clientId: OTHER_CLIENT }));

    expect(status).toBe(403);
    expect(body).toEqual(FORBIDDEN);
  });

  it("pracownik: cudza wizyta, zmiana pracownika → 404, nie 403 (odmowa nie zdradza wizyty)", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ employeeId: OTHER_EMPLOYEE });

    const { status, body } = await parseResponse<Err>(await put({ employeeId: EMPLOYEE }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("pracownik: przeniesienie na zajęty termin → 409 z kolizją we własnym kalendarzu, bez pytania o kalendarz innego", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    const OWN_OTHER_APPOINTMENT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    // 1) kolizje: wizyta tego samego pracownika.
    h.selectResults = [[{ id: OWN_OTHER_APPOINTMENT }]];

    const { status, body } = await parseResponse<Err & { conflictingAppointment?: { id: string } }>(
      await put({ ...DIALOG_BODY, startTime: "2026-04-01T12:00:00.000Z", endTime: "2026-04-01T13:00:00.000Z" })
    );

    expect(status).toBe(409);
    expect(body.conflictingAppointment).toEqual({ id: OWN_OTHER_APPOINTMENT });
    expect(vi.mocked(eq)).toHaveBeenCalledWith(appointments.employeeId, EMPLOYEE);
    expect(vi.mocked(eq)).not.toHaveBeenCalledWith(appointments.employeeId, OTHER_EMPLOYEE);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("pracownik: przeniesienie do kalendarza innego pracownika → 403 przed sprawdzeniem kolizji", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [[{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }]];

    const { status, body } = await parseResponse<Err>(await put({ ...DIALOG_BODY, employeeId: OTHER_EMPLOYEE }));

    expect(status).toBe(403);
    expect(body).toEqual(FORBIDDEN);
    expect(body).not.toHaveProperty("conflictingAppointment");
    expect(vi.mocked(eq)).not.toHaveBeenCalledWith(appointments.employeeId, OTHER_EMPLOYEE);
  });
});

describe("PUT — 500 i log", () => {
  it("błąd bazy → 500, log z nazwą i kodem błędu, bez obiektu błędu", async () => {
    const dbError = Object.assign(new Error("Failed query: update ...\nparams: Anna,+48123456789"), {
      cause: { code: "57P01" },
    });
    h.selectResults = [dbError as unknown as unknown[]];

    const { status, body } = await parseResponse<Err>(await put({ notes: "Anna" }));

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: TEXT.updateFailed });
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [, meta] = h.logger.error.mock.calls[0]!;
    expect(meta).toMatchObject({ errorName: "Error", errorCode: "57P01" });
    expect(Object.keys(meta as object).sort()).toEqual(["code", "errorCode", "errorName"]);
    expect(loggedText(h.logger.error.mock.calls)).not.toContain("Anna");
  });
});

describe("GET — 500 i log", () => {
  it("błąd bazy → 500, log z tymi samymi kluczami co DELETE, bez obiektu błędu i treści zapytania", async () => {
    const makeError = () =>
      Object.assign(new Error("Failed query: select ...\nparams: Anna,+48123456789"), { cause: { code: "40001" } });

    h.selectResults = [makeError() as unknown as unknown[]];
    const { status } = await parseResponse<Err>(
      await GET(new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}`), createRouteParams(APPOINTMENT))
    );

    expect(status).toBe(500);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const getMeta = h.logger.error.mock.calls[0]![1] as object;
    expect(getMeta).toEqual({ errorName: "Error", errorCode: "40001" });
    expect(loggedText(h.logger.error.mock.calls)).not.toContain("Anna");
    expect(loggedText(h.logger.error.mock.calls)).not.toContain("Failed query");

    h.logger.error.mockClear();
    h.selectResults = [deleteRow()];
    h.cancelInTx.mockRejectedValue(makeError());
    await del();
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(Object.keys(getMeta).sort()).toEqual(Object.keys(h.logger.error.mock.calls[0]![1] as object).sort());
  });
});

describe("GET /api/appointments/[id] — kody 4xx z mapy, polskie teksty", () => {
  it("zły identyfikator → 400 INVALID_APPOINTMENT_ID, bez odczytu wizyty", async () => {
    const { status, body } = await parseResponse<Err>(await get(BAD_ID));

    expect(status).toBe(400);
    expect(body).toEqual({ success: false, code: "INVALID_APPOINTMENT_ID", error: TEXT.invalidId });
    expect(h.transactions).toBe(0);
  });

  it("sesja bez salonu → 404 SALON_NOT_FOUND", async () => {
    h.salonCtx.mockResolvedValue(null);

    const { status, body } = await parseResponse<Err>(await get());

    expect(status).toBe(404);
    expect(body).toEqual({ success: false, code: "SALON_NOT_FOUND", error: TEXT.salonNotFound });
  });

  it("wizyta nieistniejąca i (dla pracownika) wizyta innego pracownika → to samo body 404", async () => {
    h.selectResults = [[]];
    const missing = await parseResponse<Err>(await get());

    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [deleteRow({ employeeId: OTHER_EMPLOYEE })];
    const foreign = await parseResponse<Err>(await get());

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, code: "APPOINTMENT_NOT_FOUND", error: TEXT.appointmentNotFound });
    expect(foreign).toEqual(missing);
  });

  it.each([
    ["właściciel", OWNER_CTX],
    ["recepcja", RECEPTION_CTX],
    ["pracownik (własna wizyta)", EMPLOYEE_CTX],
  ])("%s → 200 z wizytą", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);
    h.selectResults = [deleteRow()];

    const { status, body } = await parseResponse<Ok>(await get());

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ id: APPOINTMENT });
  });

  it("401 bez sesji — bez odczytu", async () => {
    h.auth.mockResolvedValue(new Response(null, { status: 401 }));

    expect((await get()).status).toBe(401);
    expect(h.transactions).toBe(0);
  });
});

describe("DELETE /api/appointments/[id] — kody 4xx", () => {
  it("zły identyfikator → 400 INVALID_APPOINTMENT_ID, bez odczytu wizyty (wcześniej 500 z błędu bazy)", async () => {
    const { status, body } = await parseResponse<Err>(await del(BAD_ID));

    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_APPOINTMENT_ID");
    expect(h.transactions).toBe(0);
    expect(h.cancelInTx).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("sesja bez salonu → 404 SALON_NOT_FOUND", async () => {
    h.salonCtx.mockResolvedValue(null);

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(404);
    expect(body.code).toBe("SALON_NOT_FOUND");
  });

  it("brak wizyty przy odczycie → 404 APPOINTMENT_NOT_FOUND", async () => {
    h.selectResults = [[]];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.cancelInTx).not.toHaveBeenCalled();
  });

  it("wizyta zniknęła przed blokadą → 404 APPOINTMENT_NOT_FOUND, bez logu", async () => {
    h.selectResults = [deleteRow()];
    h.cancelInTx.mockRejectedValue(new AppointmentGoneError());

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("wizyta już anulowana przy odczycie → 400 APPOINTMENT_CANCELLED", async () => {
    h.selectResults = [deleteRow({ status: "cancelled" })];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(400);
    expect(body).toEqual({ success: false, code: "APPOINTMENT_CANCELLED", error: TEXT.appointmentCancelled });
    expect(h.cancelInTx).not.toHaveBeenCalled();
  });

  it("anulowana równolegle (po blokadzie) → 400 APPOINTMENT_CANCELLED, bez zwrotu i SMS", async () => {
    h.selectResults = [deleteRow()];
    h.cancelInTx.mockResolvedValue({ alreadyCancelled: true });

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(400);
    expect(body.code).toBe("APPOINTMENT_CANCELLED");
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.notifyWaitingList).not.toHaveBeenCalled();
  });

  it("401 bez sesji — bez odczytu", async () => {
    h.auth.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await del();

    expect(res.status).toBe(401);
    expect(h.transactions).toBe(0);
  });
});

describe("DELETE — 404 przed 409 na wizycie zakończonej", () => {
  it("wizyta zakończona innego salonu (odczyt w salonie z sesji pusty) → 404, nie 409", async () => {
    h.selectResults = [[]];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.cancelInTx).not.toHaveBeenCalled();
  });

  it("pracownik: zakończona wizyta innego pracownika → 404, nie 409", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [deleteRow({ status: "completed", employeeId: OTHER_EMPLOYEE })];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.cancelInTx).not.toHaveBeenCalled();
  });

  it("kontrola: pracownik, własna wizyta zakończona → 409", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [deleteRow({ status: "completed" })];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(409);
    expect(body.code).toBe(APPOINTMENT_COMPLETED_CODE);
  });
});

describe("DELETE — role, 200 i 500", () => {
  it.each([
    ["właściciel", OWNER_CTX],
    ["recepcja", RECEPTION_CTX],
    ["pracownik (własna wizyta)", EMPLOYEE_CTX],
  ])("%s anuluje → 200", async (_n, ctx) => {
    h.salonCtx.mockResolvedValue(ctx);
    h.selectResults = [deleteRow(), [{ name: "Salon", phone: null }]];

    const { status, body } = await parseResponse<Ok>(await del());

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ status: "cancelled" });
  });

  it("zakończenie po odczycie (po blokadzie) → 409", async () => {
    h.selectResults = [deleteRow()];
    h.cancelInTx.mockRejectedValue(new AppointmentCompletedError());

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(409);
    expect(body.code).toBe(APPOINTMENT_COMPLETED_CODE);
  });

  it("błąd bazy → 500, log z nazwą i kodem błędu, bez obiektu błędu", async () => {
    h.selectResults = [deleteRow()];
    h.cancelInTx.mockRejectedValue(
      Object.assign(new Error("Failed query: update ...\nparams: Anna"), { cause: { code: "40001" } })
    );

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: TEXT.cancelFailed });
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.logger.error.mock.calls[0]![1]).toEqual({ errorName: "Error", errorCode: "40001" });
    expect(loggedText(h.logger.error.mock.calls)).not.toContain("Anna");
  });

  it("błąd listy oczekujących → 200, log z nazwą błędu, bez obiektu błędu", async () => {
    h.selectResults = [deleteRow(), [{ name: "Salon", phone: null }]];
    h.notifyWaitingList.mockRejectedValue(new Error("Failed query: select ...\nparams: Anna"));

    const { status } = await parseResponse<Ok>(await del());

    expect(status).toBe(200);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.logger.error.mock.calls[0]![1]).toEqual({ errorName: "Error" });
    expect(h.logger.warn.mock.calls).toEqual([
      [SKIPPED_TRACE, { appointmentId: APPOINTMENT, step: "waiting_list", hasDeposit: false, depositPaid: false }],
    ]);
  });

  it("błąd zapisu powiadomienia (notifyClient) → 200, jeden log z nazwą błędu i id wizyty, bez parametrów", async () => {
    h.selectResults = [
      [{ appointment: appt(), client: { id: TEST_IDS.CLIENT_UUID }, employee: null, service: null }],
      [{ name: "Salon", phone: null }],
    ];
    h.buildSms.mockReturnValue("tekst");
    h.insertError = new Error("Failed query: insert into notifications ...\nparams: Anna,tekst");

    const res = await DELETE(
      new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}?notifyClient=true`, { method: "DELETE" }),
      createRouteParams(APPOINTMENT)
    );
    const { status, body } = await parseResponse<Ok & { cancellationDetails: { clientNotified: boolean } }>(res);

    expect(status).toBe(200);
    expect(body.cancellationDetails.clientNotified).toBe(false);
    expect(h.insertValues).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.logger.error.mock.calls[0]![0]).toBe("[Appointments API] Failed to create notification");
    expect(h.logger.error.mock.calls[0]![1]).toEqual({ errorName: "Error", appointmentId: APPOINTMENT });
    expect(loggedText(h.logger.error.mock.calls)).not.toContain("Anna");
    // Ślad: anulowanie zatwierdzone, wpis powiadomienia pominięty.
    expect(h.logger.warn.mock.calls).toEqual([
      [SKIPPED_TRACE, { appointmentId: APPOINTMENT, step: "notification", hasDeposit: false, depositPaid: false }],
    ]);
  });
});

describe("404 wizyty cudzej = 404 wizyty nieistniejącej (całe body)", () => {
  it("PUT: wizyta innego pracownika, wizyta nieistniejąca i wizyta przepisana przy zapisie → to samo body", async () => {
    h.findOne.mockResolvedValue(null);
    const missing = await parseResponse<Err>(await put({ notes: "x" }));

    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    givenExisting({ employeeId: OTHER_EMPLOYEE });
    const foreign = await parseResponse<Err>(await put({ notes: "x" }));

    givenExisting();
    // 1) kolizje, 2) ponowny odczyt po UPDATE bez wiersza: wizyta innego pracownika.
    h.selectResults = [[], [appt({ employeeId: OTHER_EMPLOYEE })]];
    h.updateResults = [[]];
    const reassigned = await parseResponse<Err>(await put({ notes: "x" }));

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, code: "APPOINTMENT_NOT_FOUND", error: TEXT.appointmentNotFound });
    expect(foreign).toEqual(missing);
    expect(reassigned).toEqual(missing);
  });

  it("DELETE: wizyta innego pracownika, wizyta nieistniejąca i wizyta przepisana pod blokadą → to samo body", async () => {
    h.selectResults = [[]];
    const missing = await parseResponse<Err>(await del());

    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [deleteRow({ employeeId: OTHER_EMPLOYEE })];
    const foreign = await parseResponse<Err>(await del());

    h.selectResults = [deleteRow()];
    h.cancelInTx.mockRejectedValue(new AppointmentGoneError());
    const reassigned = await parseResponse<Err>(await del());

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, code: "APPOINTMENT_NOT_FOUND", error: TEXT.appointmentNotFound });
    expect(foreign).toEqual(missing);
    expect(reassigned).toEqual(missing);
  });
});

describe("DELETE — pracownik i wizyta przepisana pod blokadą", () => {
  it("pracownik: transakcja dostaje kontekst wołającego (warunek pracownika pod blokadą)", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [deleteRow(), [{ name: "Salon", phone: null }]];

    await del();

    expect(h.cancelInTx).toHaveBeenCalledTimes(1);
    const [, salonId, id, caller] = h.cancelInTx.mock.calls[0]!;
    expect([salonId, id]).toEqual([SALON, APPOINTMENT]);
    expect(caller).toMatchObject({ role: "employee", employeeId: EMPLOYEE });
  });

  it("pracownik: wizyta przepisana pod blokadą → 404, bez zwrotu, SMS-a, listy oczekujących i bez logu z pracownikiem", async () => {
    h.salonCtx.mockResolvedValue(EMPLOYEE_CTX);
    h.selectResults = [
      [{ appointment: appt({ depositAmount: "40.00", depositPaid: true }), client: { id: TEST_IDS.CLIENT_UUID }, employee: null, service: null }],
    ];
    h.cancelInTx.mockRejectedValue(new AppointmentGoneError());

    const res = await DELETE(
      new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}?notifyClient=true`, { method: "DELETE" }),
      createRouteParams(APPOINTMENT)
    );
    const { status, body } = await parseResponse<Err>(res);

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.expireSessions).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.buildSms).not.toHaveBeenCalled();
    expect(h.insertValues).not.toHaveBeenCalled();
    expect(h.notifyWaitingList).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
    const logged = JSON.stringify([h.logger.info.mock.calls, h.logger.debug.mock.calls]);
    expect(logged).not.toContain(EMPLOYEE);
    expect(logged).not.toContain(OTHER_EMPLOYEE);
  });

  it("PUT: pracownik bez identyfikatora pracownika → 404, bez zapisu", async () => {
    h.salonCtx.mockResolvedValue({ ...EMPLOYEE_CTX, employeeId: null });

    const { status, body } = await parseResponse<Err>(await put({ notes: "x" }));

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("pracownik bez identyfikatora pracownika → 404 przed transakcją", async () => {
    h.salonCtx.mockResolvedValue({ ...EMPLOYEE_CTX, employeeId: null });
    h.selectResults = [deleteRow()];

    const { status, body } = await parseResponse<Err>(await del());

    expect(status).toBe(404);
    expect(body.code).toBe("APPOINTMENT_NOT_FOUND");
    expect(h.cancelInTx).not.toHaveBeenCalled();
  });
});

describe("DELETE — po transakcji dane spod blokady", () => {
  const LOCKED_START = new Date("2097-05-04T09:00:00.000Z");
  const LOCKED_END = new Date("2097-05-04T10:30:00.000Z");
  const LOCKED_SERVICE = "88888888-8888-4888-8888-888888888888";
  const LOCKED_CLIENT = "99999999-9999-4999-8999-999999999999";

  function lockedCancel(overrides: Record<string, unknown> = {}) {
    return {
      cancelled: appt({
        status: "cancelled",
        startTime: LOCKED_START,
        endTime: LOCKED_END,
        employeeId: OTHER_EMPLOYEE,
        serviceId: LOCKED_SERVICE,
        clientId: LOCKED_CLIENT,
        depositAmount: "40.00",
        depositPaid: true,
      }),
      depositPaid: true,
      depositAmount: "40.00",
      variant: "manual",
      failedPayments: [],
      ...overrides,
    };
  }

  it("kwota, termin, pracownik, usługa i klient z wiersza spod blokady, nie z odczytu sprzed transakcji", async () => {
    // Odczyt sprzed transakcji: bez zadatku, inny termin, pracownik, usługa i klient.
    h.selectResults = [
      [
        {
          appointment: appt({ depositAmount: null, depositPaid: false }),
          client: { id: TEST_IDS.CLIENT_UUID },
          employee: { firstName: "Stara", lastName: "Osoba" },
          service: { name: "Stara usługa" },
        },
      ],
      // Ponowny odczyt nazw dla identyfikatorów spod blokady: usługa, pracownik.
      [{ name: "Usługa spod blokady" }],
      [{ firstName: "Nowa", lastName: "Osoba" }],
      [{ name: "Salon", phone: null }],
    ];
    h.cancelInTx.mockResolvedValue(lockedCancel());
    h.refund.mockResolvedValue({ success: true, refunded: true, refundId: null, amount: 40, message: "ok" });
    h.buildSms.mockReturnValue("tekst");

    const { status, body } = await parseResponse<
      Ok & { cancellationDetails: { depositAmount: number; hasDeposit: boolean; clientNotified: boolean } }
    >(await del());

    expect(status).toBe(200);
    // Decyzja o zwrocie na kwocie spod blokady (odczyt sprzed transakcji: brak zadatku).
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(body.cancellationDetails).toMatchObject({ depositAmount: 40, hasDeposit: true, clientNotified: true });
    expect(h.buildSms).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: LOCKED_START, serviceName: "Usługa spod blokady", depositAmount: 40 })
    );
    expect(h.insertValues).toHaveBeenCalledWith(expect.objectContaining({ clientId: LOCKED_CLIENT, salonId: SALON }));
    expect(h.notifyWaitingList).toHaveBeenCalledWith({
      salonId: SALON,
      serviceId: LOCKED_SERVICE,
      employeeId: OTHER_EMPLOYEE,
      startTime: LOCKED_START,
      endTime: LOCKED_END,
      serviceName: "Usługa spod blokady",
      employeeName: "Nowa Osoba",
      salonName: "Salon",
    });
  });

  it("kontrola: identyfikatory bez zmian → nazwy z odczytu sprzed transakcji, bez ponownego odczytu", async () => {
    h.selectResults = [
      [
        {
          appointment: appt(),
          client: null,
          employee: { firstName: "Ta", lastName: "Sama" },
          service: { name: "Ta sama usługa" },
        },
      ],
      [{ name: "Salon", phone: null }],
    ];

    const { status } = await parseResponse<Ok>(await del());

    expect(status).toBe(200);
    // Odczyt sprzed transakcji, transakcja anulowania, nazwa salonu — bez czwartego.
    expect(h.transactions).toBe(3);
    expect(h.notifyWaitingList).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "Ta sama usługa", employeeName: "Ta Sama", employeeId: EMPLOYEE })
    );
  });

  it("wizyta bez zadatku pod blokadą → bez zwrotu, choć odczyt sprzed transakcji miał zadatek", async () => {
    h.selectResults = [deleteRow({ depositAmount: "40.00", depositPaid: true }), [{ name: "Salon", phone: null }]];
    h.cancelInTx.mockResolvedValue({
      cancelled: appt({ status: "cancelled" }),
      depositPaid: true,
      depositAmount: null,
      variant: "none",
      failedPayments: [],
    });

    const { status, body } = await parseResponse<Ok & { cancellationDetails: { hasDeposit: boolean } }>(await del());

    expect(status).toBe(200);
    expect(h.refund).not.toHaveBeenCalled();
    expect(body.cancellationDetails.hasDeposit).toBe(false);
  });
});

describe("DELETE — po zatwierdzeniu anulowania zawsze 200, ślad pominiętego kroku", () => {
  const CHANGED_SERVICE = "88888888-8888-4888-8888-888888888888";

  type CancelOk = Ok & {
    cancellationDetails: { refundFailed: boolean; clientNotified: boolean; depositRefunded: boolean };
  };

  /** Wizyta z opłaconym zadatkiem; pod blokadą usługa zmieniona, więc trasa czyta jej nazwę ponownie. */
  function arrangePaidCancel() {
    h.cancelInTx.mockResolvedValue({
      cancelled: appt({ status: "cancelled", serviceId: CHANGED_SERVICE, depositAmount: "40.00", depositPaid: true }),
      depositPaid: true,
      depositAmount: "40.00",
      variant: "manual",
      failedPayments: [],
    });
    h.refund.mockResolvedValue({ success: true, refunded: true, refundId: null, amount: 40, message: "ok" });
    h.buildSms.mockReturnValue("tekst");
  }

  const preRead = () => [
    {
      appointment: appt({ depositAmount: "40.00", depositPaid: true }),
      client: { id: TEST_IDS.CLIENT_UUID },
      employee: { firstName: "Ta", lastName: "Sama" },
      service: { name: "Stara usługa" },
    },
  ];

  const delNotify = () =>
    DELETE(
      new Request(`http://localhost:3000/api/appointments/${APPOINTMENT}?notifyClient=true`, { method: "DELETE" }),
      createRouteParams(APPOINTMENT)
    );

  const trace = (step: string) => [
    SKIPPED_TRACE,
    { appointmentId: APPOINTMENT, step, hasDeposit: true, depositPaid: true },
  ];

  it("odczyt nazw rzuca → 200; zwrot i wygaszenie sesji przed odczytem; SMS i lista z tekstem domyślnym; jeden log i ślad", async () => {
    arrangePaidCancel();
    const namesError = Object.assign(new Error("Failed query: select ...\nparams: Anna"), { cause: { code: "57P01" } });
    // 1) odczyt sprzed transakcji, 2) ponowny odczyt nazwy usługi — błąd.
    h.selectResults = [preRead(), namesError as unknown as unknown[]];
    // Ile odczytów zostało w kolejce w chwili zwrotu i wygaszenia sesji.
    let queuedAtRefund = -1;
    let queuedAtExpire = -1;
    h.refund.mockImplementation(async () => {
      queuedAtRefund = h.selectResults.length;
      return { success: true, refunded: true, refundId: null, amount: 40, message: "ok" };
    });
    h.expireSessions.mockImplementation(async () => {
      queuedAtExpire = h.selectResults.length;
    });

    const { status, body } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cancellationDetails).toMatchObject({ refundFailed: false, depositRefunded: true, clientNotified: true });
    expect(h.refund).toHaveBeenCalledTimes(1);
    // Odczyt nazw jeszcze nie wystartował, gdy szedł zwrot i wygaszenie sesji.
    expect(queuedAtRefund).toBe(1);
    expect(queuedAtExpire).toBe(1);
    expect(h.buildSms).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "Wizyta", salonName: "Salon", salonPhone: null })
    );
    expect(h.insertValues).toHaveBeenCalledTimes(1);
    expect(h.notifyWaitingList).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "Wizyta", employeeName: "Pracownik", salonName: "Salon" })
    );
    expect(h.logger.error.mock.calls).toEqual([
      [
        "[Appointments API] Failed to read names after cancellation",
        { errorName: "Error", errorCode: "57P01", appointmentId: APPOINTMENT },
      ],
    ]);
    expect(h.logger.warn.mock.calls).toEqual([trace("read_names")]);
    expect(loggedText([...h.logger.error.mock.calls, ...h.logger.warn.mock.calls])).not.toContain("Anna");
  });

  it("odczyt nazwy salonu rzuca → 200, nazwa usługi z odczytu, salon z tekstem domyślnym", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), [{ name: "Nowa usługa" }], new Error("salon") as unknown as unknown[]];

    const { status } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(h.buildSms).toHaveBeenCalledWith(expect.objectContaining({ serviceName: "Nowa usługa", salonName: "Salon" }));
    expect(h.notifyWaitingList).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "Nowa usługa", employeeName: "Ta Sama", salonName: "Salon" })
    );
    expect(h.logger.warn.mock.calls).toEqual([trace("read_names")]);
  });

  it("zwrot rzuca → 200 z refundFailed, ślad „refund”, SMS i lista nadal wysłane", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), [{ name: "Nowa usługa" }], [{ name: "Salon A", phone: null }]];
    h.refund.mockRejectedValue(new Error("operator płatności niedostępny"));

    const { status, body } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(body.cancellationDetails).toMatchObject({ refundFailed: true, depositRefunded: false, clientNotified: true });
    expect(h.notifyWaitingList).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.logger.error.mock.calls[0]![1]).toEqual({ errorName: "Error", appointmentId: APPOINTMENT });
    expect(h.logger.warn.mock.calls).toEqual([trace("refund")]);
  });

  it("zwrot nieudany (bez wyjątku) → 200 z refundFailed, log ręcznego zwrotu i ślad „refund”", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), [{ name: "Nowa usługa" }], [{ name: "Salon A", phone: null }]];
    h.refund.mockResolvedValue({ success: false, refunded: false, refundId: null, amount: 0, failedAmount: 40, message: "x" });

    const { status, body } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(body.cancellationDetails.refundFailed).toBe(true);
    expect(h.logger.warn.mock.calls).toEqual([trace("refund")]);
  });

  it("wygaszenie sesji płatności rzuca → 200, zwrot wywołany, ślad „expire_checkout_sessions”", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), [{ name: "Nowa usługa" }], [{ name: "Salon A", phone: null }]];
    h.expireSessions.mockRejectedValue(new Error("stripe"));

    const { status } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.logger.warn.mock.calls).toEqual([trace("expire_checkout_sessions")]);
  });

  it("budowa SMS-a rzuca → 200, bez wpisu powiadomienia, ślad „sms”", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), [{ name: "Nowa usługa" }], [{ name: "Salon A", phone: null }]];
    h.buildSms.mockImplementation(() => {
      throw new Error("sms");
    });

    const { status, body } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(body.cancellationDetails.clientNotified).toBe(false);
    expect(h.insertValues).not.toHaveBeenCalled();
    expect(h.logger.warn.mock.calls).toEqual([trace("sms")]);
  });

  it("każdy krok po zatwierdzeniu rzuca → nadal 200 z sukcesem, ślad każdego kroku", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), new Error("names") as unknown as unknown[]];
    h.expireSessions.mockRejectedValue(new Error("stripe"));
    h.refund.mockRejectedValue(new Error("refund"));
    h.buildSms.mockImplementation(() => {
      throw new Error("sms");
    });
    h.notifyWaitingList.mockRejectedValue(new Error("list"));

    const { status, body } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(h.logger.warn.mock.calls).toEqual([
      trace("expire_checkout_sessions"),
      trace("refund"),
      trace("read_names"),
      trace("sms"),
      trace("waiting_list"),
    ]);
  });

  it("kontrola: wszystkie kroki udane → 200, bez śladu i bez logu błędu", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead(), [{ name: "Nowa usługa" }], [{ name: "Salon A", phone: null }]];

    const { status, body } = await parseResponse<CancelOk>(await delNotify());

    expect(status).toBe(200);
    expect(body.cancellationDetails).toMatchObject({ refundFailed: false, clientNotified: true });
    expect(h.buildSms).toHaveBeenCalledWith(expect.objectContaining({ serviceName: "Nowa usługa", salonName: "Salon A" }));
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it("kontrola: błąd przed zatwierdzeniem → 500 z tekstem odwołania, bez zwrotu i bez śladu", async () => {
    arrangePaidCancel();
    h.selectResults = [preRead()];
    h.cancelInTx.mockRejectedValue(new Error("serialization"));

    const { status, body } = await parseResponse<Err>(await delNotify());

    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: TEXT.cancelFailed });
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});
