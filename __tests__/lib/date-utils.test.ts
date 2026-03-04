import { describe, it, expect } from "vitest";
import {
  getStartOfWeek,
  getEndOfWeek,
  getWeekDays,
  isSameDay,
} from "@/lib/date-utils";

describe("getStartOfWeek", () => {
  it("should return Monday for a date that is a Wednesday", () => {
    // 2024-01-10 is Wednesday
    const wed = new Date(2024, 0, 10, 14, 30);
    const start = getStartOfWeek(wed);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getDate()).toBe(8);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it("should return the same day when input is Monday", () => {
    // 2024-01-08 is Monday
    const mon = new Date(2024, 0, 8, 10, 0);
    const start = getStartOfWeek(mon);
    expect(start.getDate()).toBe(8);
    expect(start.getDay()).toBe(1);
  });

  it("should return previous Monday when input is Sunday", () => {
    // 2024-01-14 is Sunday
    const sun = new Date(2024, 0, 14, 20, 0);
    const start = getStartOfWeek(sun);
    expect(start.getDate()).toBe(8);
    expect(start.getDay()).toBe(1);
  });

  it("should return previous Monday when input is Saturday", () => {
    // 2024-01-13 is Saturday
    const sat = new Date(2024, 0, 13);
    const start = getStartOfWeek(sat);
    expect(start.getDate()).toBe(8);
    expect(start.getDay()).toBe(1);
  });

  it("should handle month boundary correctly", () => {
    // 2024-02-01 is Thursday, week starts on 2024-01-29 Monday
    const thu = new Date(2024, 1, 1);
    const start = getStartOfWeek(thu);
    expect(start.getMonth()).toBe(0); // January
    expect(start.getDate()).toBe(29);
  });

  it("should handle year boundary correctly", () => {
    // 2024-01-01 is Monday
    const newYear = new Date(2024, 0, 1);
    const start = getStartOfWeek(newYear);
    expect(start.getFullYear()).toBe(2024);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(1);
  });

  it("should not mutate the input date", () => {
    const original = new Date(2024, 0, 10, 14, 30);
    const originalTime = original.getTime();
    getStartOfWeek(original);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe("getEndOfWeek", () => {
  it("should return Sunday 23:59:59.999 for a Wednesday input", () => {
    const wed = new Date(2024, 0, 10);
    const end = getEndOfWeek(wed);
    expect(end.getDay()).toBe(0); // Sunday
    expect(end.getDate()).toBe(14);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it("should return the same Sunday when input is Monday", () => {
    const mon = new Date(2024, 0, 8);
    const end = getEndOfWeek(mon);
    expect(end.getDate()).toBe(14);
    expect(end.getDay()).toBe(0);
  });

  it("should return the same day when input is Sunday", () => {
    const sun = new Date(2024, 0, 14);
    const end = getEndOfWeek(sun);
    expect(end.getDate()).toBe(14);
  });

  it("should handle month boundary correctly", () => {
    // 2024-01-29 Monday -> Sunday is 2024-02-04
    const mon = new Date(2024, 0, 29);
    const end = getEndOfWeek(mon);
    expect(end.getMonth()).toBe(1); // February
    expect(end.getDate()).toBe(4);
  });
});

describe("getWeekDays", () => {
  it("should return 7 days starting from Monday", () => {
    const wed = new Date(2024, 0, 10);
    const days = getWeekDays(wed);
    expect(days).toHaveLength(7);
    expect(days[0]!.getDay()).toBe(1); // Monday
    expect(days[6]!.getDay()).toBe(0); // Sunday
  });

  it("should return consecutive days", () => {
    const date = new Date(2024, 0, 10);
    const days = getWeekDays(date);
    for (let i = 1; i < days.length; i++) {
      // Handle month boundaries by checking time diff instead
      const timeDiff = days[i]!.getTime() - days[i - 1]!.getTime();
      expect(timeDiff).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("should match getStartOfWeek for the first day", () => {
    const date = new Date(2024, 0, 10);
    const days = getWeekDays(date);
    const start = getStartOfWeek(date);
    expect(days[0]!.getDate()).toBe(start.getDate());
    expect(days[0]!.getMonth()).toBe(start.getMonth());
  });

  it("should return dates in the same week for any day of the week", () => {
    // Test that giving any day of a week returns the same set of dates
    const monday = new Date(2024, 0, 8);
    const friday = new Date(2024, 0, 12);
    const sundayDays = getWeekDays(new Date(2024, 0, 14));

    const monDays = getWeekDays(monday);
    const friDays = getWeekDays(friday);

    expect(monDays[0]!.getDate()).toBe(friDays[0]!.getDate());
    expect(monDays[0]!.getDate()).toBe(sundayDays[0]!.getDate());
  });
});

describe("isSameDay", () => {
  it("should return true for the same date objects", () => {
    const a = new Date(2024, 0, 10, 8, 0);
    const b = new Date(2024, 0, 10, 20, 30);
    expect(isSameDay(a, b)).toBe(true);
  });

  it("should return false for different dates", () => {
    const a = new Date(2024, 0, 10);
    const b = new Date(2024, 0, 11);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("should return false for same day different month", () => {
    const a = new Date(2024, 0, 10);
    const b = new Date(2024, 1, 10);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("should return false for same day and month but different year", () => {
    const a = new Date(2024, 0, 10);
    const b = new Date(2025, 0, 10);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("should handle midnight boundary", () => {
    const endOfDay = new Date(2024, 0, 10, 23, 59, 59, 999);
    const startOfDay = new Date(2024, 0, 10, 0, 0, 0, 0);
    expect(isSameDay(endOfDay, startOfDay)).toBe(true);
  });

  it("should distinguish just-before and just-after midnight", () => {
    const beforeMidnight = new Date(2024, 0, 10, 23, 59, 59, 999);
    const afterMidnight = new Date(2024, 0, 11, 0, 0, 0, 0);
    expect(isSameDay(beforeMidnight, afterMidnight)).toBe(false);
  });
});
