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
 *
 * Zasada (#194 runda 5, Oliver): CZEGO TEST NIE UMIE SPARSOWAĆ, TO PORAŻKA. Nieznany
 * kształt nagłówka joba, plik z `jobs:` bez rozpoznanych jobów, kroki w innym stylu
 * wcięć niż w repo, nieznany kształt polecenia pnpm czy wskaźnika bloku — wyjątek,
 * nigdy ciche przepuszczenie.
 *
 * #201: dwie warstwy. (1) Drzewo YAML (js-yaml 4.3.2, schemat domyślny): składnia, push
 * w każdej wartości (`shell:`, `defaults:`…), job z bazą po drzewie (także `$GITHUB_ENV`).
 * (2) Niezmiennik krzyżowy tekst ↔ parser liniowy ↔ drzewo YAML z numerem i treścią linii.
 * Kotwice i aliasy YAML nadal = porażka (sprawdzane na tekście).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
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
/**
 * Sekcja `jobs:` w tekście workflow: od linii po `jobs:` do pierwszej niepustej linii
 * (nie komentarza) na wcięciu 0 — klucz najwyższego poziomu PO jobach (np. `env:`) nie
 * jest treścią ostatniego joba (#194 runda 5, Ethan C). [start, end) w znakach.
 */
function jobsSection(wf: string): [number, number] {
  const at = wf.indexOf("\njobs:\n");
  if (at < 0) throw new Error("brak klucza jobs: w workflow");
  const start = at + 7;
  const m = /^[^\s#]/m.exec(wf.slice(start));
  return [start, m ? start + m.index : wf.length];
}

/** Tekst workflow poza sekcją `jobs:` (przed i po). */
function outsideJobs(wf: string): string {
  const [s, e] = jobsSection(wf);
  return wf.slice(0, s) + "\n" + wf.slice(e);
}

function jobs(wf: string = WF): Map<string, string> {
  return new Map(jobSpans(wf).map(([name, a, b]) => [name, wf.slice(a, b)]));
}

/** Joby jako [nazwa, początek, koniec) w znakach całego pliku — do numerów linii w komunikatach (#201). */
function jobSpans(wf: string): Array<[string, number, number]> {
  const [s, e] = jobsSection(wf);
  const body = wf.slice(s, e);
  const out: Array<[string, number, number]> = [];
  const HEAD = /^ {2}["']?([A-Za-z0-9_-]+)["']?:[ \t]*(?:&\S+[ \t]*)?(?:#.*)?$/;
  // Każda linia na wcięciu 2 to nagłówek joba — inny kształt = porażka, nie sklejenie z poprzednim jobem.
  for (const l of body.split("\n")) {
    if (/^ {2}\S/.test(l) && !l.trim().startsWith("#") && !HEAD.test(l)) throw new Error(`nieznany kształt nagłówka joba: ${l.trim()}`);
  }
  const heads = [...body.matchAll(new RegExp(HEAD.source, "gm"))];
  // Zero rozpoznanych jobów (np. plik w całości na wcięciu 4) = porażka, nie „wszystko przechodzi na pusto”.
  if (heads.length === 0) throw new Error("zero jobów pod jobs: — nieobsługiwany styl wcięć, przepisz workflow w stylu repo (job na wcięciu 2)");
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1]!.index : body.length;
    out.push([m[1]!, s + m.index, s + end]);
  });
  return out;
}

/**
 * Kroki joba (każdy zaczyna się od `      - ` pod `    steps:`), bez komentarzy.
 * Fail-closed (#194, G2–G4 Ethana): `steps:` z wartością w tej samej linii (alias, flow),
 * pierwsza niepusta linia pod `steps:` inna niż `      - ` (np. kroki na wcięciu 4)
 * albo zero kroków = wyjątek. Job bez `steps:` dozwolony tylko z `uses:` joba.
 * Dozwolony sam komentarz końcowy (`steps: # …`, #201 F9).
 */
function steps(job: string): string[] {
  const c = code(job);
  const key = c.match(/^ {4}["']?steps["']?[ \t]*:(.*)$/m);
  if (!key) {
    if (/^ {4}["']?uses["']?\s*:/m.test(c)) return [];
    throw new Error(`job bez steps: i bez uses: joba: ${job.split("\n")[0]!.trim()}`);
  }
  const STYLE = "nieobsługiwany styl wcięć — przepisz job w stylu repo";
  const tail = key[1]!;
  if (!key[0].startsWith("    steps:") || !(tail === "" || /^[ \t]+#/.test(tail))) throw new Error(`${STYLE}: ${key[0].trim()}`);
  const rest = c.slice(key.index! + key[0].length);
  const after = rest.slice(1);
  const first = after.split("\n").find((l) => l.trim() !== "");
  if (first === undefined || !/^ {6}- /.test(first)) throw new Error(`${STYLE}: pierwsza linia pod steps: ${first?.trim() ?? "(brak)"}`);
  const out = rest.split(/\n(?= {6}- )/).slice(1);
  if (out.length === 0) throw new Error(`${STYLE}: job ze steps: i zerem rozpoznanych kroków`);
  return out;
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
 * Zamknięta gramatyka kroku w jobach z bazą (#194 Ethan O6–O10). Własny odczyt linii —
 * pierwsza warstwa; drzewo YAML (js-yaml, #201) sprawdza osobno yamlViolations. Każda niepusta linia:
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
  // POSTGRES_URL poza sekcją jobs: (env workflow, przed albo po jobach) trafia do KAŻDEGO joba —
  // zakazane w każdym pliku (G1/G5, C Ethana).
  const top = /^\s*["']?POSTGRES_URL["']?\s*:/m.test(code(outsideJobs(wf))) ? [`${file}: POSTGRES_URL poza jobs: (env workflow) — zakazane`] : [];
  return top.concat([...jobs(wf)].flatMap(([name, body]) => {
    if (file === QG && DB_JOBS.includes(name)) return [];
    const reasons = dbReasons(body);
    return reasons.length ? [`${file}: nowy job z bazą: dodaj go do testu i strażników: ${name} (${reasons.join(", ")})`] : [];
  }));
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

// --- Warstwa YAML (#201, decyzja Olivera: js-yaml 4.3.2, `load` ze schematem domyślnym) -----------

type Y = unknown;
const isMap = (v: Y): v is Record<string, Y> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Drzewo YAML pliku. Błąd składni albo brak mapy `jobs` = wyjątek. */
function yamlTree(wf: string): Record<string, Y> {
  const t = load(wf);
  if (!isMap(t) || !isMap(t.jobs)) throw new Error("brak mapy jobs w drzewie YAML");
  return t;
}

/** Wszystkie węzły drzewa ze ścieżką; klucz mapy też jest wpisem (ścieżka `….{klucz}`). */
function walk(v: Y, path: string, out: Array<[string, Y]> = []): Array<[string, Y]> {
  out.push([path, v]);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
  else if (isMap(v))
    for (const [k, x] of Object.entries(v)) {
      out.push([`${path}.{klucz}`, k]);
      walk(x, `${path}.${k}`, out);
    }
  return out;
}

/** Liczba kluczy `key` w całym drzewie YAML (na każdym poziomie). */
function yamlKeyCount(tree: Y, key: string): number {
  return walk(tree, "").filter(([p, v]) => p.endsWith(".{klucz}") && v === key).length;
}

const mentionsPgUrl = (v: Y) => walk(v, "").some(([, x]) => typeof x === "string" && /\bPOSTGRES_URL\b/.test(x));

/**
 * Sprawdzenia na drzewie YAML (#201) — niezależne od kształtu tekstu (jawny klucz `?`, escape,
 * tag, blok złożony, `shell:`, `defaults:`):
 * - plik musi się parsować (inaczej GitHub też go odrzuci);
 * - push (`isPush`) w KAŻDEJ wartości i kluczu drzewa (I10: `shell:`, `defaults.run.shell`, `with:`…);
 * - `run` każdego kroku po rozwinięciu skryptów package.json;
 * - job z bazą: `services`, `container` albo `POSTGRES_URL` gdziekolwiek w jobie (env, `$GITHUB_ENV`
 *   w poleceniu…) — tylko para e2e-smoke/e2e-full w quality-gate.yml;
 * - `POSTGRES_URL` poza `jobs:` — zakazane.
 */
function yamlViolations(file: string, wf: string): string[] {
  let tree: Record<string, Y>;
  try {
    tree = yamlTree(wf);
  } catch (e) {
    return [`${file}: plik nie parsuje się jako YAML (GitHub też go odrzuci): ${(e as Error).message.split("\n")[0]}`];
  }
  const out: string[] = [];
  for (const [p, v] of walk(tree, "")) {
    if (typeof v === "string" && isPush(v)) out.push(`${file}: YAML: push w ${p || "(korzeń)"}: ${v}`);
  }
  for (const [name, job] of Object.entries(tree.jobs as Record<string, Y>)) {
    const st = isMap(job) && Array.isArray(job.steps) ? (job.steps as Y[]) : [];
    st.forEach((s, i) => {
      if (isMap(s) && typeof s.run === "string" && isPush(expandScripts(s.run, PKG.scripts))) {
        out.push(`${file}: YAML: ${name}, krok ${i + 1}: push po rozwinięciu skryptów: ${s.run}`);
      }
    });
    if (file === QG && DB_JOBS.includes(name)) continue;
    const reasons = isMap(job)
      ? [...("services" in job ? ["services"] : []), ...("container" in job ? ["container"] : []), ...(mentionsPgUrl(job) ? ["POSTGRES_URL"] : [])]
      : [];
    if (reasons.length) out.push(`${file}: YAML: nowy job z bazą: dodaj go do testu i strażników: ${name} (${reasons.join(", ")})`);
  }
  const outside = Object.fromEntries(Object.entries(tree).filter(([k]) => k !== "jobs"));
  if (mentionsPgUrl(outside)) out.push(`${file}: YAML: POSTGRES_URL poza jobs: — zakazane`);
  return out;
}

// --- Niezmiennik krzyżowy: tekst ↔ parser liniowy ↔ drzewo YAML ---------------------------------

/** Komentarz końcowy YAML (`#` po białym znaku, poza cudzysłowem) odcięty. */
function stripTrailingComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i).trimEnd();
  }
  return s;
}

/** Bilans nawiasów flow (`{[` minus `}]`) poza cudzysłowem. */
function bracketDelta(s: string): number {
  let q: string | null = null;
  let d = 0;
  for (const ch of s) {
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "{" || ch === "[") d++;
    else if (ch === "}" || ch === "]") d--;
  }
  return d;
}

/** `klucz: wartość` na początku tekstu (klucz zwykły albo w cudzysłowie); grupa 1 = wartość. */
const KEY_VALUE = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#{[,?:|>][^#]*?)[ \t]*:(?:[ \t]+(.*))?$/;

/**
 * Odczyt linii pliku pod niezmiennik: dla każdej linii, czy jest treścią bloku skalarnego
 * (`run: |`, `path: |`… — tekst, nie klucze), linią komentarza, oraz tekst do szukania kluczy:
 * `rest` (po wcięciu i `- `, bez komentarza końcowego) i `flow` (fragment w stylu flow — tylko
 * w pozycji wartości albo kontynuacja otwartego flow z poprzednich linii).
 */
type LineScan = { skip: boolean; rest: string; flow: string };
function scanLines(wf: string): LineScan[] {
  let block = -1;
  let depth = 0;
  return wf.split("\n").map((line) => {
    const indent = line.length - line.trimStart().length;
    if (line.trim() === "") return { skip: true, rest: "", flow: "" };
    if (block >= 0) {
      if (indent > block) return { skip: true, rest: "", flow: "" };
      block = -1;
    }
    if (line.trim().startsWith("#")) return { skip: true, rest: "", flow: "" };
    const lead = line.match(/^[ \t]*(?:-[ \t]+)*/)![0];
    const rest = stripTrailingComment(line.slice(lead.length));
    let flow = "";
    if (depth > 0 || /^[{[,]/.test(rest)) flow = rest;
    else if (BLOCK_INDICATOR.test(rest)) block = lead.length;
    else {
      const value = rest.match(KEY_VALUE)?.[1] ?? "";
      if (/^[{[]/.test(value)) flow = value;
      else if (BLOCK_INDICATOR.test(value)) block = lead.length;
    }
    depth = Math.max(0, depth + bracketDelta(flow));
    return { skip: false, rest, flow };
  });
}

const INVARIANT_KEYS = ["run", "uses", "services", "container", "POSTGRES_URL"] as const;
type InvariantKey = (typeof INVARIANT_KEYS)[number];

/**
 * Linie (od 0), w których klucz `key` WIDAĆ w tekście: na początku linii (`key:`, `- key:`,
 * `"key":`, `'key':`) albo w flow (`{ key:`, `, key:`, `[ key:`) — jedna pozycja na wystąpienie.
 * Komentarze, komentarze końcowe i treść bloków skalarnych to tekst, nie klucze (#201 F4–F6, F10).
 */
function rawKeyLines(scan: LineScan[], key: InvariantKey): number[] {
  const K = `["']?${key}["']?[ \\t]*:`;
  const atStart = new RegExp(`^${K}`);
  const inFlow = new RegExp(`[{,[][ \\t]*${K}`, "g");
  return scan.flatMap((l, i) => {
    if (l.skip) return [];
    const n = (atStart.test(l.rest) ? 1 : 0) + (l.flow.match(inFlow) ?? []).length;
    return new Array<number>(n).fill(i);
  });
}

/**
 * Linie (od 0), w których klucz rozpoznał parser liniowy — miejsca faktycznie sprawdzane:
 * - `run`: pierwszy `run:` kroku (runOf) oraz `defaults: run:` workflow/joba POZA quality-gate.yml
 *   (#201 F7; push w `shell:` sprawdza warstwa YAML; w quality-gate.yml `defaults:` zakazane);
 * - `uses`: `uses:` joba (wcięcie 4) i pierwszy `uses:` kroku (`      - uses:` / `        uses:`);
 * - `services` / `container`: klucz joba na wcięciu 4; `POSTGRES_URL`: klucz wewnątrz joba.
 */
function parsedKeyLines(file: string, wf: string, scan: LineScan[]): Record<InvariantKey, number[]> {
  const out: Record<InvariantKey, number[]> = { run: [], uses: [], services: [], container: [], POSTGRES_URL: [] };
  const all = wf.split("\n");
  const live = (i: number) => !scan[i]!.skip;
  for (const [, a, b] of jobSpans(wf)) {
    const body = wf.slice(a, b);
    const first = wf.slice(0, a).split("\n").length - 1;
    const raw = body.split("\n");
    raw.forEach((l, j) => {
      if (!live(first + j)) return;
      if (/^ {4}uses:/.test(l)) out.uses.push(first + j);
      if (/^ {4}services:/.test(l)) out.services.push(first + j);
      if (/^ {4}container:/.test(l)) out.container.push(first + j);
      if (/^\s+POSTGRES_URL:/.test(l)) out.POSTGRES_URL.push(first + j);
    });
    // Linie kroków (z code(), bez komentarzy) przypisane do linii pliku po kolei.
    let p = 0;
    for (const s of steps(body)) {
      const ls = s.split("\n");
      const at = ls.map((l) => {
        while (p < raw.length && raw[p] !== l) p++;
        return first + p++;
      });
      const r = ls.findIndex((l, k) => live(at[k]!) && /^\s*(?:- )?run:/.test(l));
      if (r >= 0) out.run.push(at[r]!);
      const u = ls.findIndex((l, k) => live(at[k]!) && /^(?: {6}- | {8})uses:/.test(l));
      if (u >= 0) out.uses.push(at[u]!);
    }
  }
  if (file !== QG) {
    all.forEach((l, i) => {
      const d = l.match(/^( {4})?defaults:[ \t]*$/);
      if (!d || !live(i)) return;
      const j = all.findIndex((_x, k) => k > i && live(k));
      if (j >= 0 && new RegExp(`^${d[1] ?? ""} {2}run:[ \\t]*$`).test(all[j]!)) out.run.push(j);
    });
  }
  return out;
}

/** Elementy `a` bez elementów `b` (multizbiór). */
function minus(a: number[], b: number[]): number[] {
  const rest = [...b];
  return a.filter((x) => {
    const k = rest.indexOf(x);
    if (k < 0) return true;
    rest.splice(k, 1);
    return false;
  });
}

/**
 * NIEZMIENNIKI KRZYŻOWE na plik (#194 runda 5; #201 — trzy strony). Dla każdego klucza
 * run/uses/services/container/POSTGRES_URL muszą się zgadzać:
 * 1. linie, w których klucz widać w tekście (rawKeyLines),
 * 2. linie rozpoznane przez parser liniowy (parsedKeyLines) — co do linii,
 * 3. liczba kluczy w drzewie YAML (js-yaml) — wychwytuje klucze niewidoczne w tekście
 *    (jawny klucz `?`, escape `"run"`, tag `!!str run`).
 * Rozjazd = „nieobsługiwany kształt”, z numerem i treścią każdej nierozpoznanej linii.
 * Błąd składni YAML zgłasza yamlViolations (tu pomijamy stronę 3).
 */
function keyInvariantViolations(file: string, wf: string): string[] {
  const lines = wf.split("\n");
  const scan = scanLines(wf);
  const parsed = parsedKeyLines(file, wf, scan);
  let tree: Y;
  try {
    tree = load(wf);
  } catch {
    tree = undefined;
  }
  const show = (xs: number[]) => xs.map((i) => `linia ${i + 1}: ${lines[i]!.trim()}`).join("; ");
  return INVARIANT_KEYS.flatMap((key) => {
    const raw = rawKeyLines(scan, key);
    const p = parsed[key];
    const y = tree === undefined ? undefined : yamlKeyCount(tree, key);
    const unrec = minus(raw, p);
    const unseen = minus(p, raw);
    if (unrec.length === 0 && unseen.length === 0 && (y === undefined || y === raw.length)) return [];
    let msg = `${file}: nieobsługiwany kształt — kluczy ${key} w pliku ${raw.length}, rozpoznanych przez parser ${p.length}`;
    if (y !== undefined) msg += `, w drzewie YAML ${y}`;
    if (unrec.length) msg += `; nierozpoznane: ${show(unrec)}`;
    if (unseen.length) msg += `; rozpoznane przez parser, a niewidoczne jako klucz: ${show(unseen)}`;
    if (y !== undefined && y > raw.length) msg += "; klucz w drzewie YAML bez śladu w tekście (jawny klucz `?`, escape, tag) — przepisz w stylu repo";
    return [msg];
  });
}

function pushViolations(wf: string, scripts: Record<string, string>): string[] {
  return [...jobs(wf)].flatMap(([name, body]) =>
    steps(body).flatMap((s, i) => {
      const cmd = runOf(s);
      return cmd && isPush(expandScripts(cmd, scripts)) ? [`${stepLabel(name, s, i)}: push w poleceniu: ${cmd}`] : [];
    }),
  );
}

/**
 * Wszystkie sprawdzenia jednego pliku workflow naraz (#201): wynik to lista naruszeń, a wyjątek
 * parsera to też naruszenie (fail-closed). Używane przez sondy obejść i poprawnych edycji.
 */
function fileViolations(file: string, wf: string, files: string[]): string[] {
  const checks: Array<() => string[]> = [
    () => pushViolations(wf, PKG.scripts),
    () => dbJobViolations(file, wf),
    () => jobUsesViolations(file, wf, files),
    () => keyInvariantViolations(file, wf),
    () => anchorViolations(file, wf),
    () => yamlViolations(file, wf),
  ];
  return checks.flatMap((c) => {
    try {
      return c();
    } catch (e) {
      return [`${file}: wyjątek parsera: ${(e as Error).message}`];
    }
  });
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

  it.each(WORKFLOWS)("%s: niezmiennik krzyżowy — każdy klucz run/uses/services/container/POSTGRES_URL rozpoznany przez parser", (f, wf) => {
    expect(keyInvariantViolations(f, wf)).toEqual([]);
  });

  it.each(WORKFLOWS)("%s: bez kotwic, aliasów i kluczy scalania YAML", (f, wf) => {
    expect(anchorViolations(f, wf)).toEqual([]);
  });

  it.each(WORKFLOWS)("%s: warstwa YAML (#201) — parsuje się; bez push w żadnej wartości; bez baz poza parą", (f, wf) => {
    expect(yamlViolations(f, wf)).toEqual([]);
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

  it("runda 5 (1): plik z jobs: i zerem jobów na wcięciu 2 (np. całość na wcięciu 4) → wyjątek", () => {
    const g4 = "name: x\non:\n    push:\njobs:\n    db:\n        runs-on: ubuntu-latest\n        steps:\n            - run: pnpm db:push\n";
    expect(() => jobs(g4)).toThrow(/zero jobów pod jobs:/);
    expect(() => pushViolations(g4, PKG.scripts)).toThrow(/zero jobów/);
  });

  it.each([
    ["kroki z myślnikiem na wcięciu 4", "  db:\n    runs-on: x\n    steps:\n    - uses: actions/checkout@v4\n    - run: pnpm db:push\n"],
    ["kroki na wcięciu 8", "  db:\n    runs-on: x\n    steps:\n        - run: pnpm db:push\n"],
    ["steps: jako alias", "  db:\n    runs-on: x\n    steps: *s\n"],
    ["steps: we flow", "  db:\n    runs-on: x\n    steps: [{ run: pnpm db:push }]\n"],
    ["steps: puste", "  db:\n    runs-on: x\n    steps:\n"],
  ])("runda 5 (2): %s → wyjątek „nieobsługiwany styl wcięć”", (_n, job) => {
    expect(() => pushViolations(`name: x\njobs:\n${job}`, PKG.scripts)).toThrow(/nieobsługiwany styl wcięć — przepisz job w stylu repo/);
  });

  it.each([
    ["steps: ze spacją na końcu", "    steps: \n      - run: pnpm db:push\n"],
    ["steps: we flow", "    steps: [ {run: pnpm db:push} ]\n"],
    ["\"steps\": w cudzysłowie", "    \"steps\":\n      - run: pnpm db:push\n"],
  ])("runda 5 (A): %s → wyjątek", (_n, st) => {
    expect(() => pushViolations(`name: x\njobs:\n  db:\n    runs-on: x\n${st}`, PKG.scripts)).toThrow(/nieobsługiwany styl wcięć/);
  });

  it.each([
    ["\"run\" w cudzysłowie jako pierwszy klucz", "      - \"run\": pnpm db:sync\n"],
    ["krok flow", "      - { run: pnpm db:sync }\n"],
    ["'run' w cudzysłowie jako drugi klucz", "      - name: x\n        'run': pnpm db:sync\n"],
    ["drugi run: w kroku", "      - run: pnpm typecheck\n        run: pnpm db:sync\n"],
  ])("runda 5 (B): %s → niezmiennik krzyżowy run: „nieobsługiwany kształt”", (_n, step) => {
    const wf = `name: x\njobs:\n  typecheck:\n    runs-on: x\n    steps:\n      - run: pnpm typecheck\n${step}`;
    expect(keyInvariantViolations("x.yml", wf).join()).toMatch(/nieobsługiwany kształt — kluczy run/);
  });

  it.each([
    ["uses w cudzysłowie w kroku", "uses", "      - \"uses\": org/x@v1\n"],
    ["uses we flow", "uses", "      - { uses: org/x@v1 }\n"],
    ["services pod krokiem (wcięcie 8)", "services", "      - run: pnpm test:pg\n        services:\n          db:\n            image: x\n"],
    ["container w cudzysłowie", "container", "    \"container\": postgres:18\n"],
    ["POSTGRES_URL w cudzysłowie", "POSTGRES_URL", "      - run: pnpm test:pg\n        env:\n          \"POSTGRES_URL\": x\n"],
  ])("runda 5 niezmiennik: %s → rozjazd kluczy %s", (_n, key, extra) => {
    const wf = `name: x\njobs:\n  a:\n    runs-on: x\n${extra.startsWith("    \"") ? extra : ""}    steps:\n      - run: pnpm typecheck\n${extra.startsWith("    \"") ? "" : extra}`;
    expect(keyInvariantViolations("x.yml", wf).join()).toMatch(new RegExp(`kluczy ${key} w pliku`));
  });

  it("runda 5 niezmiennik: poprawny plik → bez rozjazdu; POSTGRES_URL poza jobami → rozjazd", () => {
    const ok = "name: x\njobs:\n  a:\n    runs-on: x\n    services:\n      pg:\n        image: x\n    env:\n      POSTGRES_URL: x\n    steps:\n      - uses: actions/checkout@v4\n      - name: y\n        uses: actions/setup-node@v4\n      - run: pnpm test:pg\n  b:\n    uses: ./.github/workflows/b.yml\n";
    expect(keyInvariantViolations("x.yml", ok)).toEqual([]);
    expect(keyInvariantViolations("x.yml", ok + "env:\n  POSTGRES_URL: x\n").join()).toMatch(/kluczy POSTGRES_URL/);
  });

  it("runda 5 (C): env z POSTGRES_URL PO jobach nie jest treścią ostatniego joba; porażka także, gdy ostatni job z pary", () => {
    const wf = "name: x\njobs:\n  e2e-full:\n    services:\n      postgres:\n        image: x\n    steps:\n      - run: pnpm test:pg\nenv:\n  POSTGRES_URL: postgresql://u:p@db.example:5432/x\n";
    expect(jobs(wf).get("e2e-full")).not.toMatch(/POSTGRES_URL/);
    expect(dbJobViolations(QG, wf).join()).toMatch(/POSTGRES_URL poza jobs:/);
    // komentarz na wcięciu 0 wewnątrz jobs: nie kończy sekcji
    expect([...jobs("name: x\njobs:\n  a:\n    x: 1\n# k\n  b:\n    y: 2\n").keys()]).toEqual(["a", "b"]);
  });

  it("runda 5 (2): job bez steps: tylko z uses: joba; inaczej wyjątek", () => {
    expect(pushViolations("name: x\njobs:\n  e2e:\n    uses: ./.github/workflows/e2e-production.yml\n", PKG.scripts)).toEqual([]);
    expect(() => pushViolations("name: x\njobs:\n  e2e:\n    runs-on: x\n", PKG.scripts)).toThrow(/bez steps: i bez uses:/);
  });

  it("runda 5 (3): POSTGRES_URL przed jobs: (env workflow) → porażka w każdym pliku, także quality-gate.yml", () => {
    const wfEnv = "name: x\nenv:\n  POSTGRES_URL: postgresql://u:p@db.example:5432/x\njobs:\n  a:\n    steps:\n      - run: pnpm test:pg\n";
    expect(dbJobViolations("inny.yml", wfEnv).join()).toMatch(/POSTGRES_URL poza jobs:/);
    expect(dbJobViolations(QG, wfEnv).join()).toMatch(/POSTGRES_URL poza jobs:/);
    expect(dbJobViolations(QG, wfEnv.replace("POSTGRES_URL", "OTHER_URL"))).toEqual([]);
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

/**
 * #201: sondy na PRAWDZIWYCH plikach workflow (edycja w pamięci, pliki na dysku bez zmian).
 * Grupa A — obejścia, które po #194 przechodziły: test ma padać.
 * Grupa B — poprawne edycje (sondy Leo z recenzji #194), które dawały fałszywy alarm: test ma przechodzić.
 */
describe("#201: obejścia (A) padają, poprawne edycje (B) przechodzą", () => {
  const FILES = WORKFLOWS.map(([f]) => f);
  const EP = "e2e-production.yml";
  const EP_INSTALL = "      - run: pnpm install --frozen-lockfile\n";
  const QG_TC = "      - run: pnpm typecheck\n";
  const edited = (file: string, find: string, repl: string): string => {
    const wf = WORKFLOWS.find(([f]) => f === file)![1];
    expect(wf.split(find).length - 1, `kotwica sondy w ${file}: ${find}`).toBe(1);
    return wf.replace(find, repl);
  };
  const I7 = `${EP_INSTALL}      - name: x\n        ? run\n        : pnpm db:push\n`;
  const I8 = `${EP_INSTALL}      - name: x\n        "r\\u0075n": pnpm db:push\n`;

  it.each([
    ["I7: jawny klucz `? run` z push", EP, EP_INSTALL, I7, /push/],
    ["I7: jawny klucz `? run` — rozjazd niezmiennika", EP, EP_INSTALL, I7, /kluczy run w pliku/],
    ["I8: klucz z escape `\"r\\u0075n\":` z push", EP, EP_INSTALL, I8, /push/],
    ["I8: klucz z escape — rozjazd niezmiennika", EP, EP_INSTALL, I8, /kluczy run w pliku/],
    ["I10: shell: kroku z drizzle-kit push", EP, EP_INSTALL, `${EP_INSTALL}      - run: pnpm exec playwright --version\n        shell: sh -c 'drizzle-kit push; sh {0}'\n`, /push/],
    ["I10: defaults.run.shell workflow z db:push", EP, "\njobs:\n", "\ndefaults:\n  run:\n    shell: sh -c 'pnpm db:push && bash {0}'\n\njobs:\n", /push/],
    ["I10: shell: jako blok złożony (drizzle-kit i push w osobnych liniach)", EP, EP_INSTALL, `${EP_INSTALL}      - run: pnpm exec playwright --version\n        shell: >-\n          sh -c 'drizzle-kit\n          push; sh {0}'\n`, /push/],
    ["POSTGRES_URL przez $GITHUB_ENV w kroku", EP, EP_INSTALL, `${EP_INSTALL}      - run: echo "POSTGRES_URL=$DB_URL" >> "$GITHUB_ENV"\n`, /nowy job z bazą.*e2e-production/],
    // Escape w cudzysłowie: w tekście nie ma „POSTGRES_URL”, w drzewie YAML jest — łapie tylko warstwa YAML.
    ["POSTGRES_URL poza jobs: (env workflow, escape w wartości)", EP, "\njobs:\n", '\nenv:\n  DB: "${{ secrets.POSTGRES\\u005fURL }}"\n\njobs:\n', /YAML: POSTGRES_URL poza jobs/],
  ])("A %s → porażka", (_n, file, find, repl, re) => {
    expect(fileViolations(file, edited(file, find, repl), FILES).join("\n")).toMatch(re);
  });

  it.each([
    ["F1 krok cache (uses + with)", QG, QG_TC, `${QG_TC}\n      - name: Cache\n        uses: actions/cache@v4\n        with:\n          path: .next/cache\n          key: next-\${{ runner.os }}\n`],
    ["F2 słowa run/uses/services w nazwie kroku", QG, QG_TC, "      - name: run typecheck (uses services)\n        run: pnpm typecheck\n"],
    ["F3 komentarz końcowy z run:", QG, QG_TC, "      - run: pnpm typecheck # potem run: lint\n"],
    ["F4 komentarz końcowy z „, run:”", QG, QG_TC, "      - run: pnpm typecheck # tsc, run: bez emit\n"],
    ["F4b komentarz końcowy z „, run:” po wartości flow", QG, QG_TC, `${QG_TC}      - uses: actions/upload-artifact@v4\n        with: { name: x, path: y } # x, run: z\n`],
    ["F6 blok run: | z linią echo 'services: x'", QG, QG_TC, "      - name: t\n        run: |\n          echo 'services: none'\n          pnpm typecheck\n"],
    ["F6b blok run: | z linią zawierającą „, run:” i „{run:”", QG, QG_TC, "      - name: t\n        run: |\n          echo 'a, run: b {run: c}'\n          pnpm typecheck\n"],
    ["F6c blok run: | z linią zaczynającą się od „services:” (heredoc)", QG, QG_TC, "      - name: t\n        run: |\n          cat > /dev/null <<'EOF'\n          services: none\n          run: none\n          EOF\n          pnpm typecheck\n"],
    ["F7 defaults: run: w e2e-production.yml", EP, "\njobs:\n", "\ndefaults:\n  run:\n    shell: bash\n\njobs:\n"],
    ["F8 env workflow bez POSTGRES_URL", QG, "\njobs:\n", "\nenv:\n  NODE_VERSION: '22'\n\njobs:\n"],
    ["F9 steps: z komentarzem końcowym", QG, "    name: TypeScript Check\n    runs-on: ubuntu-latest\n    steps:\n", "    name: TypeScript Check\n    runs-on: ubuntu-latest\n    steps: # tsc\n"],
  ])("B %s → bez naruszeń", (_n, file, find, repl) => {
    expect(fileViolations(file, edited(file, find, repl), FILES)).toEqual([]);
  });

  it.each([
    ["F5 nazwa kroku z „, uses:” (w cudzysłowie — jedyny poprawny YAML)", QG, QG_TC, "      - name: \"Typecheck, uses: tsc\"\n        run: pnpm typecheck\n"],
    ["F10 wartość with: z „{run:” (w cudzysłowie — jedyny poprawny YAML)", QG, QG_TC, `${QG_TC}      - uses: actions/upload-artifact@v4\n        with:\n          name: x\n          path: "a/{run: 1}"\n`],
  ])("B %s → bez naruszeń", (_n, file, find, repl) => {
    expect(fileViolations(file, edited(file, find, repl), FILES)).toEqual([]);
  });

  // F5 i F10 dosłownie z sondy Leo to niepoprawny YAML (plain scalar z „: ” w kontekście blokowym) —
  // GitHub odrzuca taki plik. Test pada czytelnym komunikatem składni, nie rozjazdem niezmiennika
  // (decyzja Olivera, #201).
  it.each([
    ["F5 dosłownie", QG_TC, "      - name: Typecheck, uses: tsc\n        run: pnpm typecheck\n"],
    ["F10 dosłownie", QG_TC, `${QG_TC}      - uses: actions/upload-artifact@v4\n        with:\n          name: x\n          path: a/{run: 1}\n`],
  ])("B %s (niepoprawny YAML) → jedno naruszenie: plik nie parsuje się jako YAML", (_n, find, repl) => {
    const v = fileViolations(QG, edited(QG, find, repl), FILES);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/nie parsuje się jako YAML/);
  });

  it("komunikat niezmiennika wskazuje numer i treść nierozpoznanej linii", () => {
    const wf = edited(EP, EP_INSTALL, `${EP_INSTALL}      - { run: pnpm exec playwright --version }\n`);
    const line = wf.split("\n").findIndex((l) => l === "      - { run: pnpm exec playwright --version }") + 1;
    expect(keyInvariantViolations(EP, wf).join("\n")).toContain(`nierozpoznane: linia ${line}: - { run: pnpm exec playwright --version }`);
  });

  it("niezmiennik nadal widzi klucz w wielowierszowym flow (kontynuacja „x: 1, run: …”)", () => {
    const wf = "name: x\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: pnpm typecheck\n      - uses: actions/upload-artifact@v4\n        with: {\n          x: 1, run: pnpm db:sync }\n";
    expect(keyInvariantViolations("x.yml", wf).join()).toMatch(/kluczy run w pliku/);
  });

  // Tekst „run:” w wielowierszowym cudzysłowie (parser liniowy i tekst go liczą, drzewo YAML nie)
  // równoważy liczbowo prawdziwy klucz w kontynuacji flow. Bez śledzenia kontynuacji flow
  // wszystkie trzy strony dają tę samą liczbę i te same linie — rozjazd znika.
  it("niezmiennik widzi klucz w kontynuacji flow także, gdy liczby kluczy się bilansują", () => {
    const wf = edited(EP, EP_INSTALL, `${EP_INSTALL}      - name: "a\n          run: b"\n        uses: actions/upload-artifact@v4\n        with: { name: x,\n          path: y, run: z }\n`);
    const line = wf.split("\n").indexOf("          path: y, run: z }") + 1;
    const msg = keyInvariantViolations(EP, wf).join("\n");
    expect(msg).toMatch(/kluczy run w pliku .*, w drzewie YAML/);
    expect(msg).toContain(`nierozpoznane: linia ${line}: path: y, run: z }`);
  });

  // Równa liczba kluczy po każdej stronie, ale różne linie: parser liniowy liczy „run:” po
  // niełamliwej spacji w cudzysłowie (\s), tekst go nie widzi; tekst i drzewo widzą run w flow,
  // parser nie. Porównanie samych liczb by to przepuściło — niezmiennik porównuje linie.
  it("niezmiennik porównuje linie, nie same liczby (równe liczby, różne linie)", () => {
    const wf = edited(EP, EP_INSTALL, `${EP_INSTALL}      - name: "a\n           run: b"\n        uses: actions/upload-artifact@v4\n        with: { name: x, run: y }\n`);
    const ls = wf.split("\n");
    const flow = ls.indexOf("        with: { name: x, run: y }") + 1;
    const nbsp = ls.indexOf("           run: b\"") + 1;
    const msg = keyInvariantViolations(EP, wf).join("\n");
    expect(msg).toMatch(/kluczy run w pliku (\d+), rozpoznanych przez parser \1, w drzewie YAML \1;/);
    expect(msg).toContain(`nierozpoznane: linia ${flow}: with: { name: x, run: y }`);
    expect(msg).toContain(`rozpoznane przez parser, a niewidoczne jako klucz: linia ${nbsp}: run: b"`);
  });
});
