import { describe, it, expect } from "vitest";
import {
  canMarkNoShow,
  canUndoNoShow,
  hasNoShowDayArrived,
  isNoShowMarkRole,
  noShowErrorToastMessage,
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

  describe("granica dnia w Warszawie: wizyta 28.11 o 00:30 (27.11 23:30 UTC)", () => {
    const START = "2026-11-27T23:30:00.000Z";

    it("27.11 23:59:59 w Warszawie (ten sam dzień w UTC co wizyta) → jeszcze nie", () => {
      expect(hasNoShowDayArrived(START, new Date("2026-11-27T22:59:59.999Z"))).toBe(false);
    });

    it("27.11 23:40 UTC to już 28.11 w Warszawie, po godzinie wizyty → tak", () => {
      expect(hasNoShowDayArrived(START, new Date("2026-11-27T23:40:00.000Z"))).toBe(true);
    });

    it("28.11 00:00 w Warszawie, przed godziną wizyty → tak (cały dzień, bez godziny)", () => {
      const midnight = new Date("2026-11-27T23:00:00.000Z");
      expect(hasNoShowDayArrived(START, midnight)).toBe(true);
      expect(canMarkNoShow({ role: "owner", status: "scheduled", startTime: START }, midnight)).toBe(true);
    });
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

describe("noShowErrorToastMessage", () => {
  const FALLBACK = "Nie udało się oznaczyć wizyty";

  it.each([400, 404, 409])("%i: komunikat z serwera", (status) => {
    expect(noShowErrorToastMessage(status, "Nie znaleziono wizyty", FALLBACK)).toBe("Nie znaleziono wizyty");
  });

  it.each([400, 404, 409])("%i bez tekstu albo z tekstem nie-napisem → tekst zastępczy", (status) => {
    expect(noShowErrorToastMessage(status, "  ", FALLBACK)).toBe(FALLBACK);
    expect(noShowErrorToastMessage(status, { message: "x" }, FALLBACK)).toBe(FALLBACK);
    expect(noShowErrorToastMessage(status, undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("401: stały tekst, nie komunikat techniczny z warstwy sesji", () => {
    expect(noShowErrorToastMessage(401, "Unauthorized", FALLBACK)).toBe("Sesja wygasła. Zaloguj się ponownie.");
  });

  it("403: stały tekst", () => {
    expect(noShowErrorToastMessage(403, "Forbidden", FALLBACK)).toBe("Brak uprawnień");
  });

  it.each([500, 502, 0])("%i: tekst zastępczy, bez treści z odpowiedzi", (status) => {
    expect(noShowErrorToastMessage(status, "connection refused", FALLBACK)).toBe(FALLBACK);
  });
});
