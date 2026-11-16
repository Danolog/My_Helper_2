// @vitest-environment node
/**
 * #193 P0b: rejestr wyjść systemowych `src/lib/server/system/**`.
 *
 * - R-Z1 (Ryan (c)): migawka plików i eksportów `system/`. Każde nowe wyjście
 *   zmienia migawkę, więc jest widoczne w diffie.
 * - Z7 + W2: każdy eksport `system/**` to funkcja async zwracająca dane; bez
 *   puli, bez obiektu z `.select`/`.transaction`/`.execute`, bez nazw
 *   raw/tx/getDb/withTx i bez parametrów-funkcji (zakaz callbacków).
 *   Wyjątki: zamknięta lista przypięta `toEqual` (decyzja Ethana 16.11).
 * - `system/index.ts` = rejestr: re-eksportuje dokładnie wyjścia plików z
 *   `REGISTRY_SOURCES`, bez wyjątków (pula i adapter nie wychodzą przez rejestr).
 * - Adapter Better Auth: importuje go wyłącznie `src/lib/auth.ts`.
 * - DoD P0b: dawne pliki P0 nie importują surowego `db`.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DB_IMPORT_SOURCE_REGEX } from "../../eslint.db-isolation.mjs";

// Import modułów systemowych nie może dotknąć bazy; pula zastąpiona pustym obiektem.
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: {} }));

const ROOT = path.resolve(__dirname, "../..");
const SYSTEM_DIR = path.join(ROOT, "src/lib/server/system");

/** Migawka R-Z1: plik (względem system/) → posortowane eksporty wartości. */
const SESSION_EXPORTS = [
  "getActiveTemporaryAccess",
  "getUserSalon",
  "getUserSalonId",
  "hasTemporaryAccess",
  "isSalonOwner",
  "resolveSalonContext",
  "revokeSalonGrantsForUser",
];
const CRON_EXPORTS = ["cleanupExpiredTemporaryAccess"];
const HEALTH_EXPORTS = ["checkDatabase", "pingDatabase"];
/** #193 P5a-1: subskrypcje push po stronie wysyłki (decyzja CTO 3d / 3d-KOREKTA). */
const NOTIFICATIONS_EXPORTS = ["deleteUndeliverablePushSubscriptions", "getPushSubscriptionsForUser"];
/** Pliki re-eksportowane przez rejestr `index.ts` w całości. */
const REGISTRY_SOURCES = ["session.ts", "cron.ts", "health.ts", "notifications.ts"];
const SNAPSHOT: Record<string, string[]> = {
  "auth-adapter.ts": ["authAdapter"],
  "cron.ts": CRON_EXPORTS,
  "db-system.ts": ["dbSystem"],
  "health.ts": HEALTH_EXPORTS,
  "index.ts": [...SESSION_EXPORTS, ...CRON_EXPORTS, ...HEALTH_EXPORTS, ...NOTIFICATIONS_EXPORTS].sort(),
  "notifications.ts": NOTIFICATIONS_EXPORTS,
  "session.ts": SESSION_EXPORTS,
};

/** Zamknięta lista wyjątków od Z7/W2 (Ethan 16.11). */
const W2_EXCEPTIONS: Record<string, string[]> = {
  "auth-adapter.ts": ["authAdapter"],
  "db-system.ts": ["dbSystem"],
};

const FORMER_P0_FILES = [
  "src/app/api/diagnostics/route.ts",
  "src/app/api/health/route.ts",
  "src/lib/auth.ts",
  "src/lib/get-user-salon.ts",
  "src/lib/salon-context.ts",
  "src/lib/session.ts",
  "src/lib/temporary-access.ts",
];

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(c|m)?(t|j)sx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const rel = (abs: string, base = ROOT) => path.relative(base, abs).split(path.sep).join("/");

/** Źródła importów w tekście (from, import(), require(), także `import x = require()`). */
function importSources(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g)].map((m) => m[1]!);
}

function systemFiles(): string[] {
  return walk(SYSTEM_DIR).map((abs) => rel(abs, SYSTEM_DIR)).sort();
}

async function runtimeExports(file: string): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ path.join(SYSTEM_DIR, file))) as Record<string, unknown>;
}

describe("R-Z1: migawka plików i eksportów system/", () => {
  it("pliki i eksporty wartości = migawka", async () => {
    const got: Record<string, string[]> = {};
    for (const file of systemFiles()) got[file] = Object.keys(await runtimeExports(file)).sort();
    expect(got).toEqual(SNAPSHOT);
  }, 60_000);

  it("warunki Ryana z #206: isSalonOwner w session.ts, cleanupExpiredTemporaryAccess w cron.ts", () => {
    expect(SNAPSHOT["session.ts"]).toContain("isSalonOwner");
    expect(SNAPSHOT["cron.ts"]).toContain("cleanupExpiredTemporaryAccess");
    expect(SNAPSHOT).not.toHaveProperty("identity.ts"); // P3: identity.ts dopiero w P2
  });

  it("index.ts re-eksportuje dokładnie wyjścia plików rejestru (te same obiekty), bez wyjątków", async () => {
    const index = await runtimeExports("index.ts");
    const expected: [string, unknown][] = [];
    for (const file of REGISTRY_SOURCES) {
      for (const [k, v] of Object.entries(await runtimeExports(file))) expected.push([k, v]);
    }
    expect(Object.keys(index).sort()).toEqual(expected.map(([k]) => k).sort());
    for (const [k, v] of expected) expect(index[k], k).toBe(v);
    for (const names of Object.values(W2_EXCEPTIONS)) for (const n of names) expect(index).not.toHaveProperty(n);
  }, 60_000);
});

describe("Z7 + W2: eksporty system/** (poza zamkniętą listą wyjątków)", () => {
  it("lista wyjątków przypięta", () => {
    expect(W2_EXCEPTIONS).toEqual({ "auth-adapter.ts": ["authAdapter"], "db-system.ts": ["dbSystem"] });
  });

  it("runtime: każdy eksport spoza wyjątków to funkcja async, nie pula/obiekt z .select", async () => {
    const bad: string[] = [];
    for (const file of systemFiles()) {
      for (const [name, value] of Object.entries(await runtimeExports(file))) {
        if (W2_EXCEPTIONS[file]?.includes(name)) continue;
        if (/^(raw|tx|getDb|withTx)$/i.test(name)) bad.push(`${file}:${name} zakazana nazwa`);
        if (typeof value !== "function" || value.constructor?.name !== "AsyncFunction") {
          bad.push(`${file}:${name} nie jest funkcją async`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);

  describe("typy (kompilator TS): parametry bez funkcji, wynik bez puli", () => {
    let program: ts.Program;
    let checker: ts.TypeChecker;
    const files = () => systemFiles().map((f) => path.join(SYSTEM_DIR, f));

    beforeAll(() => {
      const cfgPath = path.join(ROOT, "tsconfig.json");
      const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, ROOT);
      program = ts.createProgram(files(), { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false });
      checker = program.getTypeChecker();
    }, 180_000);

    const POOL_PROPS = ["select", "transaction", "execute", "query", "insert", "update", "delete"];

    /** Czy typ może nieść funkcję (callback): sygnatura wywołania, any/unknown, albo pole/elem. z funkcją. */
    function carriesFunction(t: ts.Type, depth = 0): string | null {
      if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return checker.typeToString(t);
      if (t.isUnionOrIntersection()) {
        for (const c of t.types) {
          const r = carriesFunction(c, depth);
          if (r) return r;
        }
        return null;
      }
      if (t.getCallSignatures().length > 0 || t.getConstructSignatures().length > 0) return checker.typeToString(t);
      if (checker.isArrayType(t) || checker.isTupleType(t)) {
        for (const a of checker.getTypeArguments(t as ts.TypeReference)) {
          const r = carriesFunction(a, depth + 1);
          if (r) return r;
        }
        return null;
      }
      if (t.flags & ts.TypeFlags.Object && depth < 3) {
        // Tylko typy zadeklarowane w src/ (DTO); typy biblioteczne (Date itd.) mają metody z natury.
        const decl = t.getSymbol()?.declarations?.[0];
        const fromSrc = !decl || rel(decl.getSourceFile().fileName).startsWith("src/");
        if (!fromSrc) return null;
        for (const p of checker.getPropertiesOfType(t)) {
          const r = carriesFunction(checker.getTypeOfSymbol(p), depth + 1);
          if (r) return `${p.getName()}: ${r}`;
        }
      }
      return null;
    }

    it("każdy eksport spoza wyjątków: Promise, wynik bez puli/funkcji, parametry bez funkcji", () => {
      const bad: string[] = [];
      for (const abs of files()) {
        const file = rel(abs, SYSTEM_DIR);
        const sf = program.getSourceFile(abs)!;
        const mod = checker.getSymbolAtLocation(sf);
        if (!mod) continue; // plik bez eksportów — migawka i tak go złapie
        for (const sym0 of checker.getExportsOfModule(mod)) {
          const sym = sym0.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym0) : sym0;
          if (!(sym.flags & ts.SymbolFlags.Value)) continue; // eksport typu
          const name = sym0.getName();
          if (W2_EXCEPTIONS[file]?.includes(name)) continue;
          const type = checker.getTypeOfSymbolAtLocation(sym, sf);
          const sigs = type.getCallSignatures();
          if (sigs.length === 0) {
            bad.push(`${file}:${name} nie jest funkcją`);
            continue;
          }
          for (const sig of sigs) {
            const ret = sig.getReturnType();
            // Publiczne API TS: typ zwracany to Promise (symbol Promise), wynik = typ po await.
            const isPromise = ret.getSymbol()?.getName() === "Promise";
            const inner: ts.Type | undefined = isPromise ? checker.getAwaitedType(ret) : undefined;
            if (!inner) bad.push(`${file}:${name} nie zwraca Promise`);
            else {
              if (inner.getCallSignatures().length > 0) bad.push(`${file}:${name} zwraca funkcję`);
              const props: ts.Symbol[] = inner.isUnion()
                ? inner.types.flatMap((u: ts.Type) => checker.getPropertiesOfType(u))
                : checker.getPropertiesOfType(inner);
              const pool = props.map((p: ts.Symbol) => p.getName()).filter((p: string) => POOL_PROPS.includes(p));
              if (pool.length) bad.push(`${file}:${name} zwraca obiekt z ${pool.join(",")}`);
            }
            for (const param of sig.getParameters()) {
              const decl = param.valueDeclaration ?? sf;
              const r = carriesFunction(checker.getTypeOfSymbolAtLocation(param, decl));
              if (r) bad.push(`${file}:${name}(${param.getName()}) parametr niesie funkcję: ${r}`);
            }
          }
        }
      }
      expect(files().length).toBeGreaterThan(0);
      expect(bad).toEqual([]);
    }, 60_000);
  });
});

describe("adapter Better Auth: jedyny importer to src/lib/auth.ts", () => {
  it("skan src/: źródła importu auth-adapter (wszystkie formy) tylko w src/lib/auth.ts", () => {
    const re = /(^|\/)auth-adapter(\.[cm]?[jt]s)?$/;
    const importers = walk(path.join(ROOT, "src"))
      .filter((abs) => importSources(fs.readFileSync(abs, "utf8")).some((s) => re.test(s)))
      .map((abs) => rel(abs))
      .sort();
    expect(importers).toEqual(["src/lib/auth.ts"]);
  });

  it("src/lib/auth.ts przekazuje authAdapter jako bazę Better Auth", () => {
    const text = fs.readFileSync(path.join(ROOT, "src/lib/auth.ts"), "utf8");
    expect(text).toMatch(/\bdatabase:\s*authAdapter\b/);
    expect(text).not.toMatch(/\bdrizzleAdapter\b/);
  });
});

describe("DoD P0b: dawne pliki P0 bez surowego db", () => {
  it.each(FORMER_P0_FILES.map((f) => [f]))("%s nie importuje @/lib/db (żadna forma)", (file) => {
    const re = new RegExp(DB_IMPORT_SOURCE_REGEX);
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(importSources(text).filter((s) => re.test(s))).toEqual([]);
  });
});
