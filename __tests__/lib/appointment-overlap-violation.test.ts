/**
 * #171 + zakleszczenie (main `db71a43`): rozpoznanie „termin zajęty” w błędzie
 * zapisu wizyty — w kształtach błędu, które realnie dostaje trasa.
 * 409 tylko dla 23P01 `appointments_no_overlap` i 40P01 przy sprawdzaniu
 * ograniczenia wykluczającego na `appointments`; reszta (także 40001) → 500.
 */
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { APPOINTMENT_NO_OVERLAP_CONSTRAINT, dbErrorCode, isAppointmentSlotTaken } from "@/lib/appointment-overlap";
import { DEADLOCK_ON_APPOINTMENTS_EXCLUDE, deadlock } from "../api/deadlock-fixture";

/** Kształt PostgresError z postgres.js (sterownik aplikacji). */
const pgJs = (code: string, constraint_name?: string) =>
  Object.assign(new Error("db"), { code, ...(constraint_name ? { constraint_name } : {}) });

describe("isAppointmentSlotTaken — 23P01", () => {
  it("nazwa ograniczenia zgodna z migracją", () => {
    expect(APPOINTMENT_NO_OVERLAP_CONSTRAINT).toBe("appointments_no_overlap");
  });

  it("23P01 appointments_no_overlap opakowany przez Drizzle (cause) → true", () => {
    const err = new DrizzleQueryError("insert ...", [], pgJs("23P01", "appointments_no_overlap"));
    expect(isAppointmentSlotTaken(err)).toBe(true);
  });

  it("23P01 bez opakowania (postgres.js) → true", () => {
    expect(isAppointmentSlotTaken(pgJs("23P01", "appointments_no_overlap"))).toBe(true);
  });

  it("23P01 w kształcie node-postgres (`constraint`) → true", () => {
    expect(isAppointmentSlotTaken({ code: "23P01", constraint: "appointments_no_overlap" })).toBe(true);
  });

  it("23P01 innego ograniczenia → false", () => {
    expect(isAppointmentSlotTaken(pgJs("23P01", "inne_exclude"))).toBe(false);
  });

  it("23P01 bez nazwy ograniczenia → false", () => {
    expect(isAppointmentSlotTaken(pgJs("23P01"))).toBe(false);
  });

  it("CHECK appointments_end_after_start (23514) → false (to nie kolizja)", () => {
    const err = new DrizzleQueryError("insert ...", [], pgJs("23514", "appointments_end_after_start"));
    expect(isAppointmentSlotTaken(err)).toBe(false);
  });

  it("unikalność (23505) z tą samą nazwą → false (liczy się kod)", () => {
    expect(isAppointmentSlotTaken(pgJs("23505", "appointments_no_overlap"))).toBe(false);
  });
});

describe("isAppointmentSlotTaken — 40P01 (zakleszczenie przy sprawdzaniu EXCLUDE)", () => {
  it("CONTEXT z prawdziwego logu bazy (db71a43) — taki sam tekst w fiksturze", () => {
    expect(DEADLOCK_ON_APPOINTMENTS_EXCLUDE).toBe(
      'while checking exclusion constraint on tuple (13,108) in relation "appointments"'
    );
  });

  it("40P01 z kontekstem, opakowany przez Drizzle → true", () => {
    const err = new DrizzleQueryError("update ...", [], Object.assign(new Error("deadlock detected"), deadlock()));
    expect(isAppointmentSlotTaken(err)).toBe(true);
  });

  it("40P01 z kontekstem bez opakowania (postgres.js / node-postgres: to samo pole `where`) → true", () => {
    expect(isAppointmentSlotTaken(deadlock())).toBe(true);
  });

  it("kontekst wieloliniowy (CONTEXT z dodatkowymi liniami, np. z funkcji) → true", () => {
    expect(isAppointmentSlotTaken(deadlock(`SQL statement "UPDATE ..."\n${DEADLOCK_ON_APPOINTMENTS_EXCLUDE}`))).toBe(true);
  });

  it.each([
    ["bez pola where", deadlock(null)],
    ["where pusty", deadlock("")],
    ["where nie-tekst", { code: "40P01", where: 42 }],
    ["inna relacja (np. blokada płatności)", deadlock('while checking exclusion constraint on tuple (1,2) in relation "payments"')],
    ["relacja z prefiksem appointments", deadlock('while checking exclusion constraint on tuple (1,2) in relation "appointments_archive"')],
    ["appointments, ale nie ograniczenie wykluczające", deadlock('while updating tuple (1,2) in relation "appointments"')],
    ["komunikat zlokalizowany (inne lc_messages)", deadlock('podczas sprawdzania ograniczenia wykluczającego dla krotki (1,2) w relacji "appointments"')],
  ])("40P01 %s → false (500)", (_n, err) => {
    expect(isAppointmentSlotTaken(err)).toBe(false);
  });

  it("40001 (serialization_failure) z tym samym kontekstem → false (decyzja: 500)", () => {
    expect(isAppointmentSlotTaken({ code: "40001", where: DEADLOCK_ON_APPOINTMENTS_EXCLUDE })).toBe(false);
  });

  it("40P01 z kontekstem na 6. poziomie cause → false (limit głębokości)", () => {
    let err: Record<string, unknown> = deadlock();
    for (let i = 0; i < 5; i++) err = { cause: err };
    expect(isAppointmentSlotTaken(err)).toBe(false);
  });

  it("decyduje PIERWSZY kod w łańcuchu (opakowanie z innym kodem nie przepuszcza 40P01 z cause)", () => {
    expect(isAppointmentSlotTaken({ code: "XX000", cause: deadlock() })).toBe(false);
  });
});

describe("isAppointmentSlotTaken — nie-błędy bazy", () => {
  it.each([null, undefined, "23P01", "40P01", 23, new Error("boom")])("%p → false", (v) => {
    expect(isAppointmentSlotTaken(v)).toBe(false);
  });

  it("cykliczny cause nie zapętla", () => {
    const a: { code?: string; cause?: unknown } = {};
    a.cause = a;
    expect(isAppointmentSlotTaken(a)).toBe(false);
  });
});

describe("dbErrorCode (kod do logów przy 500)", () => {
  it("odwija Drizzle → kod sterownika", () => {
    expect(dbErrorCode(new DrizzleQueryError("q", [], pgJs("40001")))).toBe("40001");
  });

  it("40P01 bez kontekstu → '40P01'", () => {
    expect(dbErrorCode(deadlock(null))).toBe("40P01");
  });

  it.each([null, undefined, new Error("connection reset"), { code: 7 }])("bez kodu tekstowego %p → undefined", (v) => {
    expect(dbErrorCode(v)).toBeUndefined();
  });
});
