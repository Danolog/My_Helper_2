// @vitest-environment node
/**
 * #193 P0a: reguła izolacji danych salonu w PRAWDZIWEJ konfiguracji repo.
 *
 * - Z2: każda forma importu surowego `db` (alias, względny, `import *`,
 *   `import()`, `require()`, re-eksport) i puli systemowej poza
 *   `server/system/**` daje błąd; plik z listy przejściowej nie (kontrola
 *   fałszywej czerwieni).
 * - pkt 7 (N1 Leo): poziom reguł czytany z konfiguracji WYNIKOWEJ
 *   (`calculateConfigForFile`), nie z tekstu pliku.
 * - Z4: lista przejściowa ⊆ BASELINE; każda pozycja istnieje i nadal importuje `db`.
 * - Z5 + W1: w `src/**` żadnego obejścia reguł izolacji komentarzem.
 */
import fs from "node:fs";
import path from "node:path";
import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DB_IMPORT_SOURCE_REGEX,
  DB_ISOLATION_PERMANENT,
  DB_ISOLATION_RULES,
  DB_ISOLATION_TRANSITIONAL,
  DB_SYSTEM_IMPORT_SOURCE_REGEX,
} from "../../eslint.db-isolation.mjs";

const ROOT = path.resolve(__dirname, "../..");
const NEW_ROUTE = "src/app/api/__p0a-probe__/route.ts";
const NEW_LIB = "src/lib/__p0a-probe__.ts";
const SYSTEM_FILE = "src/lib/server/system/__p0a-probe__.ts";
const LISTED_ROUTE = "src/app/api/health/route.ts";
const LISTED_ROUTE_WITH_ID = "src/app/api/appointments/[id]/complete/route.ts";

/**
 * Zamrożony stan długu z wyniku reguły bez listy (Z3, 73 pliki na b3a5faf).
 * Partia #193 usuwa swoje pliki z listy w eslint.db-isolation.mjs I stąd w tym
 * samym PR. Dopisanie pozycji do listy bez dopisania tutaj = czerwony test.
 */
const BASELINE = [
  "src/app/api/ai/content/newsletter/route.ts",
  "src/app/api/appointments/[id]/complete/route.ts",
  "src/app/api/appointments/[id]/invoice/route.ts",
  "src/app/api/appointments/[id]/route.ts",
  "src/app/api/appointments/route.ts",
  "src/app/api/available-slots/route.ts",
  "src/app/api/client/appointments/[id]/cancel/route.ts",
  "src/app/api/client/appointments/[id]/review/route.ts",
  "src/app/api/client/appointments/[id]/route.ts",
  "src/app/api/client/appointments/route.ts",
  "src/app/api/client/reviews/route.ts",
  "src/app/api/client/waiting-list/[id]/route.ts",
  "src/app/api/client/waiting-list/route.ts",
  "src/app/api/clients/[id]/loyalty/redeem/route.ts",
  "src/app/api/clients/[id]/route.ts",
  "src/app/api/cron/cleanup-pending-deposits/route.ts",
  "src/app/api/cron/push-reminders-24h/route.ts",
  "src/app/api/cron/push-reminders/route.ts",
  "src/app/api/cron/sms-reminders/route.ts",
  "src/app/api/dashboard/stats/route.ts",
  "src/app/api/deposits/create-session/route.ts",
  "src/app/api/diagnostics/route.ts",
  "src/app/api/employees/[id]/link-account/route.ts",
  "src/app/api/favorites/salons/check/route.ts",
  "src/app/api/favorites/salons/route.ts",
  "src/app/api/health/route.ts",
  "src/app/api/notifications/birthday/route.ts",
  "src/app/api/notifications/low-stock/route.ts",
  "src/app/api/notifications/we-miss-you/route.ts",
  "src/app/api/promotions/check-happy-hours/route.ts",
  "src/app/api/promotions/check-package/route.ts",
  "src/app/api/promotions/check/route.ts",
  "src/app/api/push/subscribe/route.ts",
  "src/app/api/push/unsubscribe/route.ts",
  "src/app/api/register-subscription/route.ts",
  "src/app/api/reminders/appointment/route.ts",
  "src/app/api/salons/[id]/employees/[employeeId]/route.ts",
  "src/app/api/salons/[id]/gallery/route.ts",
  "src/app/api/salons/[id]/route.ts",
  "src/app/api/salons/[id]/services/[serviceId]/route.ts",
  "src/app/api/salons/mine/route.ts",
  "src/app/api/salons/route.ts",
  "src/app/api/seed/route.ts",
  "src/app/api/stripe/webhook/route.ts",
  "src/app/api/subscription-plans/route.ts",
  "src/app/api/subscriptions/cancel/route.ts",
  "src/app/api/subscriptions/checkout/route.ts",
  "src/app/api/subscriptions/current/route.ts",
  "src/app/api/subscriptions/expiration-warning/route.ts",
  "src/app/api/subscriptions/payments/[id]/receipt/route.ts",
  "src/app/api/subscriptions/payments/route.ts",
  "src/app/api/subscriptions/renew/route.ts",
  "src/app/api/temporary-access/route.ts",
  "src/lib/ai/business/chat.ts",
  "src/lib/ai/openrouter.ts",
  "src/lib/ai/usage-limits.ts",
  "src/lib/auth.ts",
  "src/lib/deposit-calculation.ts",
  "src/lib/deposit-confirmation.ts",
  "src/lib/email.ts",
  "src/lib/get-user-salon.ts",
  "src/lib/notification-settings.ts",
  "src/lib/push.ts",
  "src/lib/refund.ts",
  "src/lib/salon-cancellation.ts",
  "src/lib/salon-context.ts",
  "src/lib/session.ts",
  "src/lib/sms.ts",
  "src/lib/subscription-confirmation.ts",
  "src/lib/subscription-locks.ts",
  "src/lib/subscription.ts",
  "src/lib/temporary-access.ts",
  "src/lib/waiting-list.ts",
];

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

const DB_FORMS: [string, string][] = [
  ["alias", 'import { db } from "@/lib/db";\nexport const x = db;'],
  ["względny", 'import { db } from "../../../lib/db";\nexport const x = db;'],
  ["względny z rozszerzeniem", 'import { db } from "../../../lib/db.ts";\nexport const x = db;'],
  ["import *", 'import * as d from "@/lib/db";\nexport const x = d;'],
  ["import()", 'export async function f() { return (await import("@/lib/db")).db; }'],
  ["import() z szablonem", "export async function f() { return (await import(`@/lib/db`)).db; }"],
  ["require()", 'export const x = require("@/lib/db").db;'],
  ["re-eksport", 'export { db } from "@/lib/db";'],
  ["re-eksport *", 'export * from "../../../lib/db";'],
];

const DB_SYSTEM_FORMS: [string, string][] = [
  ["alias", 'import { dbSystem } from "@/lib/server/system/db-system";\nexport const x = dbSystem;'],
  ["względny", 'import { dbSystem } from "../server/system/db-system";\nexport const x = dbSystem;'],
  ["import()", 'export async function f() { return import("@/lib/server/system/db-system"); }'],
  ["require()", 'export const x = require("./server/system/db-system");'],
  ["re-eksport", 'export { dbSystem } from "@/lib/server/system/db-system";'],
];

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

  // Kontrola fałszywej czerwieni (szósty przypadek Leo).
  it.each([
    ["plik z listy przejściowej", LISTED_ROUTE],
    ["plik z listy z [id] w ścieżce", LISTED_ROUTE_WITH_ID],
    ["wyjątek stały (repository)", "src/lib/server/repository.ts"],
    ["test w src/", "src/lib/__p0a-probe__.test.ts"],
  ])("%s: import db → bez błędu izolacji", async (_n, file) => {
    for (const [, code] of DB_FORMS) {
      expect(await isolationErrors(code, file), code).toHaveLength(0);
    }
  }, 60_000);

  it.each([
    ['import { forSalon } from "@/lib/server/repository";\nexport const x = forSalon;'],
    ['import x from "./dbx";\nexport default x;'],
    ['import { schema } from "@/lib/db-schema";\nexport const y = schema;'],
    ['import x from "drizzle-orm/postgres-js";\nexport default x;'],
  ])("inne importy → bez błędu: %s", async (code) => {
    expect(await isolationErrors(code, NEW_ROUTE)).toHaveLength(0);
  }, 30_000);
});

describe("pkt 7 (N1 Leo): poziom reguł z konfiguracji wynikowej", () => {
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
      expect(regexes(imp)).toEqual([DB_IMPORT_SOURCE_REGEX, DB_SYSTEM_IMPORT_SOURCE_REGEX]);
      for (const re of [DB_IMPORT_SOURCE_REGEX, DB_SYSTEM_IMPORT_SOURCE_REGEX]) {
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
    expect(regexes(listed.rules?.["no-restricted-imports"])).toEqual([DB_SYSTEM_IMPORT_SOURCE_REGEX]);
    expect(selectors(listed.rules?.["no-restricted-syntax"])).not.toContain(sel(DB_IMPORT_SOURCE_REGEX));
    expect(selectors(listed.rules?.["no-restricted-syntax"])).toContain("MemberExpression[property.name=/^(params|detail)$/]");

    const sibling = (await eslint.calculateConfigForFile(
      path.join(ROOT, "src/app/api/appointments/[id]/complete/__p0a-probe__.ts")
    )) as Linter.Config;
    expect(regexes(sibling.rules?.["no-restricted-imports"])).toEqual([DB_IMPORT_SOURCE_REGEX, DB_SYSTEM_IMPORT_SOURCE_REGEX]);
  }, 30_000);

  it("nieużyte dyrektywy eslint-disable są błędem (Z5)", async () => {
    const cfg = (await eslint.calculateConfigForFile(path.join(ROOT, NEW_ROUTE))) as Linter.Config;
    expect(levelNum(cfg.linterOptions?.reportUnusedDisableDirectives)).toBe(2);
  }, 30_000);
});

/** Czy tekst pliku nadal importuje surowe `db` (dowolna forma z Z2). */
function importsDb(text: string): boolean {
  const re = new RegExp(DB_IMPORT_SOURCE_REGEX);
  const sources = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!);
  return sources.some((s) => re.test(s));
}

describe("Z4: lista przejściowa ⊆ BASELINE, każda pozycja żywa", () => {
  it("lista ⊆ BASELINE, bez duplikatów", () => {
    expect(new Set(DB_ISOLATION_TRANSITIONAL).size).toBe(DB_ISOLATION_TRANSITIONAL.length);
    const extra = DB_ISOLATION_TRANSITIONAL.filter((f: string) => !BASELINE.includes(f));
    expect(extra, "pozycje spoza BASELINE — lista nie może rosnąć").toEqual([]);
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
