/**
 * Błąd zakleszczenia (40P01) w kształcie sterownika: postgres.js i node-postgres
 * podają CONTEXT w polu `where`. Tekst z prawdziwego logu bazy (main `db71a43`,
 * scratchpad/team-lead/pg-race-db71a43.log).
 */
export const DEADLOCK_ON_APPOINTMENTS_EXCLUDE =
  'while checking exclusion constraint on tuple (13,108) in relation "appointments"';

/** `where`: domyślnie kontekst EXCLUDE na `appointments`; `null` = bez pola. */
export function deadlock(where: string | null = DEADLOCK_ON_APPOINTMENTS_EXCLUDE): Record<string, unknown> {
  return { code: "40P01", ...(where === null ? {} : { where }) };
}

/** Kształt DrizzleQueryError: błąd sterownika w `cause`. */
export function wrapped(cause: Record<string, unknown>): Error {
  return Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("db"), cause) });
}
