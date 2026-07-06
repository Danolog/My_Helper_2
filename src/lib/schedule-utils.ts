/**
 * Pomocnicze sprawdzanie, czy termin wizyty miesci sie w grafiku
 * pracownika. Uzywane do nieblokujacego ostrzezenia w panelu
 * (wlasciciel moze swiadomie umowic wizyte poza godzinami — UAT B-4).
 */

export interface DaySchedule {
  dayOfWeek: number; // 0=niedziela ... 6=sobota
  startTime: string; // "09:00"
  endTime: string; // "17:00"
}

export interface OutsideScheduleResult {
  outside: boolean;
  reason?: "outside_hours" | "day_off" | "no_schedule";
  workStart?: string;
  workEnd?: string;
}

function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

export function checkOutsideSchedule(
  schedules: DaySchedule[],
  date: string, // YYYY-MM-DD
  time: string, // HH:MM
  durationMinutes: number,
): OutsideScheduleResult {
  // Brak jakiegokolwiek grafiku = brak danych; nie ostrzegamy
  if (schedules.length === 0) {
    return { outside: false, reason: "no_schedule" };
  }

  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const daySchedule = schedules.find((s) => s.dayOfWeek === dayOfWeek);

  if (!daySchedule) {
    return { outside: true, reason: "day_off" };
  }

  const start = toMinutes(time);
  const end = start + durationMinutes;
  const workStart = toMinutes(daySchedule.startTime);
  const workEnd = toMinutes(daySchedule.endTime);

  if (start < workStart || end > workEnd) {
    return {
      outside: true,
      reason: "outside_hours",
      workStart: daySchedule.startTime,
      workEnd: daySchedule.endTime,
    };
  }

  return { outside: false };
}
