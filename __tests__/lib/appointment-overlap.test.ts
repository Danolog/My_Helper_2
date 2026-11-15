/**
 * #165: jedna definicja kolizji terminów — przedział półotwarty `[start, end)`.
 * Predykat SQL sprawdzany po wyrenderowaniu przez PgDialect (prawdziwy drizzle).
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect } from "vitest";
import { appointmentConflictWhere, assertValidRange, overlapsRange, rangesOverlap } from "@/lib/appointment-overlap";
import { timeBlocks } from "@/lib/schema";

const at = (hhmm: string) => new Date(`2026-08-01T${hhmm}:00.000Z`);
const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(q);

describe("rangesOverlap — [start, end)", () => {
  it("styk 10–11 / 11–12 nie koliduje", () => {
    expect(rangesOverlap(at("10:00"), at("11:00"), at("11:00"), at("12:00"))).toBe(false);
  });

  it("styk z drugiej strony 11–12 / 10–11 nie koliduje", () => {
    expect(rangesOverlap(at("11:00"), at("12:00"), at("10:00"), at("11:00"))).toBe(false);
  });

  it("nakładanie o 1 minutę koliduje (z obu stron)", () => {
    expect(rangesOverlap(at("10:00"), at("11:01"), at("11:00"), at("12:00"))).toBe(true);
    expect(rangesOverlap(at("11:00"), at("12:00"), at("10:00"), at("11:01"))).toBe(true);
  });

  it("zawieranie w obie strony koliduje", () => {
    expect(rangesOverlap(at("10:00"), at("13:00"), at("11:00"), at("12:00"))).toBe(true);
    expect(rangesOverlap(at("11:00"), at("12:00"), at("10:00"), at("13:00"))).toBe(true);
  });

  it("identyczne przedziały kolidują", () => {
    expect(rangesOverlap(at("10:00"), at("11:00"), at("10:00"), at("11:00"))).toBe(true);
  });

  it("rozłączne nie kolidują", () => {
    expect(rangesOverlap(at("08:00"), at("09:00"), at("10:00"), at("11:00"))).toBe(false);
  });

  it("działa na minutach od północy (available-slots)", () => {
    expect(rangesOverlap(600, 660, 660, 720)).toBe(false);
    expect(rangesOverlap(600, 661, 660, 720)).toBe(true);
  });
});

describe("overlapsRange — predykat SQL", () => {
  it("renderuje dokładnie start < $end and end > $start", () => {
    const q = render(overlapsRange(timeBlocks.startTime, timeBlocks.endTime, at("10:00"), at("11:00")));
    expect(q.sql).toBe('("time_blocks"."start_time" < $1 and "time_blocks"."end_time" > $2)');
    expect(q.params).toEqual([at("11:00").toISOString(), at("10:00").toISOString()]);
  });
});

describe("appointmentConflictWhere", () => {
  it("pracownik + nieanulowane + półotwarte nakładanie (bez salonu i bez wykluczenia)", () => {
    const q = render(appointmentConflictWhere({ employeeId: "emp-1", start: at("10:00"), end: at("11:00") }));
    expect(q.sql).toBe(
      '("appointments"."employee_id" = $1 and not "appointments"."status" = $2' +
        ' and ("appointments"."start_time" < $3 and "appointments"."end_time" > $4))'
    );
    expect(q.params).toEqual(["emp-1", "cancelled", at("11:00").toISOString(), at("10:00").toISOString()]);
  });

  it("z salonem i wykluczeniem wizyty (edycja nie koliduje sama ze sobą)", () => {
    const q = render(
      appointmentConflictWhere({
        salonId: "salon-1",
        employeeId: "emp-1",
        start: at("10:00"),
        end: at("11:00"),
        excludeId: "apt-1",
      })
    );
    expect(q.sql).toBe(
      '("appointments"."employee_id" = $1 and "appointments"."salon_id" = $2' +
        ' and not "appointments"."id" = $3 and not "appointments"."status" = $4' +
        ' and ("appointments"."start_time" < $5 and "appointments"."end_time" > $6))'
    );
    expect(q.params).toEqual([
      "emp-1",
      "salon-1",
      "apt-1",
      "cancelled",
      at("11:00").toISOString(),
      at("10:00").toISOString(),
    ]);
  });

  it("excludeId null nie dodaje warunku", () => {
    const q = render(
      appointmentConflictWhere({ employeeId: "emp-1", start: at("10:00"), end: at("11:00"), excludeId: null })
    );
    expect(q.sql).not.toContain('"appointments"."id"');
  });

  it("nigdy nie używa porównań włącznie", () => {
    const q = render(
      appointmentConflictWhere({ salonId: "s", employeeId: "e", start: at("10:00"), end: at("11:00"), excludeId: "x" })
    );
    expect(q.sql).not.toMatch(/<=|>=/);
  });
});

describe("przedział pusty lub odwrócony (obrona w głębi)", () => {
  const cases: Array<[string, Date, Date]> = [
    ["pusty (end = start)", at("10:00"), at("10:00")],
    ["odwrócony (end < start)", at("11:00"), at("10:00")],
    ["nieprawidłowa data", new Date("nie-data"), at("10:00")],
  ];

  it.each(cases)("appointmentConflictWhere rzuca RangeError: %s", (_n, start, end) => {
    expect(() => appointmentConflictWhere({ employeeId: "e", start, end })).toThrow(RangeError);
  });

  it.each(cases)("overlapsRange rzuca RangeError: %s", (_n, start, end) => {
    expect(() => overlapsRange(timeBlocks.startTime, timeBlocks.endTime, start, end)).toThrow(RangeError);
  });

  it("assertValidRange przepuszcza przedział 1 ms", () => {
    expect(() => assertValidRange(at("10:00"), new Date(at("10:00").getTime() + 1))).not.toThrow();
  });

  it("rangesOverlap: przedział pusty nie koliduje z niczym (bez wyjątku — sloty)", () => {
    expect(rangesOverlap(600, 600, 0, 1440)).toBe(false);
    expect(rangesOverlap(0, 1440, 600, 600)).toBe(false);
  });
});
