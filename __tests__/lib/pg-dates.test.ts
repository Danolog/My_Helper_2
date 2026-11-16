// @vitest-environment node
/**
 * #171: strażnik dat testów pg (__tests__/pg/pg-dates.ts). W CI @ cf2ee2e
 * `at(32, …)` dawał „2099-03-32” → 400 z walidacji i RangeError w Drizzle.
 */
import { describe, expect, it } from "vitest";
import { at, dayRange } from "../pg/pg-dates";

describe("pg-dates.at", () => {
  it("poprawna data ISO w UTC", () => {
    expect(at(1, "00:00")).toBe("2099-03-01T00:00:00.000Z");
    expect(at(31, "23:59")).toBe("2099-03-31T23:59:00.000Z");
    expect(Number.isNaN(new Date(at(31, "10:00")).getTime())).toBe(false);
  });

  it.each([32, 0, -1, 1.5, Number.NaN])("dzień %s → wyjątek z nazwą helpera, nie data", (day) => {
    expect(() => at(day, "10:00")).toThrow(/^pg-dates\.at: dzień .* spoza marca 2099 \(1–31\)$/);
  });

  it.each(["24:00", "10:60", "9:00", "10:00:00", ""])("godzina %j → wyjątek", (hhmm) => {
    expect(() => at(10, hhmm)).toThrow(/^pg-dates\.at: godzina/);
  });
});

describe("pg-dates.dayRange", () => {
  it("31 marca kończy się 1 kwietnia 00:00 (bez at(32))", () => {
    const { from, to } = dayRange(31);
    expect(from.toISOString()).toBe("2099-03-31T00:00:00.000Z");
    expect(to.toISOString()).toBe("2099-04-01T00:00:00.000Z");
  });

  it("zwykły dzień: [00:00, 00:00 następnego dnia)", () => {
    const { from, to } = dayRange(10);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
