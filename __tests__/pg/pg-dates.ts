/**
 * Daty testów pg w marcu 2099 r. (UTC) — każdy test na osobnym dniu.
 *
 * #171 (CI @ cf2ee2e): `at(32, …)` składał „2099-03-32”, czyli datę, której nie
 * ma. Trasa odrzucała ją walidacją (400 zamiast 201/409), a `new Date(…)` w
 * zapytaniu testu dawał Invalid Date → RangeError w Drizzle. Strażnik rzuca
 * od razu, z nazwą helpera i dniem, zanim zła data dotrze do trasy albo bazy.
 */
const YEAR_MONTH = "2099-03";
const DAYS_IN_MONTH = 31;

export function at(day: number, hhmm: string): string {
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH) {
    throw new Error(`pg-dates.at: dzień ${day} spoza marca 2099 (1–${DAYS_IN_MONTH})`);
  }
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`pg-dates.at: godzina "${hhmm}" spoza 00:00–23:59`);
  }
  return `${YEAR_MONTH}-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;
}

/** Półotwarty przedział [początek dnia, początek następnego dnia) — także dla 31 marca. */
export function dayRange(day: number): { from: Date; to: Date } {
  const from = new Date(at(day, "00:00"));
  return { from, to: new Date(from.getTime() + 24 * 60 * 60 * 1000) };
}
