import { describe, it, expect } from "vitest";
import {
  canMarkNoShow,
  canUndoNoShow,
  hasNoShowDayArrived,
  isNoShowMarkRole,
  salonDayKey,
} from "@/lib/no-show";

// 27.11.2026 13:00 w Warszawie (UTC+1).
const NOW = new Date("2026-11-27T12:00:00.000Z");

describe("salonDayKey", () => {
  it("dzień w strefie salonu, nie UTC", () => {
    expect(salonDayKey(new Date("2026-11-27T23:30:00.000Z"))).toBe("2026-11-28");
    expect(salonDayKey(new Date("2026-11-26T23:00:00.000Z"))).toBe("2026-11-27");
  });

  it("czas letni (UTC+2)", () => {
    expect(salonDayKey(new Date("2026-07-14T22:30:00.000Z"))).toBe("2026-07-15");
  });
});

describe("hasNoShowDayArrived", () => {
  it.each([
    ["wczoraj", "2026-11-26T10:00:00.000Z", true],
    ["dziś rano", "2026-11-27T07:00:00.000Z", true],
    ["dziś wieczorem (po „teraz”)", "2026-11-27T20:00:00.000Z", true],
    ["00:30 jutro w Warszawie (dziś w UTC)", "2026-11-27T23:30:00.000Z", false],
    ["za tydzień", "2026-12-04T10:00:00.000Z", false],
  ])("%s → %s", (_label, start, expected) => {
    expect(hasNoShowDayArrived(start, NOW)).toBe(expected);
  });

  it("niepoprawna data → false", () => {
    expect(hasNoShowDayArrived("nie-data", NOW)).toBe(false);
  });

  it("przyjmuje Date i napis ISO", () => {
    expect(hasNoShowDayArrived(new Date("2026-11-26T10:00:00.000Z"), NOW)).toBe(true);
  });
});

describe("role i podpowiedzi interfejsu", () => {
  it("właściciel i recepcja tak, pracownik nie", () => {
    expect(isNoShowMarkRole("owner")).toBe(true);
    expect(isNoShowMarkRole("receptionist")).toBe(true);
    expect(isNoShowMarkRole("employee")).toBe(false);
  });

  it.each(["scheduled", "confirmed"])("canMarkNoShow: %s, dzień nadszedł → true", (status) => {
    expect(canMarkNoShow({ role: "owner", status, startTime: "2026-11-27T07:00:00.000Z" }, NOW)).toBe(true);
  });

  it.each(["completed", "cancelled", "no_show"])("canMarkNoShow: %s → false", (status) => {
    expect(canMarkNoShow({ role: "owner", status, startTime: "2026-11-26T07:00:00.000Z" }, NOW)).toBe(false);
  });

  it("canMarkNoShow: wizyta jutro → false; pracownik → false", () => {
    expect(canMarkNoShow({ role: "owner", status: "scheduled", startTime: "2026-11-28T09:00:00.000Z" }, NOW)).toBe(false);
    expect(canMarkNoShow({ role: "employee", status: "scheduled", startTime: "2026-11-26T09:00:00.000Z" }, NOW)).toBe(false);
  });

  it("canUndoNoShow: tylko no_show i rola oznaczająca", () => {
    expect(canUndoNoShow({ role: "receptionist", status: "no_show" })).toBe(true);
    expect(canUndoNoShow({ role: "employee", status: "no_show" })).toBe(false);
    expect(canUndoNoShow({ role: "owner", status: "scheduled" })).toBe(false);
  });
});
