// @vitest-environment node
/**
 * #193 P0a: reguła izolacji danych salonu w PRAWDZIWEJ konfiguracji repo.
 *
 * - Z2: każda forma importu surowego `db` (alias, względny, `import *`,
 *   `import()`, `require()`, re-eksport) i puli systemowej poza
 *   `server/system/**` daje błąd; plik z listy przejściowej nie (kontrola
 *   fałszywej czerwieni).
 * - pkt 7 (N1): poziom reguł czytany z konfiguracji WYNIKOWEJ
 *   (`calculateConfigForFile`), nie z tekstu pliku.
 * - Z4: lista przejściowa ⊆ BASELINE; każda pozycja istnieje i nadal importuje `db`.
 * - Z5 + W1: w `src/**` żadnego obejścia reguł izolacji komentarzem.
 */
import fs from "node:fs";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import config, { D1_SELECTORS, ISOLATION_BLOCK_SELECTORS } from "../../eslint.config.mjs";
import {
  DB_CLIENT_ALLOWED_FILES,
  DB_CLIENT_IMPORT_SOURCE_REGEX,
  TEST_FILE_IMPORT_SOURCE_REGEX,
  DB_IMPORT_SOURCE_REGEX,
  DB_ISOLATION_FILES,
  DB_ISOLATION_PARTITIONS,
  DB_ISOLATION_PERMANENT,
  DB_ISOLATION_RULES,
  DB_ISOLATION_TEST_FILES,
  DB_ISOLATION_TRANSITIONAL,
  DB_SYSTEM_ALLOWED_FILES,
  DB_SYSTEM_IMPORT_SOURCE_REGEX,
  dbIsolationConfig,
} from "../../eslint.db-isolation.mjs";

const ROOT = path.resolve(__dirname, "../..");
const NEW_ROUTE = "src/app/api/__p0a-probe__/route.ts";
const NEW_LIB = "src/lib/__p0a-probe__.ts";
const SYSTEM_FILE = "src/lib/server/system/__p0a-probe__.ts";
/**
 * Pliki z listy przejściowej wyprowadzane z konfiguracji, nie wpisane ręcznie:
 * partie #193 zdejmują pozycje z listy, a stała wpisana na sztywno po cichu
 * przestałaby oznaczać „plik z listy”. Asercje przy definicji (bez nowych
 * przypadków testowych): pozycja istnieje na dysku i należy do listy.
 * P6 (lista pusta): LISTED_ROUTE → DB_ISOLATION_PERMANENT[0], a przypadki
 * LISTED_ROUTE_WITH_ID zastępuje test literalGlob na ścieżce z [id].
 */
function listedFile(label: string, pick: (f: string) => boolean, kind: string): string {
  const list = DB_ISOLATION_TRANSITIONAL as readonly string[];
  if (list.length === 0) {
    throw new Error(
      `${label}: lista przejściowa pusta (P6: LISTED_ROUTE → DB_ISOLATION_PERMANENT[0], ` +
        "przypadki z [id] → test literalGlob, lista kontrolna P6 pkt 11)",
    );
  }
  const file = list.find(pick);
  if (file === undefined) throw new Error(`${label}: na DB_ISOLATION_TRANSITIONAL brak pozycji ${kind}`);
  if (!list.includes(file)) throw new Error(`${label}: ${file} nie należy do DB_ISOLATION_TRANSITIONAL`);
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`${label}: ${file} nie istnieje na dysku`);
  return file;
}
const LISTED_ROUTE = listedFile("LISTED_ROUTE", (f) => !f.includes("["), "bez „[”");
const LISTED_ROUTE_WITH_ID = listedFile("LISTED_ROUTE_WITH_ID", (f) => f.includes("["), "z „[”");

/**
 * Zamrożony stan długu z wyniku reguły bez listy (Z3, 73 pliki na b3a5faf),
 * per partia. Partia #193 usuwa swoje pliki ze SWOJEJ tablicy w
 * eslint.db-isolation.mjs I stąd w tym samym PR. Dopisanie pozycji albo
 * przeniesienie pliku do innej tablicy bez zmiany tutaj = czerwony test;
 * przeniesienie między partiami = decyzja CTO, osobny commit.
 */
const BASELINE: Record<string, readonly string[]> = {
  // P0b (#193): wszystkie 7 pozycji zdjęte — zapytania w src/lib/server/system/**.
  P0_FILES: [],
  P1_FILES: [
    "src/app/api/deposits/create-session/route.ts",
    "src/app/api/stripe/webhook/route.ts",
    "src/lib/deposit-confirmation.ts",
    "src/lib/refund.ts",
    "src/lib/subscription-confirmation.ts",
    "src/lib/subscription-locks.ts",
  ],
  P2_FILES: [
    "src/app/api/ai/content/newsletter/route.ts",
    "src/app/api/appointments/[id]/complete/route.ts",
    "src/app/api/appointments/[id]/invoice/route.ts",
    "src/app/api/appointments/[id]/route.ts",
    "src/app/api/clients/[id]/loyalty/redeem/route.ts",
    "src/app/api/clients/[id]/route.ts",
    "src/app/api/dashboard/stats/route.ts",
    "src/app/api/employees/[id]/link-account/route.ts",
    "src/app/api/temporary-access/route.ts",
    "src/lib/ai/business/chat.ts",
    "src/lib/ai/openrouter.ts",
    "src/lib/ai/usage-limits.ts",
  ],
  P3_FILES: [
    "src/app/api/promotions/check-happy-hours/route.ts",
    "src/app/api/promotions/check-package/route.ts",
    "src/app/api/promotions/check/route.ts",
    "src/app/api/salons/[id]/gallery/route.ts",
    "src/app/api/salons/route.ts",
  ],
  P4_FILES: [
    "src/app/api/client/appointments/[id]/cancel/route.ts",
    "src/app/api/client/appointments/[id]/review/route.ts",
    "src/app/api/client/appointments/[id]/route.ts",
    "src/app/api/client/appointments/route.ts",
    "src/app/api/client/reviews/route.ts",
    "src/app/api/client/waiting-list/[id]/route.ts",
    "src/app/api/client/waiting-list/route.ts",
    "src/app/api/favorites/salons/check/route.ts",
    "src/app/api/favorites/salons/route.ts",
    "src/app/api/push/subscribe/route.ts",
    "src/app/api/push/unsubscribe/route.ts",
    "src/app/api/salons/mine/route.ts",
  ],
  P5_FILES: [
    "src/app/api/register-subscription/route.ts",
  ],
  P6_FILES: [],
};

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.config.mjs") });
}, 60_000);

async function isolationErrors(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return (result?.messages ?? []).filter(
    (m) => m.severity === 2 && DB_ISOLATION_RULES.includes(m.ruleId ?? "") && /#193/.test(m.message)
  );
}

/** Formy importu `db` bez wystawiania go dalej (dozwolone w pliku z listy). */
const DB_IMPORT_FORMS: [string, string][] = [
  ["alias", 'import { db } from "@/lib/db";\nexport const x = db.select;'],
  ["względny", 'import { db } from "../../../lib/db";\nexport const x = db.select;'],
  ["względny z rozszerzeniem", 'import { db } from "../../../lib/db.ts";\nexport const x = db.select;'],
  ["import *", 'import * as d from "@/lib/db";\nexport const x = d;'],
  ["import()", 'export async function f() { return (await import("@/lib/db")).db; }'],
  ["import() z szablonem", "export async function f() { return (await import(`@/lib/db`)).db; }"],
  ["require()", 'export const x = require("@/lib/db").db;'],
  // pkt 5: TS `import x = require()` — łapie ją sama no-restricted-imports (osobny test niżej).
  ["import x = require()",'import d = require("@/lib/db");\nexport const x = d;'],
];

const DB_FORMS: [string, string][] = [
  ...DB_IMPORT_FORMS,
  ["re-eksport", 'export { db } from "@/lib/db";'],
  ["re-eksport *", 'export * from "../../../lib/db";'],
];

const DB_SYSTEM_FORMS: [string, string][] = [
  ["alias", 'import { dbSystem } from "@/lib/server/system/db-system";\nexport const x = dbSystem;'],
  ["względny", 'import { dbSystem } from "../server/system/db-system";\nexport const x = dbSystem;'],
  ["import()", 'export async function f() { return import("@/lib/server/system/db-system"); }'],
  ["require()", 'export const x = require("./server/system/db-system");'],
  ["re-eksport", 'export { dbSystem } from "@/lib/server/system/db-system";'],
  ["import x = require()", 'import s = require("@/lib/server/system/db-system");\nexport const x = s;'],
];

/** Wymaganie (1): własny klient puli (sterownik + adapter drizzle). */
const CLIENT_FORMS: [string, string][] = [
  ["postgres", 'import postgres from "postgres";\nexport const c = postgres;'],
  ["drizzle-orm/postgres-js", 'import { drizzle } from "drizzle-orm/postgres-js";\nexport const d = drizzle;'],
  ["drizzle-orm/postgres-js/migrator", 'import { migrate } from "drizzle-orm/postgres-js/migrator";\nexport const m = migrate;'],
  ["pg", 'import { Pool } from "pg";\nexport const P = Pool;'],
  ["drizzle-orm/node-postgres", 'import { drizzle } from "drizzle-orm/node-postgres";\nexport const d = drizzle;'],
  ["drizzle-orm/neon-http", 'import { drizzle } from "drizzle-orm/neon-http";\nexport const d = drizzle;'],
  ["@neondatabase/serverless", 'import { neon } from "@neondatabase/serverless";\nexport const n = neon;'],
  ["import(postgres)", 'export async function f() { return import("postgres"); }'],
  ["require(pg)", 'export const x = require("pg");'],
  ["import x = require(postgres)", 'import p = require("postgres");\nexport const x = p;'],
  ["re-eksport", 'export { drizzle } from "drizzle-orm/postgres-js";'],
];

describe("pkt 5: TS `import x = require()` łapie sama no-restricted-imports", () => {
  it.each([
    ["db", 'import d = require("@/lib/db");\nexport const x = d;'],
    ["db-system", 'import s = require("@/lib/server/system/db-system");\nexport const x = s;'],
    ["klient puli", 'import p = require("postgres");\nexport const x = p;'],
    ["plik testowy", 'import t = require("./__p0a-helper__.test");\nexport const x = t;'],
  ])("%s → dokładnie 1 błąd, z reguły no-restricted-imports (bez osobnego selektora)", async (_n, code) => {
    const errors = await isolationErrors(code, NEW_ROUTE);
    expect(errors.map((m) => m.ruleId)).toEqual(["no-restricted-imports"]);
  }, 30_000);
});

describe("Z2: każda forma importu puli daje błąd poza listą", () => {
  it.each(DB_FORMS)("db, %s — nowa trasa → błąd", async (_n, code) => {
    expect(await isolationErrors(code, NEW_ROUTE)).toHaveLength(1);
  }, 30_000);

  it.each(DB_FORMS)("db, %s — nowy plik src/lib → błąd", async (_n, code) => {
    expect(await isolationErrors(code, NEW_LIB)).toHaveLength(1);
  }, 30_000);

  it.each(DB_FORMS)("db, %s — src/lib/server/system/** → błąd (system nie bierze surowego db)", async (_n, code) => {
    expect(await isolationErrors(code, SYSTEM_FILE)).toHaveLength(1);
  }, 30_000);

  it.each(DB_SYSTEM_FORMS)("db-system, %s — poza system/** → błąd", async (_n, code) => {
    expect(await isolationErrors(code, NEW_LIB)).toHaveLength(1);
    expect(await isolationErrors(code, NEW_ROUTE)).toHaveLength(1);
  }, 30_000);

  it.each(DB_SYSTEM_FORMS)("db-system, %s — plik z listy przejściowej → nadal błąd", async (_n, code) => {
    expect(await isolationErrors(code, LISTED_ROUTE)).toHaveLength(1);
  }, 30_000);

  it("db-system wewnątrz system/** → bez błędu", async () => {
    const code = 'import { dbSystem } from "./db-system";\nexport const x = dbSystem;';
    expect(await isolationErrors(code, SYSTEM_FILE)).toHaveLength(0);
  }, 30_000);

  // Kontrola fałszywej czerwieni (szósty przypadek z przeglądu).
  it.each([
    ["plik z listy przejściowej", LISTED_ROUTE],
    ["plik z listy z [id] w ścieżce", LISTED_ROUTE_WITH_ID],
    ["wyjątek stały (repository)", "src/lib/server/repository.ts"],
  ])("%s: import db (bez wystawiania dalej) → bez błędu izolacji", async (_n, file) => {
    for (const [, code] of DB_IMPORT_FORMS) {
      expect(await isolationErrors(code, file), code).toHaveLength(0);
    }
  }, 60_000);

  it("test w src/: każda forma importu db, db-system i klienta puli → bez błędu izolacji", async () => {
    for (const [, code] of [...DB_IMPORT_FORMS, ...DB_SYSTEM_FORMS, ...CLIENT_FORMS]) {
      expect(await isolationErrors(code, "src/lib/__p0a-probe__.test.ts"), code).toHaveLength(0);
    }
  }, 60_000);

  it.each([
    ['import { forSalon } from "@/lib/server/repository";\nexport const x = forSalon;'],
    ['import x from "./dbx";\nexport default x;'],
    ['import { schema } from "@/lib/db-schema";\nexport const y = schema;'],
    ['import { sql } from "drizzle-orm";\nexport const y = sql;'],
    ['import { pgTable } from "drizzle-orm/pg-core";\nexport const y = pgTable;'],
    ['import x from "postgres-array";\nexport default x;'],
    ['import x from "./pg";\nexport default x;'],
  ])("inne importy → bez błędu: %s", async (code) => {
    expect(await isolationErrors(code, NEW_ROUTE)).toHaveLength(0);
  }, 30_000);
});

describe("wymaganie (1): własny klient puli tylko w src/lib/db.ts i system/db-system.ts", () => {
  it.each(CLIENT_FORMS)("%s — nowa trasa, nowy plik src/lib, system/**, plik z listy → błąd", async (_n, code) => {
    for (const file of [NEW_ROUTE, NEW_LIB, SYSTEM_FILE, LISTED_ROUTE, "src/lib/server/repository.ts"]) {
      expect(await isolationErrors(code, file), file).toHaveLength(1);
    }
  }, 60_000);

  it.each(DB_CLIENT_ALLOWED_FILES.map((f: string) => [f]))("%s: klient puli → bez błędu (kontrola fałszywej czerwieni)", async (file) => {
    for (const [, code] of CLIENT_FORMS) {
      expect(await isolationErrors(code, file), code).toHaveLength(0);
    }
  }, 60_000);

  it("src/lib/db.ts w obecnej treści → bez błędu izolacji; db nadal zakazane w nim jak w src/", async () => {
    expect(await isolationErrors(fs.readFileSync(path.join(ROOT, "src/lib/db.ts"), "utf8"), "src/lib/db.ts")).toHaveLength(0);
    expect(await isolationErrors(DB_FORMS[0]![1], "src/lib/db.ts")).toHaveLength(1);
    expect(await isolationErrors(DB_SYSTEM_FORMS[0]![1], "src/lib/db.ts")).toHaveLength(1);
    expect(await isolationErrors(DB_SYSTEM_FORMS[0]![1], "src/lib/server/system/db-system.ts")).toHaveLength(0);
  }, 30_000);

  // P0b (decyzja z 16.11): do P6 `dbSystem` to re-eksport `db`, więc wyjątek `db`
  // ma wyłącznie dosłowny plik db-system.ts. Reszta system/** — nadal zakaz.
  it("P0b: import db w system/db-system.ts → bez błędu; w każdym innym pliku system/** → błąd", async () => {
    const reexport = 'import { db } from "@/lib/db";\nexport const dbSystem: typeof db = db;';
    expect(await isolationErrors(reexport, "src/lib/server/system/db-system.ts")).toHaveLength(0);
    for (const file of [SYSTEM_FILE, "src/lib/server/system/session.ts", "src/lib/server/system/auth-adapter.ts", "src/lib/server/system/sub/db-system.ts"]) {
      for (const [, code] of DB_IMPORT_FORMS) expect(await isolationErrors(code, file), `${file}: ${code}`).toHaveLength(1);
    }
  }, 60_000);

  it("żaden plik w src/ poza dozwolonymi (i testami) nie importuje klienta puli", () => {
    const re = new RegExp(DB_CLIENT_IMPORT_SOURCE_REGEX);
    const allowed = new Set<string>(DB_CLIENT_ALLOWED_FILES);
    const hits = walk(path.join(ROOT, "src"))
      .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
      .filter((rel) => !allowed.has(rel) && !/\.(test|spec)\.tsx?$/.test(rel))
      .filter((rel) => importSources(fs.readFileSync(path.join(ROOT, rel), "utf8")).some((s) => re.test(s)));
    expect(hits).toEqual([]);
  });
});

describe("wymaganie (2): plik z wyjątkiem dla db nie wystawia wartości db", () => {
  const IMPORT = 'import { db } from "@/lib/db";\n';
  it.each([
    ["re-eksport nazwany", 'export { db } from "@/lib/db";'],
    ["re-eksport pod inną nazwą", 'export { db as pool } from "../../../lib/db";'],
    ["re-eksport *", 'export * from "@/lib/db";'],
    ["export { db }", `${IMPORT}export { db };`],
    ["export { db as pool }", `${IMPORT}export { db as pool };`],
    ["export const pool = db", `${IMPORT}export const pool = db;`],
    ["export default db", `${IMPORT}export default db;`],
  ])("%s → błąd w pliku z listy, w wyjątku stałym i w teście w src/", async (_n, code) => {
    for (const file of [LISTED_ROUTE, LISTED_ROUTE_WITH_ID, "src/lib/server/repository.ts", "src/lib/__p0a-probe__.test.ts", "src/app/__p0a-probe__.spec.tsx"]) {
      expect((await isolationErrors(code, file)).length, file).toBeGreaterThan(0);
    }
  }, 60_000);

  it.each([
    ["export type = typeof db", `${IMPORT}export type Tx = typeof db;`],
    ["export type { … } from db", 'export type { Db } from "@/lib/db";'],
    ["export { type db }", `import { type db } from "@/lib/db";\nexport { type db };`],
    ["eksport innej wartości", `${IMPORT}export const rows = () => db.select;`],
  ])("%s → bez błędu (eksport typu albo nie-db)", async (_n, code) => {
    expect(await isolationErrors(code, LISTED_ROUTE)).toHaveLength(0);
  }, 30_000);

  it("pliki z list (prawdziwa treść) → 0 błędów izolacji", async () => {
    // lintText, nie lintFiles: ścieżki z `[id]` lintFiles potraktowałby jak glob.
    const bad: string[] = [];
    for (const file of [...DB_ISOLATION_TRANSITIONAL, ...DB_ISOLATION_PERMANENT, ...DB_CLIENT_ALLOWED_FILES]) {
      const p = path.join(ROOT, file);
      if (!fs.existsSync(p)) continue; // system/db-system.ts powstaje w P0b
      for (const m of await isolationErrors(fs.readFileSync(p, "utf8"), file)) bad.push(`${file}:${m.line} ${m.message.slice(0, 60)}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

describe("kod produkcyjny nie importuje plików testowych z src/", () => {
  const TEST_IMPORTS: [string, string][] = [
    ["import z .test", 'import { h } from "./__p0a-helper__.test";\nexport const x = h;'],
    ["import z .spec.tsx", 'import { h } from "@/app/__p0a-helper__.spec.tsx";\nexport const x = h;'],
    ["re-eksport z .test", 'export * from "../lib/__p0a-helper__.test";'],
    ["import()", 'export async function f() { return import("./__p0a-helper__.test"); }'],
    ["require()", 'export const x = require("./__p0a-helper__.spec");'],
    ["import x = require()", 'import t = require("./__p0a-helper__.test");\nexport const x = t;'],
  ];

  it.each(TEST_IMPORTS)("%s — nowa trasa, src/lib, system/**, plik z listy, db.ts → błąd", async (_n, code) => {
    for (const file of [NEW_ROUTE, NEW_LIB, SYSTEM_FILE, LISTED_ROUTE, "src/lib/db.ts"]) {
      expect(await isolationErrors(code, file), file).toHaveLength(1);
    }
  }, 60_000);

  it.each([
    ["test importuje test", 'import { h } from "./__p0a-helper__.test";\nexport const x = h;', "src/lib/__p0a-probe__.test.ts"],
    ["test-utils (nie plik testowy)", 'import { h } from "./test-utils";\nexport const x = h;', NEW_LIB],
    ["latest/contest (nie plik testowy)", 'import { a } from "./latest";\nimport { b } from "./contest";\nexport const x = [a, b];', NEW_LIB],
    ["testing-library", 'import { render } from "@testing-library/react";\nexport const x = render;', NEW_LIB],
  ])("%s → bez błędu", async (_n, code, file) => {
    expect(await isolationErrors(code, file)).toHaveLength(0);
  }, 30_000);

  it("żaden plik produkcyjny w src/ nie importuje pliku testowego", () => {
    const re = new RegExp(TEST_FILE_IMPORT_SOURCE_REGEX);
    const hits = walk(path.join(ROOT, "src"))
      .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
      .filter((rel) => !/\.(test|spec)\.tsx?$/.test(rel))
      .filter((rel) => importSources(fs.readFileSync(path.join(ROOT, rel), "utf8")).some((s) => re.test(s)));
    expect(hits).toEqual([]);
  });
});

describe("pkt 7 (N1): poziom reguł z konfiguracji wynikowej", () => {
  type RuleEntry = Linter.RuleEntry | undefined;
  const level = (e: RuleEntry) => (Array.isArray(e) ? e[0] : e);
  const regexes = (e: RuleEntry) =>
    ((Array.isArray(e) ? (e[1] as { patterns?: { regex?: string }[] }) : undefined)?.patterns ?? []).map((p) => p.regex);
  const selectors = (e: RuleEntry) =>
    (Array.isArray(e) ? (e.slice(1) as { selector: string }[]) : []).map((s) => s.selector).join("\n");
  const sel = (re: string) => re.replaceAll("/", "\\x2F");
  const levelNum = (l: unknown) => (l === "error" ? 2 : l === "warn" ? 1 : l === "off" ? 0 : l);

  it.each([[NEW_ROUTE], [NEW_LIB], ["src/components/__p0a-probe__.tsx"]])(
    "%s: obie reguły na poziomie error, wzorce db i db-system",
    async (file) => {
      const cfg = (await eslint.calculateConfigForFile(path.join(ROOT, file))) as Linter.Config;
      const imp = cfg.rules?.["no-restricted-imports"];
      const syn = cfg.rules?.["no-restricted-syntax"];
      expect(levelNum(level(imp))).toBe(2);
      expect(levelNum(level(syn))).toBe(2);
      const all = [DB_IMPORT_SOURCE_REGEX, DB_SYSTEM_IMPORT_SOURCE_REGEX, DB_CLIENT_IMPORT_SOURCE_REGEX, TEST_FILE_IMPORT_SOURCE_REGEX];
      expect(regexes(imp)).toEqual(all);
      for (const re of all) {
        expect(selectors(syn)).toContain(`ImportExpression[source.value=/${sel(re)}/]`);
        expect(selectors(syn)).toContain(`CallExpression[callee.name='require'][arguments.0.value=/${sel(re)}/]`);
      }
      // D1 nie zgubione przy łączeniu selektorów w jednym bloku.
      expect(selectors(syn)).toContain("MemberExpression[property.name=/^(params|detail)$/]");
    },
    30_000
  );

  it("plik z listy: db wyłączone tylko dla niego, db-system nadal error; nowy plik obok — error", async () => {
    const listed = (await eslint.calculateConfigForFile(path.join(ROOT, LISTED_ROUTE_WITH_ID))) as Linter.Config;
    expect(levelNum(level(listed.rules?.["no-restricted-imports"]))).toBe(2);
    expect(regexes(listed.rules?.["no-restricted-imports"])).toEqual([
      DB_SYSTEM_IMPORT_SOURCE_REGEX,
      DB_CLIENT_IMPORT_SOURCE_REGEX,
      TEST_FILE_IMPORT_SOURCE_REGEX,
    ]);
    // Źródło db zostaje w selektorach eksportu (wymaganie (2)), ale nie w selektorach importu.
    expect(selectors(listed.rules?.["no-restricted-syntax"])).not.toContain(`ImportExpression[source.value=/${sel(DB_IMPORT_SOURCE_REGEX)}/]`);
    expect(selectors(listed.rules?.["no-restricted-syntax"])).not.toContain(
      `CallExpression[callee.name='require'][arguments.0.value=/${sel(DB_IMPORT_SOURCE_REGEX)}/]`
    );
    expect(selectors(listed.rules?.["no-restricted-syntax"])).toContain("MemberExpression[property.name=/^(params|detail)$/]");

    const sibling = (await eslint.calculateConfigForFile(
      path.join(ROOT, "src/app/api/appointments/[id]/complete/__p0a-probe__.ts")
    )) as Linter.Config;
    expect(regexes(sibling.rules?.["no-restricted-imports"])).toEqual([
      DB_IMPORT_SOURCE_REGEX,
      DB_SYSTEM_IMPORT_SOURCE_REGEX,
      DB_CLIENT_IMPORT_SOURCE_REGEX,
      TEST_FILE_IMPORT_SOURCE_REGEX,
    ]);
  }, 30_000);

  // B2 (do eb25a47): późniejszy blok z własną regułą dla innego katalogu
  // zastępuje opcje — sprawdzamy KAŻDY plik w src/, nie tylko ścieżki próbne.
  it("każdy plik w src/: poziom i wzorce z konfiguracji wynikowej zgodne z jego klasą", async () => {
    const listed = new Set<string>([...DB_ISOLATION_TRANSITIONAL, ...DB_ISOLATION_PERMANENT]);
    const D1 = "MemberExpression[property.name=/^(params|detail)$/]";
    const EXPORT_DB = "ExportDefaultDeclaration[declaration.name='db']";
    const [DB, SYS, CLIENT, T] = [
      DB_IMPORT_SOURCE_REGEX,
      DB_SYSTEM_IMPORT_SOURCE_REGEX,
      DB_CLIENT_IMPORT_SOURCE_REGEX,
      TEST_FILE_IMPORT_SOURCE_REGEX,
    ];
    const bad: string[] = [];
    const files = walk(path.join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(100);
    for (const abs of files) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const cfg = (await eslint.calculateConfigForFile(abs)) as Linter.Config;
      const imp = cfg.rules?.["no-restricted-imports"];
      const syn = cfg.rules?.["no-restricted-syntax"];
      const isTest = /\.(test|spec)\.tsx?$/.test(rel);
      const inSystem = rel.startsWith("src/lib/server/system/");
      const want = isTest
        ? []
        : rel === "src/lib/db.ts"
          ? [DB, SYS, T]
          : rel === "src/lib/server/system/db-system.ts"
            ? [T] // P0b: do P6 re-eksport `db` (decyzja z 16.11), więc `db: false` tylko tutaj
            : listed.has(rel)
              ? [SYS, CLIENT, T]
              : inSystem
                ? [DB, CLIENT, T]
                : [DB, SYS, CLIENT, T];
      const got = levelNum(level(imp)) === 2 ? regexes(imp) : [];
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${rel}: no-restricted-imports ${JSON.stringify(got)}`);
      const s = levelNum(level(syn)) === 2 ? selectors(syn) : "";
      for (const re of [DB, SYS, CLIENT, T]) {
        const forms = [
          `ImportExpression[source.value=/${sel(re)}/]`,
          `CallExpression[callee.name='require'][arguments.0.value=/${sel(re)}/]`,
        ].map((f) => s.includes(f));
        if (want.includes(re) ? forms.includes(false) : forms.includes(true)) bad.push(`${rel}: no-restricted-syntax ${re}`);
      }
      if (s.includes(EXPORT_DB) !== (isTest || listed.has(rel))) bad.push(`${rel}: zakaz eksportu db ${s.includes(EXPORT_DB)}`);
      if (!s.includes(D1)) bad.push(`${rel}: brak D1`);
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it("bloki izolacji są ostatnie w konfiguracji; żaden inny blok nie ustawia reguł izolacji", () => {
    for (const d1 of D1_SELECTORS) expect(ISOLATION_BLOCK_SELECTORS).toContainEqual(d1);
    const iso = dbIsolationConfig(ISOLATION_BLOCK_SELECTORS);
    const all = config as Linter.Config[];
    expect(all.slice(-iso.length)).toEqual(iso);
    for (const block of all.slice(0, -iso.length)) {
      for (const r of DB_ISOLATION_RULES) expect(block.rules?.[r], r).toBeUndefined();
    }
  });

  it("nieużyte dyrektywy eslint-disable są błędem (Z5)", async () => {
    const cfg = (await eslint.calculateConfigForFile(path.join(ROOT, NEW_ROUTE))) as Linter.Config;
    expect(levelNum(cfg.linterOptions?.reportUnusedDisableDirectives)).toBe(2);
  }, 30_000);
});

/** Źródła importów w tekście (from, import(), require(), także `import x = require()`). */
function importSources(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!);
}

/** Czy tekst pliku nadal importuje surowe `db` (dowolna forma z Z2). */
function importsDb(text: string): boolean {
  const re = new RegExp(DB_IMPORT_SOURCE_REGEX);
  return importSources(text).some((s) => re.test(s));
}

describe("B1 (do eb25a47): stałe zbiory plików przypięte", () => {
  it("wyjątek stały, pula systemowa, testy i zakres reguły — dokładne brzmienie", () => {
    // Dopisanie pliku do wyjątków stałych omijałoby zasadę „lista tylko maleje”.
    expect(DB_ISOLATION_PERMANENT).toEqual(["src/lib/server/repository.ts"]);
    expect(DB_SYSTEM_ALLOWED_FILES).toEqual(["src/lib/server/system/**"]);
    expect(DB_ISOLATION_TEST_FILES).toEqual(["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}"]);
    expect(DB_ISOLATION_FILES).toEqual(["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"]);
    expect(DB_CLIENT_ALLOWED_FILES).toEqual(["src/lib/db.ts", "src/lib/server/system/db-system.ts"]);
  });
});

describe("Z4: lista przejściowa ⊆ BASELINE (suma i per partia), każda pozycja żywa", () => {
  const partitions = DB_ISOLATION_PARTITIONS as Record<string, readonly string[]>;

  it("te same tablice co w BASELINE (P0_FILES … P6_FILES), lista = ich suma", () => {
    expect(Object.keys(partitions)).toEqual(Object.keys(BASELINE));
    expect([...DB_ISOLATION_TRANSITIONAL]).toEqual(Object.values(partitions).flat());
  });

  it("suma zbiorów ⊆ suma BASELINE, bez duplikatów (także między tablicami)", () => {
    expect(new Set(DB_ISOLATION_TRANSITIONAL).size).toBe(DB_ISOLATION_TRANSITIONAL.length);
    const all = new Set(Object.values(BASELINE).flat());
    const extra = DB_ISOLATION_TRANSITIONAL.filter((f: string) => !all.has(f));
    expect(extra, "pozycje spoza BASELINE — lista nie może rosnąć").toEqual([]);
  });

  it.each(Object.keys(BASELINE).map((k) => [k, k]))("%s ⊆ BASELINE.%s (plik nie przeskakuje między tablicami)", (key) => {
    const moved = (partitions[key] ?? []).filter((f) => !BASELINE[key]!.includes(f));
    expect(moved, "przeniesienie między partiami = decyzja CTO i zmiana BASELINE w osobnym commicie").toEqual([]);
  });

  it.each([...DB_ISOLATION_TRANSITIONAL, ...DB_ISOLATION_PERMANENT].map((f: string) => [f]))(
    "%s istnieje i nadal importuje db",
    (file) => {
      const p = path.join(ROOT, file);
      expect(fs.existsSync(p), "plik usunięty — zdejmij go z listy i z BASELINE").toBe(true);
      expect(importsDb(fs.readFileSync(p, "utf8")), "plik nie importuje już db — zdejmij go z listy i z BASELINE").toBe(true);
    }
  );

  it("wykrywacz importu db widzi każdą formę z Z2 (kontrola testu)", () => {
    for (const [name, code] of DB_FORMS) expect(importsDb(code), name).toBe(true);
    expect(importsDb('import { forSalon } from "@/lib/server/repository";')).toBe(false);
  });
});

/** W1: obejście reguł izolacji komentarzem. Zwraca opisy naruszeń. */
export function isolationBypassComments(text: string): string[] {
  const out: string[] = [];
  const rules = DB_ISOLATION_RULES.join("|");
  const comments = [...text.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)].map((m) => m[0]);
  for (const c of comments) {
    const body = c.startsWith("//") ? c.slice(2) : c.slice(2, -2);
    const t = body.trim();
    const directive = /^eslint-disable(?:-next-line|-line)?\b([\s\S]*)$/.exec(t);
    if (directive) {
      const list = directive[1]!.split("--")[0]!.trim();
      if (list === "") out.push(`(a) eslint-disable bez listy reguł: ${t.slice(0, 60)}`);
      else if (new RegExp(`(^|[\\s,])(${rules})([\\s,]|$)`).test(list)) out.push(`(c) wyłączenie reguły izolacji: ${t.slice(0, 80)}`);
    }
    if (/^eslint\s/.test(t) && new RegExp(`(^|[\\s,])(${rules})\\s*:`).test(t.slice(6))) {
      out.push(`(b) konfiguracja inline reguły izolacji: ${t.slice(0, 80)}`);
    }
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(c|m)?(t|j)sx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe("Z5 + W1: w src/** żadnego obejścia reguł izolacji komentarzem", () => {
  it("skan src/**: 0 naruszeń", () => {
    const hits = walk(path.join(ROOT, "src")).flatMap((p) =>
      isolationBypassComments(fs.readFileSync(p, "utf8")).map((h) => `${path.relative(ROOT, p)}: ${h}`)
    );
    expect(hits).toEqual([]);
  });

  it.each([
    ["(a) /* eslint-disable */", "/* eslint-disable */\nimport { db } from '@/lib/db';", "(a)"],
    ["(a) // eslint-disable-next-line", "// eslint-disable-next-line\nimport { db } from '@/lib/db';", "(a)"],
    ["(a) // eslint-disable-line", "import { db } from '@/lib/db'; // eslint-disable-line", "(a)"],
    ["(a) z samym opisem", "// eslint-disable-next-line -- bo tak\nimport { db } from '@/lib/db';", "(a)"],
    ["(b) /* eslint no-restricted-imports: off */", "/* eslint no-restricted-imports: off */", "(b)"],
    ["(b) /* eslint no-restricted-syntax: 0 */", "/* eslint no-restricted-syntax: 0 */", "(b)"],
    ["(b) druga reguła po przecinku", "/* eslint eqeqeq: 0, no-restricted-imports: 0 */", "(b)"],
    ["(c) // eslint-disable-next-line no-restricted-imports", "// eslint-disable-next-line no-restricted-imports", "(c)"],
    ["(c) /* eslint-disable no-restricted-syntax */", "/* eslint-disable no-restricted-syntax */", "(c)"],
    ["(c) na liście kilku reguł", "// eslint-disable-line no-console, no-restricted-imports -- x", "(c)"],
  ])("kontrola testu: %s → wykryte", (_n, text, kind) => {
    const hits = isolationBypassComments(text);
    expect(hits.length, text).toBeGreaterThan(0);
    expect(hits.some((h) => h.startsWith(kind))).toBe(true);
  });

  it.each([
    ["// eslint-disable-next-line react-hooks/exhaustive-deps"],
    ["/* eslint-disable @next/next/no-img-element */"],
    ["// eslint-disable-next-line no-console -- debug"],
    ["// zwykły komentarz o eslint"],
  ])("dozwolone: %s", (text) => {
    expect(isolationBypassComments(text)).toEqual([]);
  });
});
