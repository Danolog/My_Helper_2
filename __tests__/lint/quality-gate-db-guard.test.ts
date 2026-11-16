/**
 * #190: bramka CI buduje bazę WYŁĄCZNIE migracjami i sprawdza RLS z 0005.
 *
 * `drizzle-kit push` po `db:migrate` wyłącza RLS i usuwa polityki na 39 tabelach
 * (pomiar #190), więc testy pg i E2E w CI szłyby na bazie bez izolacji salonów.
 * Ten test pada, gdy ktoś przywróci push w którymkolwiek jobie z Postgresem albo
 * przesunie/usunie strażnika `scripts/db-rls-guard.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WF = readFileSync(join(process.cwd(), ".github/workflows/quality-gate.yml"), "utf8");
const GUARD_RUN = "pnpm exec tsx scripts/db-rls-guard.ts";

/** Bez linii komentarza YAML — komentarz o db:push nie jest krokiem. */
const code = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

/** Joby najwyższego poziomu: nazwa → treść (wcięcie 2 spacje pod `jobs:`). */
function jobs(): Map<string, string> {
  const body = WF.slice(WF.indexOf("\njobs:\n") + 7);
  const out = new Map<string, string>();
  const heads = [...body.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.index : body.length;
    out.set(m[1]!, body.slice(m.index, end));
  });
  return out;
}

/** Kroki joba (każdy zaczyna się od `      - ` pod `    steps:`), bez komentarzy. */
function steps(job: string): string[] {
  const s = code(job.slice(job.indexOf("\n    steps:\n")));
  return s.split(/\n(?= {6}- )/).slice(1);
}

const runOf = (step: string) => step.match(/^\s*(?:- )?run:\s*(.+)$/m)?.[1]?.trim() ?? "";

const PG_JOBS = [...jobs()].filter(([, body]) => /\n {4}services:\n {6}postgres:\n/.test(body));

describe("quality-gate.yml: baza CI tylko z migracji + strażnik RLS (#190)", () => {
  it("joby z Postgresem to e2e-smoke i e2e-full", () => {
    expect(PG_JOBS.map(([n]) => n).sort()).toEqual(["e2e-full", "e2e-smoke"]);
  });

  it("nigdzie w workflow (poza komentarzami) nie ma db:push, db:dev ani drizzle-kit push", () => {
    expect(code(WF)).not.toMatch(/\bdb:push\b|\bdb:dev\b|drizzle-kit\s+push/);
  });

  it.each(PG_JOBS)("%s: db:migrate, zaraz po nim strażnik RLS; strażnik przed test:pg, seedem i Playwrightem", (_name, body) => {
    const st = steps(body);
    const runs = st.map(runOf);
    const migrate = runs.indexOf("pnpm db:migrate");
    const guard = runs.indexOf(GUARD_RUN);
    expect(migrate, "krok db:migrate").toBeGreaterThanOrEqual(0);
    expect(runs.filter((r) => r === GUARD_RUN), "dokładnie jeden strażnik").toHaveLength(1);
    expect(guard, "strażnik zaraz po db:migrate").toBe(migrate + 1);
    for (const later of ["pnpm test:pg", "pnpm db:seed:test"]) {
      const at = runs.indexOf(later);
      if (at >= 0) expect(at, later).toBeGreaterThan(guard);
    }
    const pw = runs.findIndex((r) => r.startsWith("pnpm exec playwright test"));
    expect(pw).toBeGreaterThan(guard);
    // Każdy krok odwołujący się do bazy stoi po strażniku.
    st.forEach((s, i) => {
      if (/pnpm (db:|test:pg)|psql /.test(s) && i !== migrate) expect(i, s).toBeGreaterThan(guard);
    });
  });

  it.each(PG_JOBS)("%s: strażnik czyta POSTGRES_URL joba (localhost), bez nadpisania w kroku", (_name, body) => {
    expect(body).toMatch(/\n {6}POSTGRES_URL: postgresql:\/\/[^@\s]+@localhost:5432\/pos_dev\n/);
    const guardStep = steps(body).find((s) => runOf(s) === GUARD_RUN)!;
    expect(guardStep).not.toMatch(/POSTGRES_URL/);
    expect(guardStep).not.toMatch(/continue-on-error|\|\|\s*true/);
  });
});
