/**
 * Warunek „wizyta wołającego” (`@/lib/appointment-access`): właściciel
 * i recepcja na każdej wizycie salonu, pracownik tylko na własnej. Przy
 * błędzie warunek zamyka dostęp: pracownik bez identyfikatora pracownika nie
 * dostaje żadnej wizyty (ani w porównaniu, ani w warunku SQL).
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  AppointmentGoneError,
  callerAppointmentWhere,
  isForeignAppointment,
  type AppointmentCaller,
} from "@/lib/appointment-access";

const SALON = "11111111-1111-4111-8111-111111111111";
const APPOINTMENT = "66666666-6666-4666-8666-666666666666";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const OTHER_EMPLOYEE = "33333333-3333-4333-8333-333333333333";

const OWNER: AppointmentCaller = { role: "owner", employeeId: null };
const OWNER_WITH_RECORD: AppointmentCaller = { role: "owner", employeeId: OTHER_EMPLOYEE };
const RECEPTION: AppointmentCaller = { role: "receptionist", employeeId: OTHER_EMPLOYEE };
const EMPLOYEE_CALLER: AppointmentCaller = { role: "employee", employeeId: EMPLOYEE };
const EMPLOYEE_WITHOUT_ID: AppointmentCaller = { role: "employee", employeeId: null };

const dialect = new PgDialect();
function render(caller: AppointmentCaller) {
  return dialect.sqlToQuery(callerAppointmentWhere(caller, SALON, APPOINTMENT));
}

describe("isForeignAppointment", () => {
  it.each([
    ["właściciel bez rekordu pracownika", OWNER],
    ["właściciel z rekordem pracownika", OWNER_WITH_RECORD],
    ["recepcja", RECEPTION],
  ])("%s: wizyta dowolnego pracownika i bez pracownika nie jest cudza", (_n, caller) => {
    expect(isForeignAppointment(caller, EMPLOYEE)).toBe(false);
    expect(isForeignAppointment(caller, null)).toBe(false);
  });

  it("pracownik: własna wizyta nie jest cudza", () => {
    expect(isForeignAppointment(EMPLOYEE_CALLER, EMPLOYEE)).toBe(false);
  });

  it("pracownik: wizyta innego pracownika i wizyta bez pracownika są cudze", () => {
    expect(isForeignAppointment(EMPLOYEE_CALLER, OTHER_EMPLOYEE)).toBe(true);
    expect(isForeignAppointment(EMPLOYEE_CALLER, null)).toBe(true);
  });

  it("pracownik bez identyfikatora pracownika: każda wizyta cudza (przy błędzie zamyka)", () => {
    expect(isForeignAppointment(EMPLOYEE_WITHOUT_ID, EMPLOYEE)).toBe(true);
    expect(isForeignAppointment(EMPLOYEE_WITHOUT_ID, null)).toBe(true);
    expect(isForeignAppointment({ role: "employee", employeeId: "" }, "")).toBe(true);
  });

  it("rola spoza znanych: każda wizyta cudza (przy błędzie zamyka)", () => {
    const unknownRole = { role: "manager", employeeId: null } as unknown as AppointmentCaller;
    expect(isForeignAppointment(unknownRole, EMPLOYEE)).toBe(true);
  });
});

describe("callerAppointmentWhere", () => {
  it.each([
    ["właściciel", OWNER],
    ["właściciel z rekordem pracownika", OWNER_WITH_RECORD],
    ["recepcja", RECEPTION],
  ])("%s: warunek id i salonu, bez warunku pracownika", (_n, caller) => {
    const { sql, params } = render(caller);

    expect(params).toEqual([APPOINTMENT, SALON]);
    expect(sql).not.toContain('"employee_id"');
    expect(sql).not.toContain("false");
  });

  it("pracownik: warunek id, salonu i własnego pracownika", () => {
    const { sql, params } = render(EMPLOYEE_CALLER);

    expect(params).toEqual([APPOINTMENT, SALON, EMPLOYEE]);
    expect(sql).toContain('"appointments"."employee_id" = $3');
  });

  it("pracownik bez identyfikatora pracownika: warunek bez trafień, nie warunek właściciela", () => {
    const { sql, params } = render(EMPLOYEE_WITHOUT_ID);

    expect(params).toEqual([APPOINTMENT, SALON]);
    expect(sql).toMatch(/\bfalse\b/);
    expect(sql).not.toEqual(render(OWNER).sql);
  });
});

describe("AppointmentGoneError", () => {
  it("ma własną nazwę (trasa rozpoznaje go po klasie)", () => {
    const error = new AppointmentGoneError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppointmentGoneError");
  });
});
