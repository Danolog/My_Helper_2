/**
 * #193: wspólny format zamkniętych list wyjątków w testach bazy (format #230):
 * `{ name, reason, acceptedBy, pr }`, opcjonalnie `kind`.
 * Używają: widoki (`views-privileges.pg.test.ts`), funkcje (`functions-guard.pg.test.ts`).
 */

/** Role akceptujące wyjątek: wyjątki dotyczą uprawnień w bazie, więc wymagane są obie. */
export const ACCEPT_ROLES = ["CTO", "CRCO"];

/** Pozycja listy wyjątków; `pr` — numer PR dodającego wyjątek. */
export type ExceptionEntry = { name: string; kind?: string; reason: string; acceptedBy: string[]; pr: number };

/** Nazwa obiektu: identyfikator bez cudzysłowów. */
export const IDENT_NAME: { pattern: RegExp; rule: string } = { pattern: /^[a-z_][a-z0-9_]*$/, rule: "nazwa spoza [a-z0-9_]" };

/** Naruszenia formatu listy wyjątków (pusta lista = format w porządku). */
export function exceptionFormatViolations(
  list: readonly ExceptionEntry[],
  name: { pattern: RegExp; rule: string } = IDENT_NAME,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const id = e.kind === undefined ? e.name : `${e.name} (${e.kind})`;
    if (!name.pattern.test(e.name)) out.push(`${id}: ${name.rule}`);
    if (seen.has(id)) out.push(`${id}: zdublowana pozycja`);
    seen.add(id);
    const r = typeof e.reason === "string" ? e.reason.trim() : "";
    if (r.length < 20 || !/[.!]$/.test(r) || /[\n.!?]./.test(r.slice(0, -1))) out.push(`${id}: brak jednozdaniowego uzasadnienia`);
    const by = Array.isArray(e.acceptedBy) ? e.acceptedBy : [];
    for (const role of ACCEPT_ROLES) if (!by.includes(role)) out.push(`${id}: brak akceptacji roli ${role}`);
    for (const role of by) if (!ACCEPT_ROLES.includes(role)) out.push(`${id}: akceptacja spoza ról (${ACCEPT_ROLES.join(", ")}): ${role}`);
    if (!Number.isInteger(e.pr) || e.pr <= 0) out.push(`${id}: brak numeru PR dodającego wyjątek (dodatnia liczba całkowita)`);
  }
  return out;
}
