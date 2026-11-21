// @vitest-environment node
/**
 * #193 (ADR-002): `findClientAppointmentForUser` z `system/client-portal.ts`.
 *
 * - pusta tożsamość z sesji = wyjątek, bez zapytania;
 * - warunek tożsamości (`booked_by_user_id = sessionUserId`) i id wizyty siedzą
 *   w funkcji, w jednym `where`;
 * - jawna lista kolumn (bez `notes`, danych gościa, `booked_by_user_id`,
 *   `client_id`, `promo_code_id`, znaczników przypomnień);
 * - dokładny zbiór kluczy DTO; brak wiersza = null.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findClientAppointmentForUser } from "@/lib/server/system/client-portal";

const q = vi.hoisted(() => ({
  rows: [] as unknown[],
  selected: null as Record<string, unknown> | null,
  where: null as unknown,
  calls: 0,
}));

vi.mock("@/lib/server/system/db-system", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "leftJoin", "limit"]) chain[m] = () => chain;
  chain.where = (w: unknown) => {
    q.where = w;
    return chain;
  };
  chain.then = (resolve: (v: unknown[]) => unknown) => resolve(q.rows);
  return {
    dbSystem: {
      select: (cols: Record<string, unknown>) => {
        q.calls++;
        q.selected = cols;
        return chain;
      },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) => new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return {
    appointments: table("appointments"),
    employees: table("employees"),
    salons: table("salons"),
    services: table("services"),
  };
});

const USER = "user-x";
const APPOINTMENT = "3f0c2a8e-6b1d-4c3e-9a7f-2d5e8b1c4a90";
const START = new Date("2099-01-10T10:00:00Z");
const END = new Date("2099-01-10T11:00:00Z");

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: APPOINTMENT,
    salonId: "salon-a",
    serviceId: "service-1",
    employeeId: "employee-1",
    status: "scheduled",
    startTime: START,
    endTime: END,
    depositAmount: "50.00",
    depositPaid: true,
    salonName: "Salon A",
    salonPhone: "+48600100200",
    serviceName: "Strzyzenie",
    servicePrice: "100.00",
    employeeFirstName: "Ola",
    employeeLastName: "Nowak",
    ...overrides,
  };
}

const DTO_KEYS = [
  "appointmentId",
  "depositAmount",
  "depositPaid",
  "employeeId",
  "employeeName",
  "endTime",
  "salonId",
  "salonName",
  "salonPhone",
  "serviceId",
  "serviceName",
  "servicePrice",
  "startTime",
  "status",
];

beforeEach(() => {
  q.rows = [];
  q.selected = null;
  q.where = null;
  q.calls = 0;
});

describe("findClientAppointmentForUser", () => {
  it("pusta tożsamość z sesji: wyjątek, bez zapytania", async () => {
    await expect(findClientAppointmentForUser("", APPOINTMENT)).rejects.toThrow(/sessionUserId/);
    expect(q.calls).toBe(0);
  });

  it("where: id wizyty i booked_by_user_id = tożsamość z sesji", async () => {
    q.rows = [dbRow()];
    await findClientAppointmentForUser(USER, APPOINTMENT);
    expect(q.where).toEqual({
      op: "and",
      args: [
        { op: "eq", col: "appointments.id", val: APPOINTMENT },
        { op: "eq", col: "appointments.bookedByUserId", val: USER },
      ],
    });
  });

  it("jawna lista kolumn bez kolumn zakazanych w portalu", async () => {
    q.rows = [dbRow()];
    await findClientAppointmentForUser(USER, APPOINTMENT);
    const columns = Object.values(q.selected ?? {}).map(String).sort();
    expect(columns).toEqual(
      [
        "appointments.id",
        "appointments.salonId",
        "appointments.serviceId",
        "appointments.employeeId",
        "appointments.status",
        "appointments.startTime",
        "appointments.endTime",
        "appointments.depositAmount",
        "appointments.depositPaid",
        "salons.name",
        "salons.phone",
        "services.name",
        "services.basePrice",
        "employees.firstName",
        "employees.lastName",
      ].sort()
    );
  });

  it("brak wiersza (cudza, nieistniejąca albo dodana przez personel): null", async () => {
    q.rows = [];
    expect(await findClientAppointmentForUser(USER, APPOINTMENT)).toBeNull();
  });

  it("DTO: dokładny zbiór kluczy i wartości", async () => {
    q.rows = [dbRow()];
    const dto = await findClientAppointmentForUser(USER, APPOINTMENT);
    expect(Object.keys(dto!).sort()).toEqual(DTO_KEYS);
    expect(dto).toEqual({
      appointmentId: APPOINTMENT,
      salonId: "salon-a",
      serviceId: "service-1",
      employeeId: "employee-1",
      status: "scheduled",
      startTime: START,
      endTime: END,
      depositAmount: "50.00",
      depositPaid: true,
      salonName: "Salon A",
      salonPhone: "+48600100200",
      serviceName: "Strzyzenie",
      servicePrice: "100.00",
      employeeName: "Ola Nowak",
    });
  });

  it("brak pracownika, usługi i salonu w łączeniu: pola null; depositPaid null → false", async () => {
    q.rows = [
      dbRow({
        employeeFirstName: null,
        employeeLastName: null,
        serviceName: null,
        servicePrice: null,
        salonName: null,
        salonPhone: null,
        depositPaid: null,
      }),
    ];
    const dto = await findClientAppointmentForUser(USER, APPOINTMENT);
    expect(dto).toMatchObject({
      employeeName: null,
      serviceName: null,
      servicePrice: null,
      salonName: null,
      salonPhone: null,
      depositPaid: false,
    });
  });
});
