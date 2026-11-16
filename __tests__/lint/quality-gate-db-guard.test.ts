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
import { readdirSync, readFileSync } from "node:fs";
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

/**
 * Push w tekście polecenia (po rozwinięciu skryptów), po TOKENACH (#194 runda 4, Oliver):
 * w jednym poleceniu (między operatorami powłoki) token `drizzle-kit` — także ze ścieżką
 * (`node_modules/.bin/drizzle-kit`) albo wersją (`drizzle-kit@latest`) — i dalej token
 * `push` (np. `drizzle-kit --config x push --force`). Do tego nazwy `db:push…` i `db:dev`.
 */
function isPush(text: string): boolean {
  const unq = (t: string) => t.replace(/^["']+|["']+$/g, "");
  const viaKit = text.split(/[\n;&|()`]+/).some((seg) => {
    const t = seg.trim().split(/\s+/).map(unq);
    const i = t.findIndex((x) => /(?:^|\/)drizzle-kit(?:@\S*)?$/.test(x));
    return i >= 0 && t.slice(i + 1).includes("push");
  });
  return viaKit || /\bdb:(?:push|dev)\b/.test(text);
}

const PUSH = { test: isPush };

/** Bez linii komentarza YAML — komentarz o db:push nie jest krokiem. */
const code = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

/** Joby najwyższego poziomu: nazwa → treść (wcięcie 2 spacje pod `jobs:`). Domyślnie quality-gate.yml. */
function jobs(wf: string = WF): Map<string, string> {
  const at = wf.indexOf("\njobs:\n");
  if (at < 0) throw new Error("brak klucza jobs: w workflow");
  const body = wf.slice(at + 7);
  const out = new Map<string, string>();
  const HEAD = /^ {2}["']?([A-Za-z0-9_-]+)["']?:[ \t]*(?:&\S+[ \t]*)?(?:#.*)?$/;
  // Każda linia na wcięciu 2 to nagłówek joba — inny kształt = porażka, nie sklejenie z poprzednim jobem.
  for (const l of body.split("\n")) {
    if (/^ {2}\S/.test(l) && !l.trim().startsWith("#") && !HEAD.test(l)) throw new Error(`nieznany kształt nagłówka joba: ${l.trim()}`);
  }
  const heads = [...body.matchAll(new RegExp(HEAD.source, "gm"))];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.index : body.length;
    out.set(m[1]!, body.slice(m.index, end));
  });
  return out;
}

/** Kroki joba (każdy zaczyna się od `      - ` pod `    steps:`), bez komentarzy. */
function steps(job: string): string[] {
  const at = job.indexOf("\n    steps:\n");
  if (at < 0) return [];
  const s = code(job.slice(at));
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
 * - `pnpm exec <polecenie…>` / `pnpm dlx <pakiet…>` — polecenie zostaje w tekście (sprawdzane wprost);
 * - `pnpm install [--flagi]`, `pnpm audit [--flagi]` (polecenia wbudowane pnpm);
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
    if (first === "exec" || first === "dlx") continue;
    if ((first === "install" || first === "audit") && (second === undefined || second.startsWith("--"))) continue;
    const name = first === "run" ? second : first;
    if (!name || name.startsWith("-") || !Object.prototype.hasOwnProperty.call(scripts, name)) {
      throw new Error(`nieznany kształt wywołania pnpm: pnpm${m[1]}`);
    }
    if (seen.includes(name)) throw new Error(`pętla skryptów: ${[...seen, name].join(" → ")}`);
    parts.push(expandScripts(scripts[name]!, scripts, [...seen, name]));
  }
  return parts.join("\n");
}

/** Jedyne joby, które mogą mieć bazę — objęte listą dozwolonych i strażnikami. */
const DB_JOBS = ["e2e-full", "e2e-smoke"];

const QG = "quality-gate.yml";

/** WSZYSTKIE pliki workflow repo (nowy plik wchodzi do pętli automatycznie): [nazwa, treść]. */
const WF_DIR = join(ROOT, ".github/workflows");
const WORKFLOWS: Array<[string, string]> = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
  .map((f) => [f, readFileSync(join(WF_DIR, f), "utf8")]);

/**
 * Po czym job jest „jobem z bazą” (#194 runda 4, Oliver + Leo): sam klucz `services:`
 * albo `container:` na poziomie joba (bez rozpoznawania obrazów) ALBO `POSTGRES_URL`
 * w env joba lub kroku. Zwraca powody (pusta lista = job bez bazy).
 */
function dbReasons(body: string): string[] {
  const c = code(body);
  const out: string[] = [];
  if (/^ {4}["']?services["']?\s*:/m.test(c)) out.push("services:");
  if (/^ {4}["']?container["']?\s*:/m.test(c)) out.push("container:");
  if (/^\s+["']?POSTGRES_URL["']?\s*:/m.test(c)) out.push("POSTGRES_URL w env");
  return out;
}

/** Job z bazą poza parą {e2e-smoke, e2e-full} z quality-gate.yml (w każdym pliku workflow). */
function dbJobViolations(file: string, wf: string): string[] {
  return [...jobs(wf)].flatMap(([name, body]) => {
    if (file === QG && DB_JOBS.includes(name)) return [];
    const reasons = dbReasons(body);
    return reasons.length ? [`${file}: nowy job z bazą: dodaj go do testu i strażników: ${name} (${reasons.join(", ")})`] : [];
  });
}

/**
 * `uses:` na poziomie joba (reusable workflow). W quality-gate.yml zabronione. W innych
 * plikach tylko lokalny `./.github/workflows/<plik>.yml`, który jest w repo (a więc w pętli);
 * workflow z innego repo albo nieistniejący plik = porażka.
 */
function jobUsesViolations(file: string, wf: string, files: string[]): string[] {
  return [...jobs(wf)].flatMap(([name, body]) => {
    const m = code(body).match(/^ {4}["']?uses["']?\s*:\s*["']?([^"'\s]+)/m);
    if (!m) return [];
    const local = m[1]!.match(/^\.\/\.github\/workflows\/([^/]+\.ya?ml)$/);
    if (file === QG) return [`${file}: uses: na poziomie joba zabronione w quality-gate.yml: ${name} (${m[1]})`];
    return local && files.includes(local[1]!) ? [] : [`${file}: uses: joba spoza plików workflow tego repo: ${name} (${m[1]})`];
  });
}

/**
 * Kotwice i aliasy YAML (`&nazwa`, `*nazwa` jako wartość/element, klucz scalania `<<:`).
 * Dopasowanie składni YAML (po `klucz: ` albo `- ` na początku wartości, element flow),
 * nie każdego `&`/`*` — `&&` w run:, globy (`*.png`, `**`) i `${x[*]}` nie są kotwicami.
 */
const YAML_ANCHOR: Array<[string, RegExp]> = [
  ["kotwica", /^\s*(?:-\s+|["']?[^\s"'#-][^:#]*["']?:\s+)&[A-Za-z0-9_.-]+(?:\s|$)/],
  ["alias", /^\s*(?:-\s+|["']?[^\s"'#-][^:#]*["']?:\s+)\*[A-Za-z0-9_.-]+\s*(?:#.*)?$/],
  ["alias we flow", /[[{,]\s*\*[A-Za-z0-9_.-]+\s*[,\]}]/],
  ["klucz scalania <<", /^\s*(?:-\s+)?["']?<<["']?\s*:/],
];
function anchorViolations(file: string, wf: string): string[] {
  return code(wf)
    .split("\n")
    .flatMap((l) => YAML_ANCHOR.filter(([, re]) => re.test(l)).map(([what]) => `${file}: ${what} YAML: ${l.trim()}`));
}

/**
 * Push po rozwinięciu skryptów package.json w każdym kroku każdego joba danego
 * workflow (nie tylko w jobach z bazą). Zwraca komunikaty z jobem i krokiem.
 */
function pushViolations(wf: string, scripts: Record<string, string>): string[] {
  return [...jobs(wf)].flatMap(([name, body]) =>
    steps(body).flatMap((s, i) => {
      const cmd = runOf(s);
      return cmd && isPush(expandScripts(cmd, scripts)) ? [`${stepLabel(name, s, i)}: push w poleceniu: ${cmd}`] : [];
    }),
  );
}

const PG_JOBS = [...jobs()].filter(([, body]) => dbReasons(body).length > 0);

describe("wszystkie pliki .github/workflows: bez push, bez baz poza parą, bez kotwic (#194 runda 4)", () => {
  const files = WORKFLOWS.map(([f]) => f);

  it("pętla obejmuje każdy plik workflow (dziś co najmniej trzy, w tym quality-gate.yml)", () => {
    expect(files).toContain(QG);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(WORKFLOWS)("%s: żaden krok — także przez skrypty package.json — nie robi drizzle-kit push / db:push / db:dev", (_f, wf) => {
    expect(pushViolations(wf, PKG.scripts)).toEqual([]);
  });

  it.each(WORKFLOWS)("%s: brak jobów z bazą (services:/container:/POSTGRES_URL) poza parą e2e-smoke/e2e-full z quality-gate.yml", (f, wf) => {
    expect(dbJobViolations(f, wf)).toEqual([]);
  });

  it.each(WORKFLOWS)("%s: uses: na poziomie joba tylko do lokalnego pliku workflow (w quality-gate.yml wcale)", (f, wf) => {
    expect(jobUsesViolations(f, wf, files)).toEqual([]);
  });

  it.each(WORKFLOWS)("%s: bez kotwic, aliasów i kluczy scalania YAML", (f, wf) => {
    expect(anchorViolations(f, wf)).toEqual([]);
  });
});

describe("quality-gate.yml: baza CI tylko z migracji + strażnik RLS (#190)", () => {
  it("joby z bazą (services:/container:/POSTGRES_URL) to dokładnie e2e-smoke i e2e-full", () => {
    expect(dbJobViolations(QG, WF)).toEqual([]);
    expect(PG_JOBS.map(([n]) => n).sort()).toEqual(DB_JOBS);
  });

  it("KAŻDY job quality-gate.yml — także przez skrypty package.json — bez drizzle-kit push, db:push i db:dev", () => {
    expect(jobs().size).toBeGreaterThanOrEqual(5);
    expect(pushViolations(WF, PKG.scripts)).toEqual([]);
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
    expect(isPush(expandScripts("pnpm db:dev", PKG.scripts))).toBe(true);
    expect(isPush(expandScripts("pnpm build", PKG.scripts))).toBe(false);
    expect(isPush(expandScripts("pnpm check", PKG.scripts))).toBe(false);
  });

  it.each([
    ["pnpm exec drizzle-kit push", true],
    ["pnpm dlx drizzle-kit@0.31.0 push", true],
    ["npx drizzle-kit@latest push", true],
    ["drizzle-kit push --force", true],
    ["drizzle-kit --config drizzle.config.ts push", true],
    ["node_modules/.bin/drizzle-kit push", true],
    ["\"drizzle-kit\" 'push'", true],
    ["tsx a.ts && drizzle-kit push", true],
    ["pnpm db:push:force", true],
    ["pnpm db:dev", true],
    ["drizzle-kit migrate", false],
    ["drizzle-kit migrate && docker push img", false],
    ["docker push img", false],
    ["git push origin main", false],
  ])("isPush po tokenach: %j → %s", (text, push) => {
    expect(isPush(text)).toBe(push);
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

describe("joby z bazą, uses: joba, kotwice YAML (#194 runda 4)", () => {
  const wf = (name: string, extra: string) =>
    `name: x\non: push\njobs:\n  ${name}:\n    name: x\n    runs-on: ubuntu-24.04\n${extra}    steps:\n      - run: pnpm test:pg\n`;
  it.each([
    ["usługa db: z pgvector", "    services:\n      db:\n        image: pgvector/pgvector:pg18\n", /nowy job z bazą: dodaj go do testu i strażników: e2e-extra \(services:\)/],
    ["usługa o dowolnym obrazie", "    services:\n      cache:\n        image: redis:7\n", /nowy job z bazą.*e2e-extra/],
    ["services w cudzysłowie", "    \"services\":\n      db:\n        image: x\n", /nowy job z bazą/],
    ["container: postgres", "    container: postgres:18\n", /nowy job z bazą.*\(container:\)/],
    ["POSTGRES_URL w env joba", "    env:\n      POSTGRES_URL: postgresql://localhost/x\n", /nowy job z bazą.*POSTGRES_URL w env/],
  ])("%s → porażka", (_n, extra, re) => {
    expect(dbJobViolations(QG, wf("e2e-extra", extra)).join("\n")).toMatch(re);
  });

  it("POSTGRES_URL w env kroku → job z bazą; job bez bazy → bez naruszeń; para zwolniona tylko w quality-gate.yml", () => {
    const stepEnv = "name: x\njobs:\n  e2e-extra:\n    steps:\n      - run: pnpm test:pg\n        env:\n          POSTGRES_URL: x\n";
    expect(dbJobViolations(QG, stepEnv).join("\n")).toMatch(/nowy job z bazą.*POSTGRES_URL/);
    expect(dbJobViolations(QG, wf("e2e-extra", ""))).toEqual([]);
    expect(dbJobViolations(QG, wf("e2e-extra", "    env:\n      INTEGRATION_POSTGRES_URL_X: y\n"))).toEqual([]);
    expect(dbJobViolations(QG, wf("e2e-smoke", "    services:\n      db:\n        image: postgres:18\n"))).toEqual([]);
    expect(dbJobViolations("inny.yml", wf("e2e-smoke", "    services:\n      db:\n        image: postgres:18\n"))).toHaveLength(1);
  });

  it("nagłówek joba z komentarzem/kotwicą rozpoznany; inny kształt na wcięciu 2 → wyjątek", () => {
    expect([...jobs("name: x\njobs:\n  a: # k\n    x: 1\n  b: &b\n    y: 2\n").keys()]).toEqual(["a", "b"]);
    expect(() => jobs("name: x\njobs:\n  a:\n    x: 1\n  { b: 1 }\n")).toThrow(/nagłówka joba/);
  });

  it("uses: joba — w quality-gate.yml zawsze porażka; gdzie indziej tylko lokalny plik workflow z repo", () => {
    const reuse = (u: string) => `name: x\njobs:\n  e2e:\n    needs: a\n    uses: ${u}\n    with:\n      base_url: x\n`;
    expect(jobUsesViolations(QG, reuse("./.github/workflows/e2e-production.yml"), ["e2e-production.yml"]).join()).toMatch(/zabronione w quality-gate/);
    expect(jobUsesViolations("d.yml", reuse("./.github/workflows/e2e-production.yml"), ["e2e-production.yml"])).toEqual([]);
    expect(jobUsesViolations("d.yml", reuse("org/repo/.github/workflows/e2e.yml@v1"), ["e2e-production.yml"]).join()).toMatch(/spoza plików workflow/);
    expect(jobUsesViolations("d.yml", reuse("./.github/workflows/brak.yml"), ["e2e-production.yml"]).join()).toMatch(/spoza plików workflow/);
    // uses: w kroku (wcięcie 6/8) to nie jest uses: joba
    expect(jobUsesViolations(QG, "name: x\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n", [])).toEqual([]);
  });

  it.each([
    ["kotwica joba", "  e2e-full: &full\n"],
    ["kotwica wartości", "    env: &env\n"],
    ["kotwica elementu", "      - &step\n"],
    ["alias jako wartość", "    env: *env\n"],
    ["alias jako element", "      - *step\n"],
    ["alias we flow", "    needs: [a, *b]\n"],
    ["klucz scalania", "    <<: *full\n"],
    ["klucz scalania w elemencie", "      - <<: *step\n"],
  ])("kotwice YAML: %s → porażka", (_n, line) => {
    expect(anchorViolations("x.yml", line)).not.toEqual([]);
  });

  it.each([
    ["&& w run", "        run: pnpm a && pnpm b\n"],
    ["&& na początku linii bloku", "          && pnpm b\n"],
    ["glob w path", "            tests/.auth/*.png\n"],
    ["glob ** w paths", "      - '**/*.ts'\n"],
    ["glob ** bez cudzysłowu", "      - **/x\n"],
    ["tablica bash", "          echo \"${missing[*]}\"\n"],
    ["komentarz", "# &a *b <<: x\n"],
  ])("nie kotwica: %s", (_n, line) => {
    expect(anchorViolations("x.yml", line)).toEqual([]);
  });

  it("pnpm audit [--flagi] to polecenie wbudowane (bez wyjątku); pnpm audit fix nadal nieznany kształt", () => {
    expect(expandScripts("pnpm audit --audit-level=high", PKG.scripts)).toBe("pnpm audit --audit-level=high");
    expect(() => expandScripts("pnpm audit fix", PKG.scripts)).toThrow(/nieznany kształt/);
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
