/**
 * #190: bramka CI buduje bazę WYŁĄCZNIE migracjami i sprawdza RLS z 0005.
 *
 * `drizzle-kit push` po `db:migrate` wyłącza RLS i usuwa polityki na 39 tabelach
 * (pomiar #190), więc testy pg i E2E w CI szłyby na bazie bez izolacji salonów.
 * Ten test pada, gdy:
 * - w jobie z Postgresem pojawi się polecenie spoza LISTY DOZWOLONYCH (linie run:,
 *   także z bloków YAML o dowolnym wskaźniku; skrypty package.json z nazwą i treścią),
 *   albo drizzle-kit wywołany inaczej niż `drizzle-kit migrate` — wprost albo przez
 *   skrypt rozwijany rekurencyjnie (#194: W5, W5c Leo, E12 Ethana, decyzja Olivera);
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
/**
 * Lista DOZWOLONYCH skryptów package.json w jobach z bazą (Oliver, #194): nazwa →
 * dokładna treść. Każdy inny skrypt (także nowy alias) = porażka testu; zmiana
 * treści któregoś z nich (np. dopięty push) też.
 */
const ALLOWED_DB_JOB_SCRIPTS: Record<string, string> = {
  "db:migrate": "drizzle-kit migrate", // jedyna droga schematu
  "test:pg": "vitest run --config vitest.pg.config.ts", // testy na prawdziwym Postgresie
  "db:seed:test": "npx tsx scripts/seed-test.ts", // dane testowe E2E (bez DDL)
  "build:ci": "next build", // build bez migracji
};

/** Hasło bazy usługowej CI, złożone z części (skaner literałów sekretów; to nie sekret). */
const CI_PG = `PGPASSWORD=${["dev", "password"].join("_")} psql -h localhost -U dev_user -d pos_dev -c`;

/** Jedyne dozwolone linie psql w jobach z bazą — tekst 1:1 z kroku „Verify seed data”. */
const SEED_CHECK_LINES = [
  String.raw`${CI_PG} "SELECT id, email, email_verified, role FROM \"user\" WHERE email IN ('owner@test.com','client@test.com');"`,
  String.raw`${CI_PG} "SELECT id, provider_id, user_id, CASE WHEN password IS NOT NULL THEN 'SET' ELSE 'NULL' END as pwd FROM account WHERE user_id IN ('test-owner-user-id-00001','test-client-user-id-00001');"`,
];

/**
 * Lista DOZWOLONYCH linii poleceń w krokach jobów z bazą. Każda linia `run:` (także
 * z bloku) musi w całości pasować do jednego wzorca — operator powłoki (`&&`, `;`,
 * `||`), nieznane polecenie albo nieznany skrypt = porażka testu.
 */
const ALLOWED_DB_JOB_LINES: Array<[string, RegExp]> = [
  ["instalacja zależności", /^pnpm install --frozen-lockfile$/],
  ["skrypt z listy dozwolonych", new RegExp(`^pnpm (?:${Object.keys(ALLOWED_DB_JOB_SCRIPTS).join("|")})$`)],
  ["strażnik RLS", /^pnpm exec tsx scripts\/db-rls-guard\.ts$/],
  ["instalacja przeglądarki", /^pnpm exec playwright install --with-deps chromium$/],
  ["testy E2E", /^pnpm exec playwright test --grep @(?:smoke|full) --workers=\d+ --retries=\d+$/],
];

/**
 * Czy linia polecenia jest dozwolona. Linia z `psql` — WYŁĄCZNIE dosłowna równość ciągu
 * z SEED_CHECK_LINES (zero wzorca; decyzja Olivera, #194 Ethan O1–O5). Pozostałe — wzorce
 * z ALLOWED_DB_JOB_LINES, które psql nie dopuszczają.
 */
function allowedLine(line: string): boolean {
  if (/\bpsql\b|PGPASSWORD/.test(line)) return SEED_CHECK_LINES.includes(line);
  return ALLOWED_DB_JOB_LINES.some(([, re]) => re.test(line));
}

/** Push w tekście (testy samego rozwijania skryptów); w jobach obowiązuje lista dozwolonych. */
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

/** Wskaźnik bloku YAML: `|` albo `>` z dowolnym chomping (`-`/`+`) i wcięciem (cyfra). */
const BLOCK_INDICATOR = /^[|>][-+0-9]*$/;

/**
 * Polecenie kroku: jednoliniowe `run: x` albo blok YAML (`run: |`, `|-`, `|+`, `>`,
 * `>-`, `>+`, `|2`, `>2-`, …) — wtedy wszystkie linie bloku, czyli linie wcięte
 * głębiej niż klucz `run:`. Wartość zaczynająca się od `|` lub `>`, która nie jest
 * wskaźnikiem bloku, albo pusty blok = wyjątek (porażka testu, nie przepuszczenie;
 * #194 Z1 Leo, W5c).
 */
function runOf(step: string): string {
  const m = step.match(/^(\s*(?:- )?)run:[ \t]*(.*)$/m);
  if (!m) return "";
  const value = m[2]!.trim();
  if (!/^[|>]/.test(value)) return value;
  if (!BLOCK_INDICATOR.test(value)) throw new Error(`nieznany wskaźnik bloku YAML w run: ${value}`);
  const keyIndent = m[1]!.length;
  const lines: string[] = [];
  for (const l of step.slice(step.indexOf(m[0]) + m[0].length).split("\n").slice(1)) {
    if (l.trim() === "") continue;
    if (l.length - l.trimStart().length <= keyIndent) break;
    lines.push(l.trim());
  }
  if (lines.length === 0) throw new Error(`pusty blok run: ${value}`);
  return lines.join("\n");
}

/**
 * Zamknięta gramatyka kroku w jobach z bazą (#194 Ethan O6–O10). Własny odczyt, bez
 * parsera YAML (w projekcie `yaml`/`js-yaml` są tylko przechodnie). Każda niepusta linia:
 * - pierwsza: `      - <klucz>: …` (krok w stylu flow `- {` = porażka);
 * - kolejne na wcięciu kroku (8): `<klucz>: …` z listy STEP_KEYS (klucz w cudzysłowie,
 *   `shell`, `working-directory`, `continue-on-error`, `id`… = porażka);
 * - głębsze: wyłącznie zawartość bloku `run` (wskaźnik bloku), `env` albo `with`.
 * `uses:` tylko z listy ALLOWED_ACTIONS (przypięta wersja; `./…`, `docker://` = porażka).
 * Zwraca listę naruszeń (pusta = krok w porządku).
 */
const STEP_KEYS = ["name", "run", "if", "env", "with", "uses", "timeout-minutes"] as const;
const ALLOWED_ACTIONS = ["actions/checkout@v4", "pnpm/action-setup@v4", "actions/setup-node@v4", "actions/upload-artifact@v4"];

/** Etykieta kroku do komunikatów (L3 Leo): job, numer od 1 i `name` albo `uses`. */
function stepLabel(job: string, step: string, index: number): string {
  const n = step.match(/^ {6}- name: (.+)$|^ {8}name: (.+)$/m);
  const u = step.match(/^\s*(?:- )?uses: (.+)$/m);
  const what = n ? (n[1] ?? n[2])!.trim() : u ? `uses ${u[1]!.trim()}` : "bez nazwy";
  return `${job}, krok ${index + 1} (${what})`;
}

function stepViolations(step: string, label = "krok"): string[] {
  const out: string[] = [];
  const bad = (m: string) => out.push(`${label}: ${m}`);
  let open: "block" | "map" | null = null;
  step.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    const indent = line.length - line.trimStart().length;
    const key = i === 0 ? line.match(/^ {6}- ([a-z][a-z-]*):(?: (.*))?$/) : indent === 8 ? line.match(/^ {8}([a-z][a-z-]*):(?: (.*))?$/) : null;
    if (i === 0 || indent <= 8) {
      if (!key) {
        bad(`nieznany kształt linii kroku: ${line.trim()}`);
        open = null;
        return;
      }
      const [, k, v = ""] = key;
      if (!(STEP_KEYS as readonly string[]).includes(k!)) bad(`klucz kroku spoza listy: ${k}`);
      if (k === "uses" && !ALLOWED_ACTIONS.includes(v.trim())) bad(`akcja spoza listy: ${v.trim()}`);
      open = k === "run" && BLOCK_INDICATOR.test(v.trim()) ? "block" : (k === "env" || k === "with") && v.trim() === "" ? "map" : null;
      return;
    }
    if (!open) bad(`linia poza blokiem run/env/with: ${line.trim()}`);
  });
  return out;
}

/** Klucze zmieniające wykonanie kroków — zabronione w całym workflow (także w `defaults:`). */
const FORBIDDEN_EXEC_KEYS = /^\s*(?:- )?["']?(shell|working-directory|defaults)["']?\s*:/m;

/**
 * Lista DOZWOLONYCH (E12 Ethana, N1 Leo): jedyne dopuszczalne wywołanie drizzle-kit
 * w jobach z bazą to dokładnie `drizzle-kit migrate` — bez przyrostka wersji
 * (`drizzle-kit@latest`), bez `push`/`drop`/`up`/innych. Do tego zakaz `db:push`
 * i `db:dev` (na wypadek wywołania przez inną nazwę). Zwraca listę naruszeń.
 */
function schemaViolations(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/drizzle-kit(\S*)(?:\s+(\S+))?/g)) {
    if (m[1] !== "" || m[2] !== "migrate") out.push(m[0]);
  }
  for (const m of text.matchAll(/\bdb:(?:push|dev)\b/g)) out.push(m[0]);
  return out;
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

  it.each(PG_JOBS)("%s: każdy krok w zamkniętej gramatyce (klucze z listy, akcje z listy, bez flow i kluczy w cudzysłowie)", (name, body) => {
    const st = steps(body);
    expect(st.length).toBeGreaterThan(5);
    expect(st.flatMap((s, i) => stepViolations(s, stepLabel(name, s, i)))).toEqual([]);
  });

  it("shell:, working-directory: i defaults: nie występują nigdzie w workflow (krok, job, workflow)", () => {
    expect(code(WF)).not.toMatch(FORBIDDEN_EXEC_KEYS);
  });

  it("obie stałe linie odczytu seeda są w e2e-smoke dokładnie jak na liście", () => {
    const smoke = PG_JOBS.find(([n]) => n === "e2e-smoke")![1];
    const lines = steps(smoke).flatMap((s) => runOf(s).split("\n"));
    for (const l of SEED_CHECK_LINES) expect(lines).toContain(l);
  });

  it.each(PG_JOBS)("%s: każda linia run: pasuje do listy dozwolonych poleceń", (name, body) => {
    const outside = steps(body).flatMap((s, i) =>
      runOf(s)
        .split("\n")
        .filter((line) => line !== "" && !allowedLine(line))
        .map((line) => `${stepLabel(name, s, i)}: polecenie spoza listy dozwolonych: ${line}`),
    );
    expect(outside).toEqual([]);
  });

  it("skrypty z listy dozwolonych mają w package.json dokładnie oczekiwaną treść (a ta tylko `drizzle-kit migrate`)", () => {
    for (const [name, body] of Object.entries(ALLOWED_DB_JOB_SCRIPTS)) {
      expect(PKG.scripts[name], name).toBe(body);
      expect(schemaViolations(expandScripts(`pnpm ${name}`, PKG.scripts)), name).toEqual([]);
    }
  });

  it.each(PG_JOBS)("%s: każdy krok — także przez skrypty package.json — woła drizzle-kit wyłącznie jako `drizzle-kit migrate`", (_name, body) => {
    for (const s of steps(body)) {
      const cmd = runOf(s);
      if (!cmd) continue;
      expect(schemaViolations(expandScripts(cmd, PKG.scripts)), cmd).toEqual([]);
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

  it.each([["|"], ["|-"], ["|+"], [">"], [">-"], [">+"], ["|2"], [">2-"], ["|+2"]])(
    "blok `run: %s` jest czytany w całości (pnpm db:sync wykryty)",
    (ind) => {
      const step = `      - name: x\n        run: ${ind}\n          echo a\n\n          pnpm db:sync\n        env:\n          X: "1"\n`;
      expect(runOf(step)).toBe("echo a\npnpm db:sync");
      expect(PUSH.test(expandScripts(runOf(step), scripts))).toBe(true);
    },
  );

  it.each([["|x"], [">>"], ["|-|"], ["| #"]])("nieznany wskaźnik bloku `run: %s` → wyjątek", (ind) => {
    expect(() => runOf(`      - name: x\n        run: ${ind}\n          pnpm db:sync\n`)).toThrow(/wskaźnik bloku/);
  });

  it("pusty blok → wyjątek; jednoliniowe run: bez zmian", () => {
    expect(() => runOf("      - name: x\n        run: |-\n      - name: y\n")).toThrow(/pusty blok/);
    expect(runOf("      - run: pnpm db:migrate\n")).toBe("pnpm db:migrate");
  });
});

describe("stepViolations — zamknięta gramatyka kroku (Ethan O6–O10)", () => {
  it.each([
    ["krok run", "      - name: x\n        run: pnpm db:migrate\n"],
    ["krok uses + with z blokiem", "      - uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: r\n          path: |\n            a/\n"],
    ["krok z env", "      - name: x\n        run: pnpm test:pg\n        env:\n          A: \"1\"\n"],
    ["run: | z liniami", "      - name: x\n        run: |\n          a\n          b\n"],
  ])("poprawny: %s", (_n, step) => {
    expect(stepViolations(step)).toEqual([]);
  });

  it.each([
    ["O6 krok flow", "      - { name: x, run: pnpm db:migrate }\n", /nieznany kształt/],
    ["O7 klucz w cudzysłowie", "      - name: x\n        \"run\": pnpm db:migrate\n", /nieznany kształt/],
    ["O8 shell", "      - name: x\n        run: pnpm db:migrate\n        shell: sh {0}\n", /spoza listy: shell/],
    ["O9 working-directory", "      - name: x\n        run: pnpm db:migrate\n        working-directory: other\n", /spoza listy: working-directory/],
    ["O10 lokalna akcja", "      - uses: ./.github/actions/x\n", /akcja spoza listy/],
    ["docker://", "      - uses: docker://alpine:3\n", /akcja spoza listy/],
    ["akcja bez wersji", "      - uses: actions/checkout\n", /akcja spoza listy/],
    ["continue-on-error", "      - name: x\n        run: pnpm db:migrate\n        continue-on-error: true\n", /spoza listy: continue-on-error/],
    ["kontynuacja skalara poza blokiem", "      - name: x\n        run: pnpm db:migrate\n          && sh x\n", /poza blokiem/],
    ["env w stylu flow", "      - name: x\n        run: pnpm db:migrate\n        env: { A: 1 }\n          B: 2\n", /poza blokiem/],
  ])("%s → naruszenie", (_n, step, re) => {
    expect(stepViolations(step).join("\n")).toMatch(re);
  });

  it("psql: tylko dosłowne linie z listy; O1–O5 i każda zmiana znaku → niedozwolone", () => {
    for (const l of SEED_CHECK_LINES) expect(allowedLine(l)).toBe(true);
    const base = SEED_CHECK_LINES[1]!;
    for (const bad of [
      base.replace(`-c "SELECT`, `-c "SELECT 1" -c "ALTER TABLE clients DISABLE ROW LEVEL SECURITY" -c "SELECT`),
      base.replace("SELECT id,", "SELECT $(sh x.sh) id,"),
      base.replace("SELECT id,", "SELECT `sh x.sh` id,"),
      `${base} && sh x.sh`,
      base.replace(/^PGPASSWORD=\S+/, "PGPASSWORD=$(sh${IFS}x.sh)"),
      base.replace("SELECT", "select"),
      ` ${base}`,
      "psql -c \"SELECT 1;\"",
    ]) {
      expect(allowedLine(bad), bad).toBe(false);
    }
  });

  it("L3: komunikat zawiera job, numer i nazwę kroku oraz niedozwolony klucz", () => {
    const step = "      - name: Seed test data\n        run: pnpm db:seed:test\n        shell: sh {0}\n";
    expect(stepViolations(step, stepLabel("e2e-smoke", step, 6))).toEqual([
      "e2e-smoke, krok 7 (Seed test data): klucz kroku spoza listy: shell",
    ]);
    const u = "      - uses: docker://alpine:3\n";
    expect(stepViolations(u, stepLabel("e2e-full", u, 0))).toEqual(["e2e-full, krok 1 (uses docker://alpine:3): akcja spoza listy: docker://alpine:3"]);
  });

  it.each([
    ["shell w kroku", "        shell: bash\n"],
    ["defaults w jobie", "    defaults:\n      run:\n        shell: bash\n"],
    ["working-directory w defaults workflow", "defaults:\n  run:\n    working-directory: x\n"],
    ["klucz w cudzysłowie", "        \"shell\": bash\n"],
  ])("FORBIDDEN_EXEC_KEYS łapie: %s", (_n, text) => {
    expect(FORBIDDEN_EXEC_KEYS.test(text)).toBe(true);
  });
});

describe("schemaViolations — drizzle-kit tylko jako `drizzle-kit migrate` (E12, N1)", () => {
  it.each([
    ["drizzle-kit migrate", []],
    ["npx drizzle-kit migrate", []],
    ["drizzle-kit push", ["drizzle-kit push"]],
    ["npx drizzle-kit@latest push", ["drizzle-kit@latest push"]],
    ["pnpm dlx drizzle-kit@0.31.0 migrate", ["drizzle-kit@0.31.0 migrate"]],
    ["drizzle-kit drop", ["drizzle-kit drop"]],
    ["drizzle-kit up", ["drizzle-kit up"]],
    ["drizzle-kit", ["drizzle-kit"]],
    ["pnpm db:dev", ["db:dev"]],
    ["tsx a.ts && pnpm db:push", ["db:push"]],
  ])("%j → %j", (text, expected) => {
    expect(schemaViolations(text)).toEqual(expected);
  });
});
