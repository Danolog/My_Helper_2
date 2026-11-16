/**
 * #190: bramka CI buduje bazę WYŁĄCZNIE migracjami i sprawdza RLS z 0005.
 *
 * `drizzle-kit push` po `db:migrate` wyłącza RLS i usuwa polityki na 39 tabelach
 * (pomiar #190), więc testy pg i E2E w CI szłyby na bazie bez izolacji salonów.
 * Ten test pada, gdy:
 * - push wróci w którymkolwiek jobie z Postgresem — wprost albo przez skrypt
 *   z package.json (rozwijany rekurencyjnie; #194 Z1, mutant W5 Leo);
 * - strażnik `scripts/db-rls-guard.ts` zniknie, zostanie wyciszony albo przesunięty:
 *   musi stać zaraz po `db:migrate` ORAZ jako ostatni krok z `run:` w jobie
 *   (po Playwrightcie, `if: ${{ !cancelled() }}`), tak żeby RLS zdjęte w trakcie
 *   joba w dowolnej postaci dawało czerwony job.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WF = readFileSync(join(ROOT, ".github/workflows/quality-gate.yml"), "utf8");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
const GUARD_RUN = "pnpm exec tsx scripts/db-rls-guard.ts";
const FINAL_IF = "${{ !cancelled() }}";
/** Zakazane w rozwiniętym poleceniu kroku joba z bazą (Oliver, #194 Z1). */
const PUSH = /drizzle-kit\s+push|\bdb:push\b|\bdb:dev\b/;

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

/** Polecenie kroku: jednoliniowe `run: x` albo blok `run: |` (wszystkie linie). */
function runOf(step: string): string {
  const m = step.match(/^\s*(?:- )?run:\s*(.*)$/m);
  if (!m) return "";
  if (m[1]!.trim() !== "|" && m[1]!.trim() !== ">-" && m[1]!.trim() !== ">") return m[1]!.trim();
  const after = step.slice(step.indexOf(m[0]) + m[0].length).split("\n").slice(1);
  return after.filter((l) => /^ {10}/.test(l)).map((l) => l.trim()).join("\n");
}

/**
 * Rozwinięcie polecenia przez skrypty package.json, rekurencyjnie: wynik to tekst
 * polecenia i treści wszystkich osiągalnych skryptów. Znane kształty (obecne w repo):
 * - `pnpm exec <polecenie…>` — polecenie zostaje w tekście (sprawdzane wprost);
 * - `pnpm install [--flagi]`;
 * - `pnpm <skrypt>` / `pnpm run <skrypt>` ze skryptem z package.json.
 * Każdy inny kształt (`pnpm -r …`, `pnpm --filter …`, `pnpm run -r …`, nieznany
 * skrypt, `npm run`/`yarn`, pętla skryptów) = wyjątek, czyli PORAŻKA testu,
 * nie przepuszczenie.
 */
function expandScripts(cmd: string, scripts: Record<string, string>, seen: string[] = []): string {
  const parts = [cmd];
  if (/\b(?:npm\s+run|yarn)\b/.test(cmd)) throw new Error(`nieznany kształt (npm run / yarn): ${cmd}`);
  for (const m of cmd.matchAll(/\bpnpm\b((?:\s+[^\s&|;]+)*)/g)) {
    const [first, second] = m[1]!.trim().split(/\s+/);
    if (first === "exec") continue;
    if (first === "install" && (second === undefined || second.startsWith("--"))) continue;
    const name = first === "run" ? second : first;
    if (!name || name.startsWith("-") || !Object.prototype.hasOwnProperty.call(scripts, name)) {
      throw new Error(`nieznany kształt wywołania pnpm: pnpm${m[1]}`);
    }
    if (seen.includes(name)) throw new Error(`pętla skryptów: ${[...seen, name].join(" → ")}`);
    parts.push(expandScripts(scripts[name]!, scripts, [...seen, name]));
  }
  return parts.join("\n");
}

const PG_JOBS = [...jobs()].filter(([, body]) => /\n {4}services:\n {6}postgres:\n/.test(body));

describe("quality-gate.yml: baza CI tylko z migracji + strażnik RLS (#190)", () => {
  it("joby z Postgresem to e2e-smoke i e2e-full", () => {
    expect(PG_JOBS.map(([n]) => n).sort()).toEqual(["e2e-full", "e2e-smoke"]);
  });

  it("nigdzie w workflow (poza komentarzami) nie ma db:push, db:dev ani drizzle-kit push", () => {
    expect(code(WF)).not.toMatch(/\bdb:push\b|\bdb:dev\b|drizzle-kit\s+push/);
  });

  it.each(PG_JOBS)("%s: żaden krok — także przez skrypty package.json — nie uruchamia push (drizzle-kit push, db:push, db:dev)", (_name, body) => {
    for (const s of steps(body)) {
      const cmd = runOf(s);
      if (!cmd) continue;
      expect(expandScripts(cmd, PKG.scripts), cmd).not.toMatch(PUSH);
    }
  });

  it.each(PG_JOBS)("%s: strażnik zaraz po db:migrate i jako ostatni krok z run:, wszystkie kroki z bazą pomiędzy", (_name, body) => {
    const st = steps(body);
    const runs = st.map(runOf);
    const migrate = runs.indexOf("pnpm db:migrate");
    const guards = runs.flatMap((r, i) => (r === GUARD_RUN ? [i] : []));
    expect(migrate, "krok db:migrate").toBeGreaterThanOrEqual(0);
    expect(guards, "dokładnie dwa strażniki").toHaveLength(2);
    const [first, last] = guards as [number, number];
    expect(first, "strażnik zaraz po db:migrate").toBe(migrate + 1);
    const lastRun = runs.reduce((acc, r, i) => (r ? i : acc), -1);
    expect(last, "strażnik końcowy to ostatni krok z run:").toBe(lastRun);
    const pw = runs.findIndex((r) => r.startsWith("pnpm exec playwright test"));
    expect(pw).toBeGreaterThan(first);
    expect(pw).toBeLessThan(last);
    // Przed migracją z poleceń tylko instalacja zależności; każdy inny krok z run: między strażnikami.
    runs.forEach((r, i) => {
      if (!r || i === migrate || i === first || i === last) return;
      if (i < migrate) expect(r, `przed migracją: ${r}`).toBe("pnpm install --frozen-lockfile");
      else expect(i > first && i < last, `między strażnikami: ${r}`).toBe(true);
    });
  });

  it.each(PG_JOBS)("%s: strażniki nie są wyciszone; pierwszy bez if:, końcowy z if: !cancelled()", (_name, body) => {
    const st = steps(body).filter((s) => runOf(s) === GUARD_RUN);
    expect(st).toHaveLength(2);
    for (const s of st) {
      expect(s).not.toMatch(/continue-on-error|\|\|\s*true|POSTGRES_URL/);
    }
    expect(st[0]).not.toMatch(/^\s*if:/m);
    const cond = st[1]!.match(/^\s*if:\s*(.+)$/m)?.[1]?.trim();
    expect(cond).toBe(FINAL_IF);
  });

  it.each(PG_JOBS)("%s: strażnik czyta POSTGRES_URL joba (localhost)", (_name, body) => {
    expect(body).toMatch(/\n {6}POSTGRES_URL: postgresql:\/\/[^@\s]+@localhost:5432\/pos_dev\n/);
  });
});

describe("expandScripts — rozwijanie skryptów package.json", () => {
  const scripts: Record<string, string> = {
    "db:sync": "drizzle-kit push",
    "db:prep": "pnpm db:migrate && pnpm run db:sync",
    "db:alias": "tsx gate.ts && pnpm run db:sync",
    "db:migrate": "drizzle-kit migrate",
    build: "pnpm run db:migrate && next build",
    check: "pnpm lint && pnpm typecheck",
    lint: "eslint .",
    typecheck: "tsc --noEmit",
    loop: "pnpm loop",
  };

  it.each([
    ["pnpm db:sync", true],
    ["pnpm run db:sync", true],
    ["pnpm db:prep (przez &&)", true],
    ["pnpm db:alias (skrypt po innym poleceniu)", true],
    ["pnpm db:migrate", false],
    ["pnpm build", false],
    ["pnpm check", false],
    ["pnpm exec tsx x.ts", false],
    ["pnpm install --frozen-lockfile", false],
    ["pnpm exec drizzle-kit push", true],
  ])("%s → zakazane: %s", (cmd, push) => {
    expect(PUSH.test(expandScripts(cmd.replace(/ \(.*\)$/, ""), scripts))).toBe(push);
  });

  it.each([
    ["pnpm -r db:migrate"],
    ["pnpm --filter app db:migrate"],
    ["pnpm run -r db:migrate"],
    ["pnpm nieznany-skrypt"],
    ["pnpm run"],
    ["pnpm install some-pkg"],
    ["npm run db:migrate"],
    ["yarn db:migrate"],
    ["pnpm loop"],
  ])("nieznany kształt %j → wyjątek (porażka), nie przepuszczenie", (cmd) => {
    expect(() => expandScripts(cmd, scripts)).toThrow(/nieznany kształt|pętla/);
  });

  it("realne package.json: pnpm db:push / db:dev / build / check rozwijają się bez wyjątku; push wykryty", () => {
    expect(expandScripts("pnpm db:push", PKG.scripts)).toMatch(/drizzle-kit\s+push/);
    expect(expandScripts("pnpm db:dev", PKG.scripts)).toMatch(PUSH);
    expect(expandScripts("pnpm build", PKG.scripts)).not.toMatch(PUSH);
    expect(expandScripts("pnpm check", PKG.scripts)).not.toMatch(PUSH);
  });

  it("blok `run: |` jest czytany w całości", () => {
    const step = "      - name: x\n        run: |\n          echo a\n          pnpm db:sync\n";
    expect(runOf(step)).toBe("echo a\npnpm db:sync");
  });
});
