import { describe, it, expect } from "vitest";
import { checkOutsideSchedule, type DaySchedule } from "@/lib/schedule-utils";

// Grafik: pon-pt 9-17 (dayOfWeek 1-5), sobota 9-14, niedziela wolna
const SCHEDULES: DaySchedule[] = [
  ...[1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startTime: "09:00", endTime: "17:00" })),
  { dayOfWeek: 6, startTime: "09:00", endTime: "14:00" },
];

describe("checkOutsideSchedule", () => {
  it("returns outside=false for a visit inside working hours", () => {
    // Poniedzialek 2026-07-06, 12:00-13:00
    const result = checkOutsideSchedule(SCHEDULES, "2026-07-06", "12:00", 60);
    expect(result.outside).toBe(false);
  });

  it("flags a visit starting after the end of work", () => {
    const result = checkOutsideSchedule(SCHEDULES, "2026-07-06", "20:00", 60);
    expect(result.outside).toBe(true);
    expect(result.reason).toBe("outside_hours");
    expect(result.workStart).toBe("09:00");
    expect(result.workEnd).toBe("17:00");
  });

  it("flags a visit that starts inside but ends after closing", () => {
    // 16:30 + 60 min = 17:30 > 17:00
    const result = checkOutsideSchedule(SCHEDULES, "2026-07-06", "16:30", 60);
    expect(result.outside).toBe(true);
    expect(result.reason).toBe("outside_hours");
  });

  it("flags a visit before the start of work", () => {
    const result = checkOutsideSchedule(SCHEDULES, "2026-07-06", "08:00", 30);
    expect(result.outside).toBe(true);
    expect(result.reason).toBe("outside_hours");
  });

  it("flags a day off (niedziela)", () => {
    // 2026-07-12 to niedziela — brak wpisu w grafiku
    const result = checkOutsideSchedule(SCHEDULES, "2026-07-12", "12:00", 60);
    expect(result.outside).toBe(true);
    expect(result.reason).toBe("day_off");
  });

  it("treats an empty schedule (none saved) as unknown, not outside", () => {
    // Pracownik bez zapisanego grafiku — nie straszymy ostrzezeniem,
    // bo brak danych to nie to samo co dzien wolny
    const result = checkOutsideSchedule([], "2026-07-06", "12:00", 60);
    expect(result.outside).toBe(false);
    expect(result.reason).toBe("no_schedule");
  });
});
