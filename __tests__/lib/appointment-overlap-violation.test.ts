/**
 * #171: rozpoznanie naruszenia ograniczenia `appointments_no_overlap` (23P01)
 * w kształtach błędu, które realnie dostaje trasa.
 */
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { APPOINTMENT_NO_OVERLAP_CONSTRAINT, isAppointmentOverlapViolation } from "@/lib/appointment-overlap";

/** Kształt PostgresError z postgres.js (sterownik aplikacji). */
const pgJs = (code: string, constraint_name?: string) =>
  Object.assign(new Error("db"), { code, ...(constraint_name ? { constraint_name } : {}) });

describe("isAppointmentOverlapViolation", () => {
  it("nazwa ograniczenia zgodna z migracją", () => {
    expect(APPOINTMENT_NO_OVERLAP_CONSTRAINT).toBe("appointments_no_overlap");
  });

  it("23P01 appointments_no_overlap opakowany przez Drizzle (cause) → true", () => {
    const err = new DrizzleQueryError("insert ...", [], pgJs("23P01", "appointments_no_overlap"));
    expect(isAppointmentOverlapViolation(err)).toBe(true);
  });

  it("23P01 bez opakowania (postgres.js) → true", () => {
    expect(isAppointmentOverlapViolation(pgJs("23P01", "appointments_no_overlap"))).toBe(true);
  });

  it("23P01 w kształcie node-postgres (`constraint`) → true", () => {
    expect(isAppointmentOverlapViolation({ code: "23P01", constraint: "appointments_no_overlap" })).toBe(true);
  });

  it("23P01 innego ograniczenia → false", () => {
    expect(isAppointmentOverlapViolation(pgJs("23P01", "inne_exclude"))).toBe(false);
  });

  it("23P01 bez nazwy ograniczenia → false", () => {
    expect(isAppointmentOverlapViolation(pgJs("23P01"))).toBe(false);
  });

  it("CHECK appointments_end_after_start (23514) → false (to nie kolizja)", () => {
    const err = new DrizzleQueryError("insert ...", [], pgJs("23514", "appointments_end_after_start"));
    expect(isAppointmentOverlapViolation(err)).toBe(false);
  });

  it("unikalność (23505) z tą samą nazwą → false (liczy się kod)", () => {
    expect(isAppointmentOverlapViolation(pgJs("23505", "appointments_no_overlap"))).toBe(false);
  });

  it.each([null, undefined, "23P01", 23, new Error("boom")])("nie-błąd bazy %p → false", (v) => {
    expect(isAppointmentOverlapViolation(v)).toBe(false);
  });

  it("cykliczny cause nie zapętla", () => {
    const a: { code?: string; cause?: unknown } = { code: "XX000" };
    a.cause = a;
    expect(isAppointmentOverlapViolation(a)).toBe(false);
  });
});
