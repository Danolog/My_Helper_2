/**
 * #190: bramka CI buduje bazę WYŁĄCZNIE migracjami i sprawdza RLS z 0005.
 *
 * `drizzle-kit push` po `db:migrate` wyłącza RLS i usuwa polityki na 39 tabelach
 * (pomiar #190), więc testy pg i E2E w CI szłyby na bazie bez izolacji salonów.
 * Ten test pada, gdy:
 * - w jobie z Postgresem pojawi się polecenie spoza LISTY DOZWOLONYCH (linie run:,
 *   także z bloków YAML o dowolnym wskaźniku; skrypty package.json z nazwą i treścią),
 *   albo drizzle-kit wywołany inaczej niż `drizzle-kit migrate` — wprost albo przez
 *   skrypt rozwijany rekurencyjnie (#194: W5, W5c, E12);
 * - strażnik `scripts/db-rls-guard.ts` zniknie, zostanie wyciszony albo przesunięty:
 *   musi stać zaraz po `db:migrate` ORAZ jako ostatni krok z `run:` w jobie
 *   (po Playwrightcie, `if: ${{ !cancelled() }}`), tak żeby RLS zdjęte w trakcie
 *   joba w dowolnej postaci dawało czerwony job.
 *
 * Zasada (#194 runda 5): CZEGO TEST NIE UMIE SPARSOWAĆ, TO PORAŻKA. Nieznany
 * kształt nagłówka joba, plik z `jobs:` bez rozpoznanych jobów, kroki w innym stylu
 * wcięć niż w repo, nieznany kształt polecenia pnpm czy wskaźnika bloku — wyjątek,
 * nigdy ciche przepuszczenie.
 *
 * #201: dwie warstwy. (1) Drzewo YAML (js-yaml 4.3.2, schemat domyślny): składnia, push
 * w każdej wartości (`shell:`, `defaults:`…), job z bazą po drzewie (także `$GITHUB_ENV`).
 * (2) Niezmiennik krzyżowy tekst ↔ parser liniowy ↔ drzewo YAML z numerem i treścią linii.
 * Kotwice i aliasy YAML nadal = porażka (sprawdzane na tekście).
 *
 * #193 P0c-2: job z bazą to także job z dowolną zmienną bazy (adres albo PG*) bez `services:`;
 * obraz bazy przypięty po skrócie; konfiguracja Playwrighta i pliki globalSetup/globalTeardown
 * czytane parserem TypeScript (importy z zamkniętych list, bez dotenv i `process.loadEnvFile`,
 * `process.env` tylko do odczytu).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WF = readFileSync(join(ROOT, ".github/workflows/quality-gate.yml"), "utf8");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
const GUARD_RUN = "pnpm exec tsx scripts/db-rls-guard.ts";
const FINAL_IF = "${{ !cancelled() }}";
/**
 * Lista DOZWOLONYCH skryptów package.json w jobach z bazą (#194): nazwa →
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
  ["kontrola seeda", /^pnpm exec tsx scripts\/verify-seed\.ts$/],
  // Bez --with-deps: pobieranie pakietów systemowych zjadało limit joba (#268).
  ["instalacja przeglądarki", /^pnpm exec playwright install chromium$/],
  ["testy E2E", /^pnpm exec playwright test --grep @(?:smoke|full) --workers=\d+ --retries=\d+$/],
];

/**
 * Czy linia polecenia jest dozwolona. Linia z `psql` — WYŁĄCZNIE dosłowna równość ciągu
 * z SEED_CHECK_LINES (zero wzorca; #194 O1–O5). Pozostałe — wzorce
 * z ALLOWED_DB_JOB_LINES, które psql nie dopuszczają.
 */
function allowedLine(line: string): boolean {
  if (/\bpsql\b|PGPASSWORD/.test(line)) return SEED_CHECK_LINES.includes(line);
  return ALLOWED_DB_JOB_LINES.some(([, re]) => re.test(line));
}

/**
 * Push w tekście polecenia (po rozwinięciu skryptów), po TOKENACH (#194 runda 4):
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
 * jest treścią ostatniego joba (#194 runda 5, C). [start, end) w znakach.
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
 * Fail-closed (#194, G2–G4): `steps:` z wartością w tej samej linii (alias, flow),
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
 * #194 Z1, W5c).
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
 * Zamknięta gramatyka kroku w jobach z bazą (#194 O6–O10). Własny odczyt linii —
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

/** Etykieta kroku do komunikatów (L3): job, numer od 1 i `name` albo `uses`. */
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
 * Lista DOZWOLONYCH (E12, N1): jedyne dopuszczalne wywołanie drizzle-kit
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

/** Zmienne z adresem bazy, które czyta aplikacja, testy pg albo narzędzia (porównanie bez wielkości liter). */
const DB_URL_KEYS = ["POSTGRES_URL", "DATABASE_URL", "INTEGRATION_POSTGRES_URL"];
/**
 * Zmienne libpq: wskazują bazę albo dane logowania do niej (#193 P0c-2, W-b). Hasło wpisane
 * w treść polecenia (`PGPASSWORD=… psql` w kroku weryfikacji seeda) to nie klucz env.
 */
const PG_ENV_KEYS = ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE"];
/** Klucze bazy: job z którymkolwiek z nich to „job z bazą” (W-a); w env podlegają regule jednej bazy (W-b). */
const DB_ENV_KEYS = [...DB_URL_KEYS, ...PG_ENV_KEYS];
const isDbKey = (k: string) => DB_ENV_KEYS.includes(k.toUpperCase());
/**
 * Klucze bazy jako całe słowa w tekście (bez wielkości liter); `INTEGRATION_POSTGRES_URL_X` to inna nazwa.
 * Dokładność celowo inna niż w DB_URL_KEY_TEXT (#193): tu KLASYFIKACJA „job z bazą” po dokładnej
 * nazwie klucza env — podciąg dałby fałszywą czerwień na kluczach pochodnych, których nic nie czyta
 * (kontrola `_X` z #194). Ta sama zasada w dbKeyLines.
 */
const dbKeysIn = (text: string): string[] => [
  ...new Set([...text.matchAll(new RegExp(`\\b(?:${DB_ENV_KEYS.join("|")})\\b`, "gi"))].map((m) => m[0].toUpperCase())),
];
/** Klucze bazy w pozycji klucza YAML (`KLUCZ:`, `"KLUCZ":`) na początku linii; `lead` = wcięcie. */
const dbKeyLines = (text: string, lead: string): string[] => [
  ...new Set([...text.matchAll(new RegExp(`^${lead}["']?(${DB_ENV_KEYS.join("|")})["']?\\s*:`, "gim"))].map((m) => m[1]!.toUpperCase())),
];

const QG = "quality-gate.yml";

/** WSZYSTKIE pliki workflow repo (nowy plik wchodzi do pętli automatycznie): [nazwa, treść]. */
const WF_DIR = join(ROOT, ".github/workflows");
const WORKFLOWS: Array<[string, string]> = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()
  .map((f) => [f, readFileSync(join(WF_DIR, f), "utf8")]);

/**
 * Po czym job jest „jobem z bazą” (#194 runda 4): sam klucz `services:`
 * albo `container:` na poziomie joba (bez rozpoznawania obrazów) ALBO klucz bazy z DB_ENV_KEYS
 * (adres bazy albo PG*, #193 P0c-2 W-a/W-b) w env joba lub kroku. Zwraca powody (pusta lista = job bez bazy).
 */
function dbReasons(body: string): string[] {
  const c = code(body);
  const out: string[] = [];
  if (/^ {4}["']?services["']?\s*:/m.test(c)) out.push("services:");
  if (/^ {4}["']?container["']?\s*:/m.test(c)) out.push("container:");
  for (const k of dbKeyLines(c, "\\s+")) out.push(`${k} w env`);
  return out;
}

/** Job z bazą poza parą {e2e-smoke, e2e-full} z quality-gate.yml (w każdym pliku workflow). */
function dbJobViolations(file: string, wf: string): string[] {
  // Klucz bazy poza sekcją jobs: (env workflow, przed albo po jobach) trafia do KAŻDEGO joba —
  // zakazane w każdym pliku (G1/G5, C; #193 P0c-2: każdy klucz z DB_ENV_KEYS).
  const top = dbKeyLines(code(outsideJobs(wf)), "\\s*").map((k) => `${file}: ${k} poza jobs: (env workflow) — zakazane`);
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

// --- Warstwa YAML (#201: js-yaml 4.3.2, `load` ze schematem domyślnym) -----------

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

/** Klucze bazy (DB_ENV_KEYS) wymienione gdziekolwiek w poddrzewie: w kluczach i w wartościach tekstowych. */
const dbKeysInTree = (v: Y): string[] => [...new Set(walk(v, "").flatMap(([, x]) => (typeof x === "string" ? dbKeysIn(x) : [])))];

/**
 * Sprawdzenia na drzewie YAML (#201) — niezależne od kształtu tekstu (jawny klucz `?`, escape,
 * tag, blok złożony, `shell:`, `defaults:`):
 * - plik musi się parsować (inaczej GitHub też go odrzuci);
 * - push (`isPush`) w KAŻDEJ wartości i kluczu drzewa (I10: `shell:`, `defaults.run.shell`, `with:`…);
 * - `run` każdego kroku po rozwinięciu skryptów package.json;
 * - job z bazą: `services`, `container` albo klucz bazy z DB_ENV_KEYS gdziekolwiek w jobie (env,
 *   `$GITHUB_ENV` w poleceniu…; #193 P0c-2 W-a/W-b) — tylko para e2e-smoke/e2e-full w quality-gate.yml;
 * - klucz bazy poza `jobs:` — zakazane.
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
      ? [...("services" in job ? ["services"] : []), ...("container" in job ? ["container"] : []), ...dbKeysInTree(job)]
      : [];
    if (reasons.length) out.push(`${file}: YAML: nowy job z bazą: dodaj go do testu i strażników: ${name} (${reasons.join(", ")})`);
  }
  const outside = Object.fromEntries(Object.entries(tree).filter(([k]) => k !== "jobs"));
  for (const k of dbKeysInTree(outside)) out.push(`${file}: YAML: ${k} poza jobs: — zakazane`);
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
    () => dbImageViolations(file, wf),
  ];
  return checks.flatMap((c) => {
    try {
      return c();
    } catch (e) {
      return [`${file}: wyjątek parsera: ${(e as Error).message}`];
    }
  });
}

// --- Obraz bazy w jobach z bazą (#193 P0c-2, W-c) -----------------------------------------------

/**
 * Obraz usługi bazy w obu jobach z bazą: przypięty po skrócie indeksu (manifest list / OCI index,
 * nie jednej platformy). Tag jest dla czytelnika, o obrazie przesądza skrót. Aktualizacja ręczna
 * (Dependabot nie obsługuje obrazów `services:`).
 */
const PG_IMAGE = "pgvector/pgvector:pg18@sha256:38681dc6eaf55308e2a4c6de392d131652dcfac70e1263e35cd9b5ea3fe39782";
const IMAGE_MSG = "zmianę obrazu (tag lub digest) akceptują CTO i CRCO (#193)";
const SERVICES_MSG = "dodatkową usługę akceptują CTO i CRCO (#193)";

/** Czym wartość `image` różni się od PG_IMAGE (do komunikatu); "" = równa dosłownie. */
function imageDiff(v: Y): string {
  if (v === undefined) return "brak image";
  if (typeof v !== "string") return `image nie jest tekstem: ${JSON.stringify(v)}`;
  if (v === PG_IMAGE) return "";
  const [ref, digest] = v.split("@sha256:");
  const [wantRef, wantDigest] = PG_IMAGE.split("@sha256:");
  if (digest === undefined) return `tag bez skrótu @sha256: ${v}`;
  if (ref !== wantRef) return `inny tag: ${ref}`;
  if (digest !== wantDigest) return `inny skrót: ${digest}`;
  return `inna wartość: ${v}`;
}

/**
 * W quality-gate.yml każdy job z DB_JOBS: `services:` z dokładnie jedną usługą `postgres`,
 * `services.postgres.image` dosłownie równe PG_IMAGE, bez `container:` (job biegłby w obrazie spoza przypięcia). Inne pliki: bez zmian (tam job
 * z bazą i tak jest naruszeniem dbJobViolations). Drzewo YAML z #201; błąd składni zgłasza
 * yamlViolations (tu pomijamy, jak niezmiennik krzyżowy).
 */
function dbImageViolations(file: string, wf: string): string[] {
  if (file !== QG) return [];
  let all: Record<string, Y>;
  try {
    all = yamlTree(wf).jobs as Record<string, Y>;
  } catch {
    return [];
  }
  return DB_JOBS.flatMap((name) => {
    const job = all[name];
    if (!isMap(job)) return [`${file}: ${name}: brak joba z bazą — ${IMAGE_MSG}`];
    const out: string[] = [];
    if ("container" in job) out.push(`${file}: ${name}: container: w jobie z bazą — zakazany; ${IMAGE_MSG}`);
    const services = isMap(job.services) ? Object.keys(job.services) : [];
    if (services.length !== 1 || services[0] !== "postgres") {
      out.push(`${file}: ${name}: services: [${services.join(", ")}] — oczekiwana dokładnie jedna usługa „postgres”; ${SERVICES_MSG}`);
    }
    const pg = isMap(job.services) ? job.services.postgres : undefined;
    const diff = imageDiff(isMap(pg) ? pg.image : undefined);
    if (diff) out.push(`${file}: ${name}: services.postgres.image — ${diff}; ${IMAGE_MSG}`);
    return out;
  });
}

// --- Jedna baza w CI (#193 P0c-1, pkt 8; P0c-2 W-b: także PG*) -----------------------------------

/**
 * Nazwa zmiennej bazy w tekście (podciąg, bez względu na wielkość liter; także nazwy pochodne
 * typu `MY_POSTGRES_URL`, `MY_PGHOST`): adres albo PG* (P0c-2 W-b — obowiązuje każdą regułę
 * opartą na liście kluczy bazy: zapis do `$GITHUB_ENV`, nazwa bazy w konfiguracji Playwrighta).
 * Dokładność celowo inna niż w dbKeysIn/dbKeyLines (#193): to reguły zakazu WZMIANKI — nazwa
 * może być składana albo prefiksowana, więc fail-closed po podciągu; fałszywa czerwień kosztuje
 * tylko przemianowanie. Igły to pełne nazwy kluczy (nie „pg”), więc np. `pgvector` nie trafia.
 */
const DB_URL_KEY_TEXT = new RegExp(DB_ENV_KEYS.join("|"), "i");

/** Dopuszczenie: [job, nazwa kroku, klucz]. */
type SameDbCase = [string, string, string];

/**
 * Jedyne miejsce, gdzie krok może dostać zmienną bazy (#193): job e2e-smoke, krok z
 * `run: pnpm test:pg`, klucz `INTEGRATION_POSTGRES_URL`, wartość DOSŁOWNIE równa `POSTGRES_URL`
 * joba (porównanie tekstu wartości `===`, bez normalizacji).
 * Każde późniejsze dopuszczenie w tej regule idzie przez recenzję jako wyjątek.
 */
const SAME_DB_ALLOWED = { job: "e2e-smoke", run: "pnpm test:pg", key: "INTEGRATION_POSTGRES_URL" } as const;
const ONE_DB = "w CI jedna baza; nowe dopuszczenie akceptuje CTO (#193)";

/**
 * Jedna baza w CI (drzewo YAML z #201):
 * - `env:` całego workflow: klucz bazy z DB_ENV_KEYS (adres albo PG*, bez względu na wielkość
 *   liter) = naruszenie bez dopuszczeń (trafia do każdego joba);
 * - joby z `services:`: w env kroku i w env joba (poza samym `POSTGRES_URL` joba) klucz z
 *   DB_ENV_KEYS = naruszenie, chyba że to SAME_DB_ALLOWED: ten job, ten krok, ten klucz i wartość
 *   równa `POSTGRES_URL` joba. Inna wartość (inna baza, inny host, wyrażenie `${{ … }}`), inny krok
 *   albo inny job = naruszenie;
 * - krok, którego `run` pisze do `$GITHUB_ENV` cokolwiek z nazwą zmiennej bazy (adres albo PG*) = naruszenie bez
 *   względu na wartość.
 * Błąd składni YAML zgłasza yamlViolations — tu wtedy wyjątek (fail-closed).
 */
function oneDbScan(file: string, wf: string): { violations: string[]; sameDb: SameDbCase[] } {
  const tree = yamlTree(wf);
  const violations: string[] = [];
  const sameDb: SameDbCase[] = [];
  for (const k of Object.keys(isMap(tree.env) ? tree.env : {})) {
    if (isDbKey(k)) violations.push(`${file}: env workflow: ${k} — zmienna bazy w env całego workflow trafia do każdego joba; zakazane bez dopuszczeń (#193)`);
  }
  for (const [name, job] of Object.entries(tree.jobs as Record<string, Y>)) {
    if (!isMap(job) || !("services" in job)) continue;
    const jobEnv = isMap(job.env) ? job.env : {};
    const jobUrl = jobEnv.POSTGRES_URL;
    if (typeof jobUrl !== "string" || jobUrl === "") {
      violations.push(`${file}: ${name}: job z services: bez POSTGRES_URL w env joba — nie wiadomo, która to baza`);
      continue;
    }
    const check = (env: Record<string, Y>, where: string, stepName: string, run: Y) => {
      for (const [k, v] of Object.entries(env)) {
        if (!isDbKey(k) || (where === "env joba" && k === "POSTGRES_URL")) continue;
        const allowedPlace = name === SAME_DB_ALLOWED.job && run === SAME_DB_ALLOWED.run && k === SAME_DB_ALLOWED.key;
        if (!allowedPlace) violations.push(`${file}: ${name}, ${where}: ${k} poza jedynym dozwolonym miejscem (${SAME_DB_ALLOWED.job}, krok \`${SAME_DB_ALLOWED.run}\`) — ${ONE_DB}`);
        else if (v !== jobUrl) violations.push(`${file}: ${name}, ${where}: ${k} wskazuje inną bazę niż POSTGRES_URL joba (wartość różna dosłownie) — ${ONE_DB}`);
        else sameDb.push([name, stepName, k]);
      }
    };
    check(jobEnv, "env joba", "(job)", undefined);
    const st = Array.isArray(job.steps) ? (job.steps as Y[]) : [];
    st.forEach((s, i) => {
      if (!isMap(s)) return;
      const label = `krok ${i + 1} (${typeof s.name === "string" ? s.name : typeof s.uses === "string" ? `uses ${s.uses}` : "bez nazwy"})`;
      if (isMap(s.env)) check(s.env, `${label}, env kroku`, typeof s.name === "string" ? s.name : label, s.run);
      if (typeof s.run === "string" && /GITHUB_ENV/.test(s.run) && DB_URL_KEY_TEXT.test(s.run)) {
        violations.push(`${file}: ${name}, ${label}: zapis zmiennej bazy do $GITHUB_ENV — ${ONE_DB}`);
      }
    });
  }
  return { violations, sameDb };
}

/** Inwentarz dopuszczeń na workflow repo: dokładnie jedno (e2e-smoke, krok test:pg). */
const SAME_DB_CASES: SameDbCase[] = [["e2e-smoke", "Integration test — subscription locks (real Postgres)", "INTEGRATION_POSTGRES_URL"]];

const PW_FILE = "playwright.config.ts";
const PW = readFileSync(join(ROOT, PW_FILE), "utf8");
/** `webServer.command` dosłownie jak na d783774 (#193 P0c-1). */
const PW_COMMAND_LINE = "command: isCI ? 'pnpm start' : 'pnpm dev',";
/** Skrypty, które uruchamia `webServer.command` — dokładna treść. */
const PW_SERVER_SCRIPTS: Record<string, string> = { start: "next start", dev: "next dev --turbopack" };
const PW_WEBSERVER_KEYS = ["command", "url", "reuseExistingServer", "timeout"];
/** Zamknięta lista modułów, które konfiguracja Playwrighta może importować (#193 P0c-1). */
const PW_IMPORTS_ALLOWED = ["@playwright/test"];

// --- Parser TypeScript: konfiguracja Playwrighta i pliki globalSetup/globalTeardown (#193 P0c-2) ---

/** Źródło do skanu i sond: jawny identyfikator (ścieżka od korzenia repo) i treść. */
type Source = { id: string; text: string };
const readSource = (id: string): Source => ({ id, text: readFileSync(join(ROOT, id), "utf8") });
const PW_SRC: Source = { id: PW_FILE, text: PW };
const SETUP_SRC = readSource("tests/global-setup.ts");
const TEARDOWN_SRC = readSource("tests/global-teardown.ts");
const CLEANUP_SRC = readSource("tests/e2e-cleanup.ts");

/** Ścieżki globalSetup/globalTeardown w konfiguracji — literały dokładnie jak dziś. */
const PW_GLOBAL_PATHS: Array<[string, string]> = [
  ["globalSetup", "./tests/global-setup.ts"],
  ["globalTeardown", "./tests/global-teardown.ts"],
];

/**
 * Pliki wykonywane w procesie Playwrighta, każdy z zamkniętą listą importów równą dzisiejszej.
 * Rola = skąd plik jest ładowany: konfiguracja, globalSetup, globalTeardown albo import
 * globalTeardown (jeden poziom lokalnych importów). Importy głębiej (np. `scripts/seed-host-guard`)
 * zostają ryzykiem rezydualnym P6.
 */
type ScanEntry = { src: Source; role: string; imports: string[] };
const PW_SCAN: ScanEntry[] = [
  { src: PW_SRC, role: "konfiguracja", imports: PW_IMPORTS_ALLOWED },
  { src: SETUP_SRC, role: "globalSetup", imports: ["fs", "path", "@playwright/test"] },
  { src: TEARDOWN_SRC, role: "globalTeardown", imports: ["path", "./e2e-cleanup", "./global-setup", "@playwright/test"] },
  { src: CLEANUP_SRC, role: "import globalTeardown", imports: ["fs", "util", "postgres", "../scripts/seed-host-guard"] },
  { src: SETUP_SRC, role: "import globalTeardown", imports: ["fs", "path", "@playwright/test"] },
];
const PW_ENTRY = PW_SCAN[0]!;

/** Moduły wczytujące pliki env do `process.env` — zakazane bez względu na listy (#193). */
const isDotenv = (m: string) => m === "dotenv" || m.startsWith("dotenv/") || m.startsWith("dotenv-") || m.startsWith("@dotenvx/");

function tsSource(id: string, text: string): ts.SourceFile {
  return ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Tekst literału napisowego (bez podstawień) albo null. */
const literal = (e: ts.Node | undefined): string | null =>
  e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null;

/** Rodzic z pominięciem nawiasów oraz węzeł, który jest jego bezpośrednim dzieckiem. */
function usage(n: ts.Node): [ts.Node, ts.Node] {
  let child = n;
  let p = n.parent;
  while (ts.isParenthesizedExpression(p)) {
    child = p;
    p = p.parent;
  }
  return [child, p];
}

/** `process` (także `globalThis.process`, `x["process"]`). */
const isProcessRef = (n: ts.Node): boolean =>
  ts.isIdentifier(n) ? n.text === "process" : ts.isPropertyAccessExpression(n) ? n.name.text === "process" : ts.isElementAccessExpression(n) && literal(n.argumentExpression) === "process";

/** Nazwa składowej odczytanej z `x.nazwa` / `x["nazwa"]`; undefined = nie dostęp do składowej, null = klucz nie-literał. */
function memberName(access: ts.Node, of: ts.Node): string | null | undefined {
  if (ts.isPropertyAccessExpression(access) && access.expression === of) return access.name.text;
  if (ts.isElementAccessExpression(access) && access.expression === of) return literal(access.argumentExpression);
  return undefined;
}

/** Jak wyrażenie `a` (np. `process.env.X`) jest zapisywane; null = odczyt. */
function writeForm(a: ts.Node): string | null {
  const [n, p] = usage(a);
  if (ts.isBinaryExpression(p) && p.left === n) {
    const op = p.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken) return "przypisanie do składowej";
    const logical: ts.SyntaxKind[] = [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken];
    if ((op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment) || logical.includes(op)) return "przypisanie złożone";
  }
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return "++/--";
  if (ts.isDeleteExpression(p)) return "delete";
  if ((ts.isForInStatement(p) || ts.isForOfStatement(p)) && p.initializer === n) return "zmienna pętli for…in/of";
  // Cel przypisania przez destrukturyzację: `[process.env.X] = …`, `({ a: process.env.X } = …)`.
  let lit: ts.Node = n;
  let up = p;
  while (ts.isArrayLiteralExpression(up) || ts.isObjectLiteralExpression(up) || ts.isPropertyAssignment(up) || ts.isShorthandPropertyAssignment(up) || ts.isSpreadElement(up) || ts.isSpreadAssignment(up)) {
    lit = up;
    up = up.parent;
    while (ts.isParenthesizedExpression(up)) {
      lit = up;
      up = up.parent;
    }
  }
  if (lit !== n && ts.isBinaryExpression(up) && up.left === lit && up.operatorToken.kind === ts.SyntaxKind.EqualsToken) return "przypisanie przez destrukturyzację";
  if (lit !== n && (ts.isForInStatement(up) || ts.isForOfStatement(up)) && up.initializer === lit) return "przypisanie przez destrukturyzację";
  return null;
}

/** Funkcja lokalna: moduł (null = ten plik) i nazwa deklaracji w nim. */
type LocalFn = { module: string | null; name: string };

/**
 * Funkcje, którym wolno podać `process.env` jako argument: funkcje zadeklarowane w pliku
 * (`function f`) i nazwane importy z modułów lokalnych (`./`, `../`). Import domyślny i
 * przestrzeń nazw nie wchodzą (fail-closed: nie wiadomo, która deklaracja).
 */
function localFunctions(sf: ts.SourceFile): Map<string, LocalFn> {
  const out = new Map<string, LocalFn>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) out.set(st.name.text, { module: null, name: st.name.text });
    const spec = ts.isImportDeclaration(st) ? literal(st.moduleSpecifier) : null;
    if (spec === null || !/^\.\.?\//.test(spec) || !ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const b = st.importClause.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) if (!el.isTypeOnly) out.set(el.name.text, { module: spec, name: (el.propertyName ?? el.name).text });
  }
  return out;
}

/** Pliki zestawu Playwrighta po identyfikatorze (do odczytu deklaracji funkcji lokalnych). */
const PW_SOURCES = [PW_SRC, SETUP_SRC, TEARDOWN_SRC, CLEANUP_SRC];
const posixJoin = (from: string, spec: string) => {
  const parts = from.split("/").slice(0, -1);
  for (const p of spec.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return `${parts.join("/")}.ts`;
};

/**
 * Parametr na pozycji `pos` funkcji `fn.name` (w tym pliku albo w module lokalnym z zestawu)
 * ma typ dokładnie `CleanupEnv`; inaczej powód. Deklaracja tylko jako `function` (jedna);
 * moduł spoza zestawu, brak deklaracji, parametr reszty albo inny typ = naruszenie (fail-closed).
 */
function cleanupEnvParamProblem(fromId: string, fromSf: ts.SourceFile, fn: LocalFn, pos: number, textOf: (id: string) => string): string | null {
  let sf = fromSf;
  if (fn.module !== null) {
    const id = posixJoin(fromId, fn.module);
    if (!PW_SOURCES.some((s) => s.id === id)) return `moduł ${fn.module} spoza skanowanego zestawu`;
    sf = tsSource(id, textOf(id));
  }
  const decls = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn.name);
  if (decls.length !== 1) return `deklaracji funkcji ${fn.name}: ${decls.length}`;
  const p = decls[0]!.parameters[pos];
  if (!p || p.dotDotDotToken) return `funkcja ${fn.name} bez zwykłego parametru na pozycji ${pos}`;
  const t = p.type;
  if (!t || !ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName) || t.typeName.text !== "CleanupEnv" || t.typeArguments) {
    return `parametr ${pos} funkcji ${fn.name} ma typ ${t ? t.getText() : "(brak)"} zamiast CleanupEnv`;
  }
  return null;
}

/**
 * Jeden plik z PW_SCAN, parserem TypeScript (komentarze i napisy to nie kod). Naruszenia:
 * - plik nie parsuje się;
 * - odwołanie do modułu spoza zamkniętej listy pliku: `import … from`, `import "x"`, `export … from`
 *   (także `export * from`), `import x = require()`, `require()`, `import()`; argument nie-literał;
 *   `require` użyte inaczej niż jako wywołanie z literałem;
 * - moduł z rodziny dotenv (`dotenv`, `dotenv/*`, `dotenv-*`, `@dotenvx/*`) — zawsze;
 * - `process.loadEnvFile` (wywołanie albo wartość);
 * - `process.env` inaczej niż (a) odczyt `process.env.X` / `process.env["X"]` albo (b) bezpośredni
 *   argument wywołania funkcji lokalnej (nazwany import z modułu lokalnego albo funkcja z pliku),
 *   której parametr na tej pozycji ma typ `CleanupEnv` (cleanupEnvParamProblem).
 *   Każda inna forma = naruszenie: zapis, `delete`, `++`/`--`, przypisanie złożone, destrukturyzacja,
 *   `process.env = …`, argument `Object.assign`/`Object.defineProperty`/`Reflect.*`, alias;
 * - `process` jako wartość (alias, `const { env } = process`, argument), klucz `process[…]` nie-literał.
 */
function pwFileViolations(e: ScanEntry, text: string = e.src.text, textOf: (id: string) => string = (id) => PW_SOURCES.find((s) => s.id === id)!.text): string[] {
  const at = e.role === "konfiguracja" ? e.src.id : `${e.src.id} [${e.role}]`;
  const out: string[] = [];
  const sf = tsSource(e.src.id, text);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diags.length) out.push(`${at}: plik nie parsuje się jako TypeScript: ${ts.flattenDiagnosticMessageText(diags[0]!.messageText, " ")}`);
  const mod = (what: string, m: string) => {
    if (!e.imports.includes(m)) out.push(`${at}: ${what} spoza listy (${e.imports.join(", ")}) — biblioteka może załadować env z inną bazą`);
    if (isDotenv(m)) out.push(`${at}: moduł „${m}” z rodziny dotenv — zakazany bez względu na listy (#193)`);
  };
  const env = (msg: string) => out.push(`${at}: zapis do process.env — ${msg}`);
  const locals = localFunctions(sf);
  const visit = (n: ts.Node): void => {
    if (ts.isTypeNode(n)) return;
    if (ts.isImportDeclaration(n)) mod(`import „${literal(n.moduleSpecifier)}”`, literal(n.moduleSpecifier) ?? "");
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier) mod(`export … from „${literal(n.moduleSpecifier)}”`, literal(n.moduleSpecifier) ?? "");
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      const m = literal(n.moduleReference.expression);
      if (m === null) out.push(`${at}: import = require(${n.moduleReference.expression.getText()}) bez literału spoza listy (${e.imports.join(", ")})`);
      else mod(`import = require(„${m}”)`, m);
    } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
      const how = n.expression.kind === ts.SyntaxKind.ImportKeyword ? "import" : "require";
      const m = n.arguments.length === 1 ? literal(n.arguments[0]) : null;
      if (m === null) out.push(`${at}: ${how}(${n.arguments.map((a) => a.getText()).join(", ")}) bez literału spoza listy (${e.imports.join(", ")}) — biblioteka może załadować env z inną bazą`);
      else mod(`${how}(„${m}”)`, m);
    } else if (ts.isIdentifier(n) && n.text === "require") {
      const p = n.parent;
      if (!(ts.isCallExpression(p) && p.expression === n) && !(ts.isExternalModuleReference(p))) out.push(`${at}: require jako wartość (${p.getText()}) — fail-closed`);
    }
    // `process`: odwołanie (nie nazwa składowej `x.process` — tę obsługuje węzeł dostępu).
    const par = n.parent as ts.Node | undefined;
    const isName =
      par !== undefined &&
      ((ts.isPropertyAccessExpression(par) && par.name === n) ||
        ((ts.isPropertyAssignment(par) || ts.isPropertySignature(par) || ts.isPropertyDeclaration(par) || ts.isMethodDeclaration(par)) && par.name === n));
    if (par !== undefined && !isName && isProcessRef(n)) {
      const [child, p] = usage(n);
      const name = memberName(p, child);
      if (name === undefined) out.push(`${at}: process jako wartość (${p.getText()}) — alias albo destrukturyzacja omija regułę process.env`);
      else if (name === null) out.push(`${at}: process[…] z kluczem nie-literałem (${p.getText()})`);
      else if (name === "loadEnvFile") out.push(`${at}: process.loadEnvFile — zakazane (wczytuje plik env do process.env): ${p.parent.getText()}`);
      else if (name === "env") {
        const [eChild, ep] = usage(p);
        const key = memberName(ep, eChild);
        if (key === null) env(`klucz nie-literał: ${ep.getText()}`);
        else if (key !== undefined) {
          const w = writeForm(ep);
          if (w) env(`${w}: ${ep.parent.getText()}`);
        } else if (ts.isCallExpression(ep) && ep.arguments.some((a) => a === eChild)) {
          const callee = ep.expression;
          const fn = ts.isIdentifier(callee) ? locals.get(callee.text) : undefined;
          if (!fn) env(`argument wywołania ${callee.getText()}(…) — dozwolone tylko funkcje lokalne (import z modułu lokalnego, funkcja z pliku)`);
          else {
            const why = cleanupEnvParamProblem(e.src.id, sf, fn, ep.arguments.indexOf(eChild as ts.Expression), textOf);
            if (why) env(`argument wywołania ${callee.getText()}(…) — parametr musi mieć typ CleanupEnv: ${why}`);
          }
        } else if (ts.isBinaryExpression(ep) && ep.left === eChild && ep.operatorToken.kind === ts.SyntaxKind.EqualsToken) env(`przypisanie całego process.env: ${ep.getText()}`);
        else if (ts.isDeleteExpression(ep)) env(`delete: ${ep.getText()}`);
        else env(`process.env jako wartość (alias): ${ep.getText()}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * Ścieżki globalSetup/globalTeardown w konfiguracji: nazwa klucza dokładnie raz w całym pliku
 * (jako nazwa właściwości), wartość — literał napisowy równy PW_GLOBAL_PATHS. Tablica, wyrażenie,
 * inna ścieżka, skrót `{ globalSetup }` albo brak = naruszenie (fail-closed).
 */
function pwGlobalPathViolations(text: string): string[] {
  const sf = tsSource(PW_FILE, text);
  return PW_GLOBAL_PATHS.flatMap(([key, want]) => {
    const hits: ts.Node[] = [];
    const visit = (n: ts.Node): void => {
      if ((ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === key) hits.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const bad = (why: string) => [`${PW_FILE}: ${key} — oczekiwany dokładnie jeden literał „${want}”: ${why}`];
    if (hits.length !== 1) return bad(`wystąpień nazwy ${hits.length}`);
    const p = hits[0]!.parent;
    if (!ts.isPropertyAssignment(p) || p.name !== hits[0]) return bad(`nie właściwość z wartością: ${p.getText()}`);
    const v = literal(p.initializer);
    if (v === null || !ts.isStringLiteral(p.initializer)) return bad(`wartość nie jest literałem: ${p.initializer.getText()}`);
    return v === want ? [] : bad(`inna ścieżka: ${v}`);
  });
}

/**
 * `CleanupEnv` (typ parametru, przez który teardown podaje `process.env` do e2e-cleanup) tylko do
 * odczytu: literał typu, każda składowa (sygnatura indeksu albo właściwość) z `readonly`.
 */
function cleanupEnvViolations(text: string = CLEANUP_SRC.text): string[] {
  const sf = tsSource(CLEANUP_SRC.id, text);
  const decl = sf.statements.filter((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === "CleanupEnv");
  const bad = (why: string) => [`${CLEANUP_SRC.id}: CleanupEnv nie jest tylko do odczytu — ${why}`];
  if (decl.length !== 1) return bad(`deklaracji ${decl.length}`);
  const t = decl[0]!.type;
  if (!ts.isTypeLiteralNode(t) || t.members.length === 0) return bad(`oczekiwany literał typu z polami readonly: ${t.getText()}`);
  const ro = (m: ts.TypeElement) =>
    (ts.isIndexSignatureDeclaration(m) || ts.isPropertySignature(m)) && (ts.getModifiers(m) ?? []).some((x) => x.kind === ts.SyntaxKind.ReadonlyKeyword);
  const writable = t.members.filter((m) => !ro(m));
  return writable.length ? bad(`składowe bez readonly: ${writable.map((m) => m.getText()).join("; ")}`) : [];
}

/** Cały zestaw Playwrighta, z jednym plikiem podmienionym przez sondę (id z PW_SCAN). */
function pwSetViolations(id?: string, text?: string): string[] {
  const t = (s: Source) => (s.id === id && text !== undefined ? text : s.text);
  const textOf = (fid: string) => t(PW_SOURCES.find((s) => s.id === fid)!);
  return [...PW_SCAN.flatMap((e) => pwFileViolations(e, t(e.src), textOf)), ...pwGlobalPathViolations(t(PW_SRC)), ...cleanupEnvViolations(t(CLEANUP_SRC))];
}

/** Treść obiektu `webServer: { … }` (bez klamer). Inny kształt niż jeden literał obiektu = wyjątek. */
function webServerBlock(src: string): string {
  const hits = src.split(/\bwebServer\s*:/).length - 1;
  if (hits !== 1) throw new Error(`${PW_FILE}: oczekiwano dokładnie jednego „webServer:”, jest ${hits}`);
  const at = src.search(/\bwebServer\s*:\s*\{/);
  if (at < 0) throw new Error(`${PW_FILE}: webServer nie jest literałem obiektu`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`${PW_FILE}: niedomknięty obiekt webServer`);
}

/**
 * Serwer E2E (playwright webServer) dziedziczy env kroku, więc bazę ma tę samą co job. Naruszenia:
 * nazwa zmiennej bazy gdziekolwiek w pliku (także w komentarzu — przenieś opis gdzie indziej),
 * reguły parsera TS z pwFileViolations (importy spoza PW_IMPORTS_ALLOWED, dotenv, `process.loadEnvFile`,
 * zapis do `process.env`), w webServer klucz spoza listy (w tym `env`) albo spread, `command` inne niż na d783774.
 */
function playwrightDbViolations(src: string): string[] {
  const out: string[] = pwFileViolations(PW_ENTRY, src);
  if (DB_URL_KEY_TEXT.test(src)) out.push(`${PW_FILE}: nazwa zmiennej bazy w konfiguracji Playwrighta — serwer E2E ma bazę joba`);
  let block: string;
  try {
    block = webServerBlock(src);
  } catch (e) {
    return [...out, (e as Error).message];
  }
  if (block.includes("...")) out.push(`${PW_FILE}: spread w webServer — klucze muszą być jawne`);
  for (const line of block.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"))) {
    const k = line.match(/^([A-Za-z_$][\w$]*)\s*:/)?.[1];
    if (!k || !PW_WEBSERVER_KEYS.includes(k)) out.push(`${PW_FILE}: webServer — linia spoza listy kluczy (${PW_WEBSERVER_KEYS.join(", ")}): ${line}`);
  }
  const cmd = block.split("\n").map((l) => l.trim()).filter((l) => /^command\s*:/.test(l));
  if (cmd.length !== 1 || cmd[0] !== PW_COMMAND_LINE) out.push(`${PW_FILE}: webServer.command inne niż „${PW_COMMAND_LINE}”: ${cmd.join(" | ") || "(brak)"}`);
  return out;
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

describe("stepViolations — zamknięta gramatyka kroku (O6–O10)", () => {
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

  it("instalacja przeglądarki: dozwolone wyłącznie `pnpm exec playwright install chromium` (#268)", () => {
    expect(allowedLine("pnpm exec playwright install chromium")).toBe(true);
    for (const bad of [
      "pnpm exec playwright install --with-deps chromium",
      "pnpm exec playwright install",
      "pnpm exec playwright install chromium firefox",
      "pnpm exec playwright install-deps chromium",
      "pnpm exec playwright install chromium && sudo apt-get install -y fonts-noto",
      "pnpm exec playwright install chromium || true",
      "pnpm exec playwright install chromium; sh x.sh",
      " pnpm exec playwright install chromium",
    ]) {
      expect(allowedLine(bad), bad).toBe(false);
    }
  });

  it("kontrola seeda: dozwolone wyłącznie `pnpm exec tsx scripts/verify-seed.ts`", () => {
    expect(allowedLine("pnpm exec tsx scripts/verify-seed.ts")).toBe(true);
    for (const bad of [
      "pnpm exec tsx scripts/verify-seed.ts --fix",
      "pnpm exec tsx scripts/verify-seed.ts && sh x.sh",
      "pnpm exec tsx scripts/verify-seed.ts; sh x.sh",
      "pnpm exec tsx scripts/verify-seed.ts || true",
      "pnpm exec tsx scripts/seed-test.ts",
      "pnpm exec tsx scripts/verify-seed-checks.ts",
      "pnpm exec tsx ./scripts/verify-seed.ts",
      "POSTGRES_URL=x pnpm exec tsx scripts/verify-seed.ts",
      " pnpm exec tsx scripts/verify-seed.ts",
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

  it.each([["INTEGRATION_POSTGRES_URL"], ["DATABASE_URL"], ["PGHOST"]])(
    "#193 P0c-2 (obok asercji #194): %s w env joba bez services: → job z bazą",
    (k) => {
      expect(dbJobViolations(QG, wf("e2e-extra", `    env:\n      ${k}: y\n`)).join("\n")).toContain(`nowy job z bazą: dodaj go do testu i strażników: e2e-extra (${k} w env)`);
    },
  );

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
 * Sonda na prawdziwym pliku: edycja treści źródła w pamięci, plik na dysku bez zmian. Źródło
 * podane jawnie (treść + identyfikator do komunikatu), bez rozpoznawania pliku po nazwie.
 * Kotwica musi wystąpić dokładnie raz — komunikat podaje źródło i kotwicę.
 */
function edited(src: Source, find: string, repl: string): string {
  expect(src.text.split(find).length - 1, `kotwica sondy w ${src.id}: ${find}`).toBe(1);
  return src.text.replace(find, repl);
}

/** Plik workflow z pętli WORKFLOWS jako źródło sondy. */
function wfSource(file: string): Source {
  const text = WORKFLOWS.find(([f]) => f === file)?.[1];
  if (text === undefined) throw new Error(`sonda: brak pliku workflow ${file}`);
  return { id: file, text };
}

/**
 * #201: sondy na PRAWDZIWYCH plikach workflow (edycja w pamięci, pliki na dysku bez zmian).
 * Grupa A — obejścia, które po #194 przechodziły: test ma padać.
 * Grupa B — poprawne edycje (sondy z recenzji #194), które dawały fałszywy alarm: test ma przechodzić.
 */
describe("#201: obejścia (A) padają, poprawne edycje (B) przechodzą", () => {
  const FILES = WORKFLOWS.map(([f]) => f);
  const EP = "e2e-production.yml";
  const EP_INSTALL = "      - run: pnpm install --frozen-lockfile\n";
  const QG_TC = "      - run: pnpm typecheck\n";
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
    expect(fileViolations(file, edited(wfSource(file), find, repl), FILES).join("\n")).toMatch(re);
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
    expect(fileViolations(file, edited(wfSource(file), find, repl), FILES)).toEqual([]);
  });

  it.each([
    ["F5 nazwa kroku z „, uses:” (w cudzysłowie — jedyny poprawny YAML)", QG, QG_TC, "      - name: \"Typecheck, uses: tsc\"\n        run: pnpm typecheck\n"],
    ["F10 wartość with: z „{run:” (w cudzysłowie — jedyny poprawny YAML)", QG, QG_TC, `${QG_TC}      - uses: actions/upload-artifact@v4\n        with:\n          name: x\n          path: "a/{run: 1}"\n`],
  ])("B %s → bez naruszeń", (_n, file, find, repl) => {
    expect(fileViolations(file, edited(wfSource(file), find, repl), FILES)).toEqual([]);
  });

  // F5 i F10 dosłownie z sondy to niepoprawny YAML (plain scalar z „: ” w kontekście blokowym) —
  // GitHub odrzuca taki plik. Test pada czytelnym komunikatem składni, nie rozjazdem niezmiennika
  // (#201).
  it.each([
    ["F5 dosłownie", QG_TC, "      - name: Typecheck, uses: tsc\n        run: pnpm typecheck\n"],
    ["F10 dosłownie", QG_TC, `${QG_TC}      - uses: actions/upload-artifact@v4\n        with:\n          name: x\n          path: a/{run: 1}\n`],
  ])("B %s (niepoprawny YAML) → jedno naruszenie: plik nie parsuje się jako YAML", (_n, find, repl) => {
    const v = fileViolations(QG, edited(wfSource(QG), find, repl), FILES);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/nie parsuje się jako YAML/);
  });

  it("komunikat niezmiennika wskazuje numer i treść nierozpoznanej linii", () => {
    const wf = edited(wfSource(EP), EP_INSTALL, `${EP_INSTALL}      - { run: pnpm exec playwright --version }\n`);
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
    const wf = edited(wfSource(EP), EP_INSTALL, `${EP_INSTALL}      - name: "a\n          run: b"\n        uses: actions/upload-artifact@v4\n        with: { name: x,\n          path: y, run: z }\n`);
    const line = wf.split("\n").indexOf("          path: y, run: z }") + 1;
    const msg = keyInvariantViolations(EP, wf).join("\n");
    expect(msg).toMatch(/kluczy run w pliku .*, w drzewie YAML/);
    expect(msg).toContain(`nierozpoznane: linia ${line}: path: y, run: z }`);
  });

  // Równa liczba kluczy po każdej stronie, ale różne linie: parser liniowy liczy „run:” po
  // niełamliwej spacji w cudzysłowie (\s), tekst go nie widzi; tekst i drzewo widzą run w flow,
  // parser nie. Porównanie samych liczb by to przepuściło — niezmiennik porównuje linie.
  it("niezmiennik porównuje linie, nie same liczby (równe liczby, różne linie)", () => {
    const wf = edited(wfSource(EP), EP_INSTALL,`${EP_INSTALL}      - name: "a\n           run: b"\n        uses: actions/upload-artifact@v4\n        with: { name: x, run: y }\n`);
    const ls = wf.split("\n");
    const flow = ls.indexOf("        with: { name: x, run: y }") + 1;
    const nbsp = ls.indexOf("           run: b\"") + 1;
    const msg = keyInvariantViolations(EP, wf).join("\n");
    expect(msg).toMatch(/kluczy run w pliku (\d+), rozpoznanych przez parser \1, w drzewie YAML \1;/);
    expect(msg).toContain(`nierozpoznane: linia ${flow}: with: { name: x, run: y }`);
    expect(msg).toContain(`rozpoznane przez parser, a niewidoczne jako klucz: linia ${nbsp}: run: b"`);
  });
});

describe("jedna baza w CI: env kroków, $GITHUB_ENV, serwer E2E (#193 P0c-1, pkt 8)", () => {
  /** Adres INNEJ bazy do sond, złożony z części (skaner literałów sekretów; to nie sekret). */
  const OTHER_DB = ["postgresql", "//probe:probe@localhost:5432/other_db"].join(":");
  const SMOKE_PW = "          PLAYWRIGHT_TIMEOUT: 15000\n";
  const FULL_PW = "          ALLOW_PAYMENT_SIMULATION: \"1\"\n\n      # Kontrola seeda drugi raz, po zielonych testach E2E @full: użytkownicy testowi z kontem z hasłem, plany i dostęp salonów testowych nadal zgodne z seedem.";
  const SMOKE_SEED = "      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Verify seed data";
  const PG_ENV_LINE = "          INTEGRATION_POSTGRES_URL: ";
  const PW_IMPORT = "import { defineConfig, devices } from '@playwright/test';\n";
  /**
   * Naruszenia sondy ponad stan bazowy workflow: sonda nie zależy od innych naruszeń w workflow
   * (te zgłasza test główny), tylko od swojej kotwicy. Stan bazowy liczony w teście, przy każdej sondzie.
   */
  const probeViolations = (find: string, repl: string) => {
    const base = oneDbScan(QG, WF).violations;
    return oneDbScan(QG, edited(wfSource(QG), find, repl)).violations.filter((v) => !base.includes(v));
  };

  it.each(WORKFLOWS)("%s: zmienne bazy bez env workflow; w jobach z services: w env kroków/joba tylko z adresem POSTGRES_URL joba; bez zapisu do $GITHUB_ENV", (f, wf) => {
    expect(oneDbScan(f, wf).violations).toEqual([]);
  });

  it("dopuszczenia po wartości to dziś dokładnie INTEGRATION_POSTGRES_URL w kroku test:pg (e2e-smoke)", () => {
    expect(oneDbScan(QG, WF).sameDb).toEqual(SAME_DB_CASES);
  });

  it(`${PW_FILE}: importy tylko z listy, webServer bez env i bez nadpisania bazy, command dosłownie jak na d783774`, () => {
    expect(playwrightDbViolations(PW)).toEqual([]);
  });

  it("skrypty uruchamiane przez webServer.command mają w package.json dokładnie oczekiwaną treść", () => {
    for (const [name, body] of Object.entries(PW_SERVER_SCRIPTS)) expect(PKG.scripts[name], name).toBe(body);
  });

  /** Adres bazy joba e2e-smoke odczytany z drzewa (nie literał w teście). */
  const JOB_URL = (load(WF) as { jobs: Record<string, { env: Record<string, string> }> }).jobs["e2e-smoke"]!.env.POSTGRES_URL!;
  const PLACE = /poza jedynym dozwolonym miejscem \(e2e-smoke, krok `pnpm test:pg`\)/;
  const VALUE = /wskazuje inną bazę niż POSTGRES_URL joba \(wartość różna dosłownie\)/;
  const at = (where: string, re: RegExp) => new RegExp(`${where}, env kroku: ${re.source}`);
  const PG_STEP = String.raw`e2e-smoke, krok \d+ \(Integration test — subscription locks \(real Postgres\)\)`;

  it.each([
    ["POSTGRES_URL innej bazy w env kroku Playwrighta (e2e-smoke)", SMOKE_PW, `${SMOKE_PW}          POSTGRES_URL: ${OTHER_DB}\n`, at(String.raw`e2e-smoke, krok \d+ \(Run smoke tests\)`, /POSTGRES_URL /), PLACE],
    ["DATABASE_URL innej bazy w env kroku Playwrighta (e2e-full)", FULL_PW, FULL_PW.replace('"1"\n', `"1"\n          DATABASE_URL: ${OTHER_DB}\n`), at(String.raw`e2e-full, krok \d+ \(Run full E2E tests\)`, /DATABASE_URL /), PLACE],
    ["klucz małymi literami (postgres_url) w env kroku", SMOKE_PW, `${SMOKE_PW}          postgres_url: ${OTHER_DB}\n`, /env kroku: postgres_url /, PLACE],
    ["wartość: INTEGRATION_POSTGRES_URL testu pg na inną bazę", PG_ENV_LINE, `          INTEGRATION_POSTGRES_URL: ${OTHER_DB}\n          X: `, at(PG_STEP, /INTEGRATION_POSTGRES_URL /), VALUE],
    ["wartość: INTEGRATION_POSTGRES_URL jako wyrażenie zamiast dosłownego adresu", PG_ENV_LINE, "          INTEGRATION_POSTGRES_URL: ${{ env.POSTGRES_URL }}\n          X: ", at(PG_STEP, /INTEGRATION_POSTGRES_URL /), VALUE],
    ["wartość bez normalizacji: ten sam adres z hostem WIELKIMI literami", PG_ENV_LINE, `          INTEGRATION_POSTGRES_URL: ${JOB_URL.replace("localhost", "LOCALHOST")}\n          X: `, at(PG_STEP, /INTEGRATION_POSTGRES_URL /), VALUE],
    ["miejsce: INTEGRATION_POSTGRES_URL z adresem joba w innym kroku (Run smoke tests)", SMOKE_PW, `${SMOKE_PW}          INTEGRATION_POSTGRES_URL: ${JOB_URL}\n`, at(String.raw`e2e-smoke, krok \d+ \(Run smoke tests\)`, /INTEGRATION_POSTGRES_URL /), PLACE],
    ["miejsce: INTEGRATION_POSTGRES_URL z adresem joba w innym jobie (e2e-full)", FULL_PW, FULL_PW.replace('"1"\n', `"1"\n          INTEGRATION_POSTGRES_URL: ${JOB_URL}\n`), at(String.raw`e2e-full, krok \d+ \(Run full E2E tests\)`, /INTEGRATION_POSTGRES_URL /), PLACE],
    ["POSTGRES_URL innej bazy w env kroku kontroli seeda po E2E (e2e-full)", "      - name: Seed check (after E2E)\n        run: pnpm exec tsx scripts/verify-seed.ts\n", `      - name: Seed check (after E2E)\n        run: pnpm exec tsx scripts/verify-seed.ts\n        env:\n          POSTGRES_URL: ${OTHER_DB}\n`, at(String.raw`e2e-full, krok \d+ \(Seed check \(after E2E\)\)`, /POSTGRES_URL /), PLACE],
    ["miejsce: inna zmienna bazy (DATABASE_URL) z adresem joba w kroku test:pg", PG_ENV_LINE, `          DATABASE_URL: ${JOB_URL}\n          INTEGRATION_POSTGRES_URL: `, at(PG_STEP, /DATABASE_URL /), PLACE],
    ["$GITHUB_ENV: krok pisze POSTGRES_URL innej bazy", SMOKE_SEED, `      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Switch db\n        run: echo "POSTGRES_URL=${OTHER_DB}" >> "$GITHUB_ENV"\n\n      - name: Verify seed data`, /Switch db\): zapis zmiennej bazy do \$GITHUB_ENV/, /./],
    ["$GITHUB_ENV: krok pisze INTEGRATION_POSTGRES_URL (blok run)", SMOKE_SEED, `      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Switch db\n        run: |\n          echo "INTEGRATION_POSTGRES_URL=${OTHER_DB}" >> "$GITHUB_ENV"\n\n      - name: Verify seed data`, /Switch db\): zapis zmiennej bazy do \$GITHUB_ENV/, /./],
    ["env workflow: DATABASE_URL innej bazy", "\njobs:\n", `\nenv:\n  DATABASE_URL: ${OTHER_DB}\n\njobs:\n`, /^quality-gate\.yml: env workflow: DATABASE_URL /, /trafia do każdego joba; zakazane bez dopuszczeń \(#193\)/],
    ["env workflow: POSTGRES_URL równy adresowi joba (bez dopuszczeń także po wartości)", "\njobs:\n", `\nenv:\n  POSTGRES_URL: ${JOB_URL}\n\njobs:\n`, /^quality-gate\.yml: env workflow: POSTGRES_URL /, /zakazane bez dopuszczeń/],
    ["env workflow: klucz małymi literami (integration_postgres_url)", "\njobs:\n", `\nenv:\n  integration_postgres_url: ${JOB_URL}\n\njobs:\n`, /env workflow: integration_postgres_url /, /zakazane bez dopuszczeń/],
  ])("A %s → porażka", (_n, find, repl, where, why) => {
    const v = probeViolations(find, repl);
    expect(v, "dokładnie jedno nowe naruszenie").toHaveLength(1);
    expect(v[0]).toMatch(where);
    expect(v[0]).toMatch(why);
  });

  it("zmienna bazy w env joba z services: (poza POSTGRES_URL joba) → naruszenie, także z adresem joba", () => {
    const job = (extra: string) =>
      `name: x\njobs:\n  a:\n    runs-on: x\n    services:\n      postgres:\n        image: x\n    env:\n      POSTGRES_URL: ${OTHER_DB}\n${extra}    steps:\n      - run: pnpm typecheck\n`;
    for (const v of [`${OTHER_DB}x`, OTHER_DB]) {
      const r = oneDbScan("x.yml", job(`      DATABASE_URL: ${v}\n`));
      expect(r.violations.join()).toMatch(/a, env joba: DATABASE_URL poza jedynym dozwolonym miejscem/);
      expect(r.sameDb).toEqual([]);
    }
  });

  it("job z services: bez POSTGRES_URL w env joba → naruszenie (nie wiadomo, która baza)", () => {
    const wf = "name: x\njobs:\n  a:\n    runs-on: x\n    services:\n      postgres:\n        image: x\n    steps:\n      - run: pnpm typecheck\n";
    expect(oneDbScan("x.yml", wf).violations.join()).toMatch(/a: job z services: bez POSTGRES_URL/);
  });

  it.each([
    ["webServer.env z POSTGRES_URL innej bazy", "          timeout: isCI ? 60000 : 120000,\n", `          timeout: isCI ? 60000 : 120000,\n          env: { POSTGRES_URL: '${OTHER_DB}' },\n`, /nazwa zmiennej bazy[\s\S]*linia spoza listy kluczy .*: env:/],
    ["webServer.env bez nazwy zmiennej bazy (np. z obiektu)", "          timeout: isCI ? 60000 : 120000,\n", "          timeout: isCI ? 60000 : 120000,\n          env: serverEnv,\n", /linia spoza listy kluczy .*: env: serverEnv,/],
    ["spread w webServer", "          url: 'http://localhost:3000',\n", "          url: 'http://localhost:3000',\n          ...extra,\n", /spread w webServer/],
    ["zmienione webServer.command", "command: isCI ? 'pnpm start' : 'pnpm dev',", "command: isCI ? 'pnpm start -p 3000' : 'pnpm dev',", /webServer\.command inne niż/],
    ["webServer.command z adresem bazy w poleceniu", "command: isCI ? 'pnpm start' : 'pnpm dev',", `command: isCI ? 'DATABASE_URL=${OTHER_DB} pnpm start' : 'pnpm dev',`, /nazwa zmiennej bazy[\s\S]*webServer\.command inne niż/],
    ["zapis do process.env w konfiguracji", "const isCI = !!process.env.CI;\n", "const isCI = !!process.env.CI;\nprocess.env.PGDATABASE = 'other_db';\n", /zapis do process\.env/],
    ["import z efektem ubocznym: dotenv/config", PW_IMPORT, `${PW_IMPORT}import 'dotenv/config';\n`, /import „dotenv\/config” spoza listy \(@playwright\/test\)/],
    ["import nazwany z dotenv i config({ override: true })", PW_IMPORT, `${PW_IMPORT}import { config } from "dotenv";\nconfig({ override: true });\n`, /import „dotenv” spoza listy/],
    ["import domyślny i przestrzeń nazw", PW_IMPORT, `${PW_IMPORT}import env from './tests/env';\nimport * as fs from 'node:fs';\n`, /import „\.\/tests\/env” spoza listy[\s\S]*import „node:fs” spoza listy/],
    ["import typu spoza listy", PW_IMPORT, `${PW_IMPORT}import type { X } from './x';\n`, /import „\.\/x” spoza listy/],
    ["require modułu", PW_IMPORT, `${PW_IMPORT}require('dotenv').config();\n`, /require\(„dotenv”\) spoza listy/],
    ["dynamiczny import modułu", PW_IMPORT, `${PW_IMPORT}void import("dotenv/config");\n`, /import\(„dotenv\/config”\) spoza listy/],
    ["require z argumentem nie-literałem", PW_IMPORT, `${PW_IMPORT}const m = 'dotenv';\nrequire(m);\n`, /require\(m\) bez literału/],
  ])("A %s → porażka", (_n, find, repl, re) => {
    expect(playwrightDbViolations(edited(PW_SRC, find, repl)).join("\n")).toMatch(re);
  });

  it("import pakietu Playwrighta w innym kształcie (wieloliniowy, cudzysłów podwójny) → bez naruszeń", () => {
    const src = edited(PW_SRC, PW_IMPORT,`import {\n  defineConfig,\n  devices,\n} from "@playwright/test";\nimport type { PlaywrightTestConfig } from '@playwright/test';\n`);
    expect(playwrightDbViolations(src)).toEqual([]);
  });

  it("drugi webServer albo webServer nie-literał → naruszenie (fail-closed)", () => {
    expect(playwrightDbViolations(`${PW}\nconst webServer: unknown = null;\n`).join()).toMatch(/dokładnie jednego „webServer:”, jest 2/);
    expect(playwrightDbViolations(PW.replace(/webServer: \{[\s\S]*?\n {8}\},/, "webServer: server,")).join()).toMatch(/nie jest literałem obiektu/);
  });
});

/** Adres INNEJ bazy do sond P0c-2, złożony z części (skaner literałów sekretów; bez hasła). */
const PROBE_DB = ["postgresql", "//probe@db.example:5432/other_db"].join(":");

describe("joby z bazą po kluczach bazy: adres i PG* także bez services: (#193 P0c-2, W-a, W-b)", () => {
  const UNIT = "    name: Unit Tests\n    runs-on: ubuntu-latest\n";
  const unitEnv = (line: string) => edited(wfSource(QG), UNIT, `${UNIT}    env:\n      ${line}\n`);
  const textLayer = (k: string, job: string) => `nowy job z bazą: dodaj go do testu i strażników: ${job} (${k} w env)`;
  const treeLayer = (k: string, job: string) => `YAML: nowy job z bazą: dodaj go do testu i strażników: ${job} (${k})`;

  it.each(DB_ENV_KEYS.map((k) => [k]))("%s w env joba bez services: (unit-tests) → job z bazą w obu warstwach (tekst i drzewo YAML)", (k) => {
    const wf = unitEnv(`${k}: ${PROBE_DB}`);
    expect(dbJobViolations(QG, wf).join("\n")).toContain(textLayer(k, "unit-tests"));
    expect(yamlViolations(QG, wf).join("\n")).toContain(treeLayer(k, "unit-tests"));
  });

  it("DATABASE_URL w env kroku joba bez services: w innym pliku workflow → job z bazą w obu warstwach", () => {
    const EP_RUN = "        run: pnpm exec playwright test --grep @production --workers=2 --retries=1 --timeout=15000\n";
    const wf = edited(wfSource("e2e-production.yml"), EP_RUN, `${EP_RUN}        env:\n          DATABASE_URL: ${PROBE_DB}\n`);
    expect(dbJobViolations("e2e-production.yml", wf).join("\n")).toContain(textLayer("DATABASE_URL", "e2e-production"));
    expect(yamlViolations("e2e-production.yml", wf).join("\n")).toContain(treeLayer("DATABASE_URL", "e2e-production"));
  });

  it("klucz małymi literami (pghost) → job z bazą w obu warstwach", () => {
    const wf = unitEnv("pghost: db.example");
    expect(dbJobViolations(QG, wf).join("\n")).toContain(textLayer("PGHOST", "unit-tests"));
    expect(yamlViolations(QG, wf).join("\n")).toContain(treeLayer("PGHOST", "unit-tests"));
  });

  it("klucz z escape w cudzysłowie (\"PG\\u0048OST\") — tekst go nie widzi, drzewo YAML łapie", () => {
    const wf = unitEnv('"PG\\u0048OST": db.example');
    expect(yamlViolations(QG, wf).join("\n")).toContain(treeLayer("PGHOST", "unit-tests"));
  });

  it("nazwa zmiennej bazy w treści polecenia joba bez services: (echo $PGHOST) → job z bazą (drzewo YAML)", () => {
    const QG_TC = "      - run: pnpm typecheck\n";
    const wf = edited(wfSource(QG), QG_TC, `${QG_TC}      - run: echo "$PGHOST"\n`);
    expect(yamlViolations(QG, wf).join("\n")).toContain(treeLayer("PGHOST", "typecheck"));
  });

  it("nazwy pochodne (INTEGRATION_POSTGRES_URL_X, PGHOST_X) to nie klucze bazy → bez naruszeń (kontrola dokładnych nazw)", () => {
    for (const k of ["INTEGRATION_POSTGRES_URL_X", "PGHOST_X", "MY_DATABASE_URL"]) {
      const wf = unitEnv(`${k}: x`);
      expect(dbJobViolations(QG, wf), k).toEqual([]);
      expect(yamlViolations(QG, wf), k).toEqual([]);
    }
  });

  it("PG* w env workflow → porażka w trzech regułach (tekst poza jobs:, drzewo YAML, jedna baza)", () => {
    const wf = edited(wfSource(QG), "\njobs:\n", "\nenv:\n  PGHOST: db.example\n\njobs:\n");
    expect(dbJobViolations(QG, wf).join("\n")).toContain("quality-gate.yml: PGHOST poza jobs: (env workflow) — zakazane");
    expect(yamlViolations(QG, wf).join("\n")).toContain("quality-gate.yml: YAML: PGHOST poza jobs: — zakazane");
    expect(oneDbScan(QG, wf).violations.join("\n")).toMatch(/^quality-gate\.yml: env workflow: PGHOST — .*zakazane bez dopuszczeń \(#193\)$/m);
  });

  /** Nowe naruszenia reguły jednej bazy ponad stan bazowy (liczony w teście). */
  const newOneDb = (find: string, repl: string) => {
    const base = oneDbScan(QG, WF).violations;
    return oneDbScan(QG, edited(wfSource(QG), find, repl)).violations.filter((v) => !base.includes(v));
  };
  const SMOKE_PW = "          PLAYWRIGHT_TIMEOUT: 15000\n";
  const PG_ENV_LINE = "          INTEGRATION_POSTGRES_URL: ";
  const FULL_ENV = "      BASE_URL: http://localhost:3000\n    steps:\n      - uses: actions/checkout@v4\n\n      - uses: pnpm/action-setup@v4\n\n      - uses: actions/setup-node@v4\n        with:\n          node-version-file: '.nvmrc'\n          cache: 'pnpm'\n\n      - run: pnpm install --frozen-lockfile\n\n      # Schemat bazy WYLACZNIE z migracji: 0005 tworzy role myhelper_app i polityki\n      # RLS, bez ktorych kazda transakcja forSalon (SET LOCAL ROLE) pada. BEZ\n      # db:push po migracjach (#190): drizzle-kit push traktuje polityki z 0005\n      # jako dryf, wylacza RLS i usuwa polityki na 39 tabelach — baza w CI\n      # bylaby bez izolacji salonow. Straznik pada, gdy ktorejs tabeli z 0005\n      # brakuje RLS albo polityki z migracji (scripts/db-rls-guard.ts).\n      - name: Run database migrations\n        run: pnpm db:migrate\n      - name: RLS guard (migration 0005)\n        run: pnpm exec tsx scripts/db-rls-guard.ts\n\n      - name: Seed test data\n";
  it.each([
    ["PGHOST w env kroku Playwrighta (e2e-smoke)", SMOKE_PW, `${SMOKE_PW}          PGHOST: db.example\n`, /^quality-gate\.yml: e2e-smoke, krok \d+ \(Run smoke tests\), env kroku: PGHOST poza jedynym dozwolonym miejscem/],
    ["PGPASSWORD w env kroku test:pg (miejsce dozwolone tylko dla INTEGRATION_POSTGRES_URL)", PG_ENV_LINE, "          PGPASSWORD: other\n          INTEGRATION_POSTGRES_URL: ", /e2e-smoke, krok \d+ \(Integration test — subscription locks \(real Postgres\)\), env kroku: PGPASSWORD poza jedynym dozwolonym miejscem/],
    ["PGDATABASE w env joba e2e-full", FULL_ENV, FULL_ENV.replace("      BASE_URL: http://localhost:3000\n", "      BASE_URL: http://localhost:3000\n      PGDATABASE: other_db\n"), /^quality-gate\.yml: e2e-full, env joba: PGDATABASE poza jedynym dozwolonym miejscem/],
  ])("jedna baza: %s → dokładnie jedno nowe naruszenie", (_n, find, repl, re) => {
    const v = newOneDb(find, repl);
    expect(v, "dokładnie jedno nowe naruszenie").toHaveLength(1);
    expect(v[0]).toMatch(re);
  });

  it("PG* przez $GITHUB_ENV: krok `echo \"PGHOST=…\" >> $GITHUB_ENV` w e2e-smoke → dokładnie jedno nowe naruszenie", () => {
    const SEED = "      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Verify seed data";
    const v = newOneDb(SEED, `      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Switch host\n        run: echo "PGHOST=db.example" >> $GITHUB_ENV\n\n      - name: Verify seed data`);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/^quality-gate\.yml: e2e-smoke, krok \d+ \(Switch host\): zapis zmiennej bazy do \$GITHUB_ENV — /);
  });

  it("reguła wzmianki po podciągu (#193): MY_PGHOST zapisany do $GITHUB_ENV → dokładnie jedno nowe naruszenie (klasyfikacja po dokładnej nazwie: test „nazwy pochodne”)", () => {
    const SEED = "      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Verify seed data";
    const v = newOneDb(SEED, `      - name: Seed test data\n        run: pnpm db:seed:test\n\n      - name: Switch host\n        run: echo "MY_PGHOST=db.example" >> $GITHUB_ENV\n\n      - name: Verify seed data`);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/^quality-gate\.yml: e2e-smoke, krok \d+ \(Switch host\): zapis zmiennej bazy do \$GITHUB_ENV — /);
  });

  const PW_NAME = `${PW_FILE}: nazwa zmiennej bazy w konfiguracji Playwrighta`;
  it.each([["PGHOST"], ["pgdatabase"], ["MY_PGHOST"]])("konfiguracja Playwrighta: %s w treści → naruszenie nazwy bazy (PG* na liście, podciąg)", (k) => {
    const src = edited(PW_SRC, "const isCI = !!process.env.CI;\n", `const isCI = !!process.env.CI;\nconst note = '${k}';\nvoid note;\n`);
    expect(playwrightDbViolations(src).join("\n")).toContain(PW_NAME);
  });

  it("konfiguracja Playwrighta: słowo pgvector to nie nazwa klucza → bez naruszeń (igły to pełne nazwy)", () => {
    const src = edited(PW_SRC, "const isCI = !!process.env.CI;\n", "const isCI = !!process.env.CI;\nconst note = 'pgvector pg18';\nvoid note;\n");
    expect(playwrightDbViolations(src)).toEqual([]);
  });

  it("hasło w treści polecenia (PGPASSWORD=… psql w kroku weryfikacji seeda) to nie klucz env → bez naruszeń jednej bazy", () => {
    expect(code(WF)).toMatch(/^ {10}PGPASSWORD=\S+ psql /m);
    expect(oneDbScan(QG, WF).violations).toEqual([]);
  });
});

describe("obraz bazy przypięty po skrócie w obu jobach z bazą (#193 P0c-2, W-c)", () => {
  const SMOKE = `    timeout-minutes: 10\n    services:\n      postgres:\n        image: ${PG_IMAGE}\n`;
  const FULL = `    timeout-minutes: 35\n    services:\n      postgres:\n        image: ${PG_IMAGE}\n`;
  const [REF, DIGEST] = PG_IMAGE.split("@sha256:") as [string, string];
  const OTHER_DIGEST = `${DIGEST.slice(0, -1)}${DIGEST.endsWith("0") ? "1" : "0"}`;

  it("dziś: oba joby z bazą na PG_IMAGE, bez container: (sonda kontrolna)", () => {
    expect(dbImageViolations(QG, WF)).toEqual([]);
    expect(WF.split(`        image: ${PG_IMAGE}\n`).length - 1).toBe(2);
  });

  it.each([
    ["(1) zmieniony tag w e2e-smoke", SMOKE, SMOKE.replace(`${REF}@`, "pgvector/pgvector:pg17@"), "e2e-smoke: services.postgres.image — inny tag: pgvector/pgvector:pg17; "],
    ["(2) zmieniony skrót w e2e-full", FULL, FULL.replace(DIGEST, OTHER_DIGEST), `e2e-full: services.postgres.image — inny skrót: ${OTHER_DIGEST}; `],
    ["(3) brak image w e2e-smoke", SMOKE, SMOKE.replace(`        image: ${PG_IMAGE}\n`, ""), "e2e-smoke: services.postgres.image — brak image; "],
    ["(4) tag bez @sha256: w e2e-full", FULL, FULL.replace(PG_IMAGE, REF), `e2e-full: services.postgres.image — tag bez skrótu @sha256: ${REF}; `],
    ["(5) container: w e2e-smoke", SMOKE, `    timeout-minutes: 10\n    container: node:22\n${SMOKE.slice("    timeout-minutes: 10\n".length)}`, "e2e-smoke: container: w jobie z bazą — zakazany; "],
    // Tag i pierwszy skrót równe wzorcowi, drugi „@sha256:” sprawia, że całość jest inna (ostatni return imageDiff).
    ["(6) drugi skrót po PG_IMAGE w e2e-full", FULL, FULL.replace(PG_IMAGE, `${PG_IMAGE}@sha256:${"ab".repeat(32)}`), `e2e-full: services.postgres.image — inna wartość: ${PG_IMAGE}@sha256:${"ab".repeat(32)}; `],
  ])("%s → dokładnie jedno naruszenie z komunikatem akceptacji", (_n, find, repl, why) => {
    const wf = edited(wfSource(QG), find, repl);
    const v = dbImageViolations(QG, wf);
    expect(v).toHaveLength(1);
    expect(v[0]).toBe(`quality-gate.yml: ${why}${IMAGE_MSG}`);
    expect(fileViolations(QG, wf, WORKFLOWS.map(([f]) => f))).toContain(v[0]);
  });

  const SVC = "    timeout-minutes: 10\n    services:\n";
  it.each([
    ["druga usługa z obrazem bazy (e2e-smoke)", SVC, `${SVC}      db2:\n        image: ${PG_IMAGE}\n`, "[db2, postgres]", 1],
    ["druga usługa z dowolnym obrazem — redis (e2e-smoke)", SVC, `${SVC}      redis:\n        image: redis:7\n`, "[redis, postgres]", 1],
    ["usługa przemianowana z postgres (e2e-smoke)", `${SVC}      postgres:\n`, `${SVC}      db:\n`, "[db]", 2],
  ])("services: %s → naruszenie z komunikatem akceptacji dodatkowej usługi", (_n, find, repl, keys, count) => {
    const wf = edited(wfSource(QG), find, repl);
    const v = dbImageViolations(QG, wf);
    expect(v).toHaveLength(count);
    expect(v).toContain(`quality-gate.yml: e2e-smoke: services: ${keys} — oczekiwana dokładnie jedna usługa „postgres”; ${SERVICES_MSG}`);
  });
});

describe("Playwright: parser TypeScript — importy, dotenv, loadEnvFile, process.env, globalSetup/Teardown (#193 P0c-2)", () => {
  it("dzisiejsze pliki: cały zestaw bez naruszeń (sonda kontrolna)", () => {
    expect(pwSetViolations()).toEqual([]);
  });

  it.each(PW_SCAN.map((e): [string, ScanEntry] => [`${e.src.id} [${e.role}]`, e]))(
    "%s: importy z zamkniętej listy, bez dotenv i loadEnvFile, process.env tylko do odczytu",
    (_n, e) => {
      expect(pwFileViolations(e)).toEqual([]);
    },
  );

  it("ścieżki globalSetup/globalTeardown w konfiguracji dosłownie jak dziś; CleanupEnv tylko do odczytu", () => {
    expect(pwGlobalPathViolations(PW)).toEqual([]);
    expect(cleanupEnvViolations()).toEqual([]);
  });

  const CFG = "const isCI = !!process.env.CI;\n";
  const SETUP = "import * as path from 'path';";
  const TD = "  const projectDir = config.configFile ? path.dirname(config.configFile) : process.cwd();\n";
  const TD_IMP = "import * as path from 'path';\n";
  const CL = 'import { parseEnv } from "util";';
  const CL_ENV = "export type CleanupEnv = { readonly [key: string]: string | undefined };";
  const GS = "  globalSetup: './tests/global-setup.ts',";
  const GT = "  globalTeardown: './tests/global-teardown.ts',";
  const S1 = "tests/global-setup.ts [globalSetup]";
  const S2 = "tests/global-setup.ts [import globalTeardown]";
  const T = "tests/global-teardown.ts [globalTeardown]";
  const C = "tests/e2e-cleanup.ts [import globalTeardown]";
  const P = "playwright.config.ts";
  const W = "zapis do process.env — ";
  const td = (stmt: string): [Source, string, string] => [TEARDOWN_SRC, TD, `${TD}  ${stmt}\n`];

  it.each<[string, [Source, string, string], string[]]>([
    // (a) re-eksport = import
    ["(a) export {} from 'dotenv/config' w konfiguracji", [PW_SRC, CFG, `${CFG}export {} from 'dotenv/config';\n`], [`${P}: export … from „dotenv/config” spoza listy (@playwright/test)`, `${P}: moduł „dotenv/config” z rodziny dotenv`]],
    ["(a) export * from 'dotenv' w konfiguracji", [PW_SRC, CFG, `${CFG}export * from 'dotenv';\n`], [`${P}: export … from „dotenv” spoza listy`]],
    ["(a) export { x } from './x' w konfiguracji", [PW_SRC, CFG, `${CFG}export { x } from './x';\n`], [`${P}: export … from „./x” spoza listy`]],
    // (b) loadEnvFile
    ["(b) process.loadEnvFile() w konfiguracji", [PW_SRC, CFG, `${CFG}process.loadEnvFile('.env.other');\n`], [`${P}: process.loadEnvFile — zakazane`]],
    ["(b) process.loadEnvFile jako wartość w konfiguracji", [PW_SRC, CFG, `${CFG}const load = process.loadEnvFile;\nload('.env.other');\n`], [`${P}: process.loadEnvFile — zakazane`]],
    ["require jako wartość w konfiguracji", [PW_SRC, CFG, `${CFG}const r = require;\nr('dotenv');\n`], [`${P}: require jako wartość`]],
    // (c) ścieżki globalSetup / globalTeardown
    ["(c) globalSetup jako tablica", [PW_SRC, GS, "  globalSetup: ['./tests/global-setup.ts'],"], [`${P}: globalSetup — oczekiwany dokładnie jeden literał „./tests/global-setup.ts”: wartość nie jest literałem`]],
    ["(c) globalSetup jako wyrażenie", [PW_SRC, GS, "  globalSetup: isCI ? './tests/global-setup.ts' : './tests/global-setup.ts',"], [`${P}: globalSetup — oczekiwany dokładnie jeden literał „./tests/global-setup.ts”: wartość nie jest literałem`]],
    ["(c) globalSetup z inną ścieżką", [PW_SRC, GS, "  globalSetup: './tests/other-setup.ts',"], [`${P}: globalSetup — oczekiwany dokładnie jeden literał „./tests/global-setup.ts”: inna ścieżka: ./tests/other-setup.ts`]],
    ["(c) globalSetup ze stałej (skrót)", [PW_SRC, CFG, `${CFG}const globalSetup = './tests/global-setup.ts';\nvoid globalSetup;\n`], [`${P}: globalSetup — oczekiwany dokładnie jeden literał „./tests/global-setup.ts”: wystąpień nazwy 3`]],
    ["(c) globalTeardown jako tablica", [PW_SRC, GT, "  globalTeardown: ['./tests/global-teardown.ts'],"], [`${P}: globalTeardown — oczekiwany dokładnie jeden literał „./tests/global-teardown.ts”: wartość nie jest literałem`]],
    ["(c) globalTeardown jako wyrażenie", [PW_SRC, GT, "  globalTeardown: `./tests/${'global-teardown'}.ts`,"], [`${P}: globalTeardown — oczekiwany dokładnie jeden literał „./tests/global-teardown.ts”: wartość nie jest literałem`]],
    ["(c) globalTeardown z inną ścieżką", [PW_SRC, GT, "  globalTeardown: './tests/other-teardown.ts',"], [`${P}: globalTeardown — oczekiwany dokładnie jeden literał „./tests/global-teardown.ts”: inna ścieżka: ./tests/other-teardown.ts`]],
    // (c) dodatkowy import w każdym pliku
    ["(c) dodatkowy import w global-setup.ts", [SETUP_SRC, SETUP, `${SETUP} import * as os from 'os';`], [`${S1}: import „os” spoza listy (fs, path, @playwright/test)`, `${S2}: import „os” spoza listy (fs, path, @playwright/test)`]],
    ["(c) dodatkowy import w global-teardown.ts", [TEARDOWN_SRC, TD_IMP, `${TD_IMP}import * as os from 'os';\n`], [`${T}: import „os” spoza listy (path, ./e2e-cleanup, ./global-setup, @playwright/test)`]],
    ["(c) dodatkowy import w e2e-cleanup.ts", [CLEANUP_SRC, CL, `${CL}\nimport * as os from "os";`], [`${C}: import „os” spoza listy (fs, util, postgres, ../scripts/seed-host-guard)`]],
    // (c) zapis do process.env w każdym pliku (global-setup także jako import teardownu)
    ["(c) zapis do process.env w konfiguracji", [PW_SRC, CFG, `${CFG}process.env.POSTGRES_URL = 'x';\n`], [`${P}: ${W}przypisanie do składowej`]],
    ["(c) zapis do process.env w global-setup.ts (globalSetup i import teardownu)", [SETUP_SRC, SETUP, `${SETUP} process.env.POSTGRES_URL = 'x';`], [`${S1}: ${W}przypisanie do składowej`, `${S2}: ${W}przypisanie do składowej`]],
    ["(c) zapis do process.env w global-teardown.ts", td("process.env.POSTGRES_URL = 'x';"), [`${T}: ${W}przypisanie do składowej`]],
    ["(c) zapis do process.env w e2e-cleanup.ts", [CLEANUP_SRC, CL, `${CL}\nprocess.env.POSTGRES_URL = "x";`], [`${C}: ${W}przypisanie do składowej`]],
    // (c) dotenv w każdym pliku; rodzina dotenv
    ["(c) dotenv/config w global-setup.ts", [SETUP_SRC, SETUP, `${SETUP} import 'dotenv/config';`], [`${S1}: moduł „dotenv/config” z rodziny dotenv`, `${S2}: moduł „dotenv/config” z rodziny dotenv`, `${S1}: import „dotenv/config” spoza listy`]],
    ["(c) dotenv w global-teardown.ts", [TEARDOWN_SRC, TD_IMP, `${TD_IMP}import { config } from 'dotenv';\n`], [`${T}: moduł „dotenv” z rodziny dotenv`]],
    ["(c) dotenv-expand w e2e-cleanup.ts", [CLEANUP_SRC, CL, `${CL}\nimport "dotenv-expand";`], [`${C}: moduł „dotenv-expand” z rodziny dotenv`]],
    ["@dotenvx/dotenvx przez require w global-teardown.ts", td("const dx = require('@dotenvx/dotenvx');"), [`${T}: moduł „@dotenvx/dotenvx” z rodziny dotenv`, `${T}: require(„@dotenvx/dotenvx”) spoza listy`]],
    // (c) loadEnvFile w każdym pliku
    ["(c) process.loadEnvFile w global-setup.ts", [SETUP_SRC, SETUP, `${SETUP} process.loadEnvFile();`], [`${S1}: process.loadEnvFile — zakazane`, `${S2}: process.loadEnvFile — zakazane`]],
    ["(c) process.loadEnvFile w global-teardown.ts", td("process.loadEnvFile('.env.local');"), [`${T}: process.loadEnvFile — zakazane`]],
    ["(c) process.loadEnvFile w e2e-cleanup.ts", [CLEANUP_SRC, CL, `${CL}\nprocess.loadEnvFile(".env.local");`], [`${C}: process.loadEnvFile — zakazane`]],
    // process.env: każda forma poza odczytem i argumentem funkcji lokalnej (fail-closed)
    ["process.env: przypisanie przez klucz literał", td("process.env['POSTGRES_URL'] = 'x';"), [`${T}: ${W}przypisanie do składowej`]],
    ["process.env: delete", td("delete process.env.POSTGRES_URL;"), [`${T}: ${W}delete`]],
    ["process.env: przypisanie całego obiektu", td("process.env = {};"), [`${T}: ${W}przypisanie całego process.env`]],
    ["process.env: Object.assign", td("Object.assign(process.env, { POSTGRES_URL: 'x' });"), [`${T}: ${W}argument wywołania Object.assign(…)`]],
    ["process.env: Object.defineProperty", td("Object.defineProperty(process.env, 'POSTGRES_URL', { value: 'x' });"), [`${T}: ${W}argument wywołania Object.defineProperty(…)`]],
    ["process.env: Reflect.set", td("Reflect.set(process.env, 'POSTGRES_URL', 'x');"), [`${T}: ${W}argument wywołania Reflect.set(…)`]],
    ["process.env: Reflect.deleteProperty", td("Reflect.deleteProperty(process.env, 'POSTGRES_URL');"), [`${T}: ${W}argument wywołania Reflect.deleteProperty(…)`]],
    ["process.env: alias const e = process.env", td("const e = process.env;\n  e.POSTGRES_URL = 'x';"), [`${T}: ${W}process.env jako wartość (alias)`]],
    ["process: destrukturyzacja const { env } = process", td("const { env } = process;\n  env.POSTGRES_URL = 'x';"), [`${T}: process jako wartość`]],
    ["process: alias const p = process", td("const p = process;\n  p.env.POSTGRES_URL = 'x';"), [`${T}: process jako wartość`]],
    ["process.env: ++", td("process.env.N++;"), [`${T}: ${W}++/--`]],
    ["process.env: -- (przedrostek)", td("--process.env.N;"), [`${T}: ${W}++/--`]],
    ["process.env: przypisanie złożone +=", td("process.env.POSTGRES_URL += 'x';"), [`${T}: ${W}przypisanie złożone`]],
    ["process.env: przypisanie złożone ??=", td("process.env.POSTGRES_URL ??= 'x';"), [`${T}: ${W}przypisanie złożone`]],
    ["process.env: przez globalThis.process", td("globalThis.process.env.POSTGRES_URL = 'x';"), [`${T}: ${W}przypisanie do składowej`]],
    ["process.env: destrukturyzacja jako cel przypisania", td("[process.env.POSTGRES_URL] = ['x'];"), [`${T}: ${W}przypisanie przez destrukturyzację`]],
    ["process.env: klucz nie-literał", td("const key = 'POSTGRES_URL';\n  process.env[key] = 'x';"), [`${T}: ${W}klucz nie-literał`]],
    ["process.env: argument funkcji spoza lokalnych (alias Reflect.set)", td("const set = Reflect.set;\n  set(process.env, 'POSTGRES_URL', 'x');"), [`${T}: ${W}argument wywołania set(…)`]],
    // process.env jako argument: tylko funkcja lokalna z parametrem typu CleanupEnv
    ["parametr resolveCleanupUrl (poz. 0) typu NodeJS.ProcessEnv", [CLEANUP_SRC, "export function resolveCleanupUrl(env: CleanupEnv,", "export function resolveCleanupUrl(env: NodeJS.ProcessEnv,"], [`${T}: ${W}argument wywołania resolveCleanupUrl(…) — parametr musi mieć typ CleanupEnv: parametr 0 funkcji resolveCleanupUrl ma typ NodeJS.ProcessEnv zamiast CleanupEnv`]],
    ["parametr guardedCleanupClient (poz. 1) typu NodeJS.ProcessEnv", [CLEANUP_SRC, "url: string | undefined, env: CleanupEnv)", "url: string | undefined, env: NodeJS.ProcessEnv)"], [`${T}: ${W}argument wywołania guardedCleanupClient(…) — parametr musi mieć typ CleanupEnv: parametr 1 funkcji guardedCleanupClient ma typ NodeJS.ProcessEnv zamiast CleanupEnv`]],
    ["funkcja z pliku z parametrem NodeJS.ProcessEnv", [TEARDOWN_SRC, TD_IMP, `${TD_IMP}function leak(e: NodeJS.ProcessEnv) { return e; }\nvoid leak(process.env);\n`], [`${T}: ${W}argument wywołania leak(…) — parametr musi mieć typ CleanupEnv: parametr 0 funkcji leak ma typ NodeJS.ProcessEnv zamiast CleanupEnv`]],
    ["alias funkcji lokalnej (const f = resolveCleanupUrl)", td("const f = resolveCleanupUrl;\n  void f(process.env, '.env.test');"), [`${T}: ${W}argument wywołania f(…) — dozwolone tylko funkcje lokalne`]],
    // CleanupEnv tylko do odczytu
    ["CleanupEnv z sygnaturą indeksu bez readonly", [CLEANUP_SRC, CL_ENV, "export type CleanupEnv = { [key: string]: string | undefined };"], ["tests/e2e-cleanup.ts: CleanupEnv nie jest tylko do odczytu — składowe bez readonly"]],
    ["CleanupEnv z dodatkową właściwością bez readonly", [CLEANUP_SRC, CL_ENV, "export type CleanupEnv = { readonly [key: string]: string | undefined; POSTGRES_URL?: string };"], ["tests/e2e-cleanup.ts: CleanupEnv nie jest tylko do odczytu — składowe bez readonly: POSTGRES_URL?: string"]],
    ["CleanupEnv jako NodeJS.ProcessEnv", [CLEANUP_SRC, CL_ENV, "export type CleanupEnv = NodeJS.ProcessEnv;"], ["tests/e2e-cleanup.ts: CleanupEnv nie jest tylko do odczytu — oczekiwany literał typu z polami readonly"]],
  ])("%s → naruszenie z oczekiwanym powodem", (_n, [src, find, repl], expected) => {
    const out = pwSetViolations(src.id, edited(src, find, repl)).join("\n");
    for (const s of expected) expect(out).toContain(s);
  });

  it.each<[string, [Source, string, string]]>([
    ["odczyt process.env.X i process.env['X']", td("const u = process.env.POSTGRES_URL ?? process.env['CI'];\n  void u;")],
    ["process.env jako argument funkcji z modułu lokalnego", td("void resolveCleanupUrl(process.env, '.env.test');")],
    ["słowa import/require/process.env w komentarzu i napisie", [PW_SRC, CFG, `${CFG}// import 'dotenv/config'; process.env.X = '1'; require('dotenv'); process.loadEnvFile()\nconst note = "import 'dotenv/config'; process.env.X = '1'; export * from 'dotenv'";\nvoid note;\n`]],
    ["import typu z modułu z listy", [SETUP_SRC, SETUP, `${SETUP} import type { Page } from '@playwright/test';`]],
  ])("poprawna edycja: %s → bez naruszeń (kontrola fałszywej czerwieni)", (_n, [src, find, repl]) => {
    expect(pwSetViolations(src.id, edited(src, find, repl))).toEqual([]);
  });
});
