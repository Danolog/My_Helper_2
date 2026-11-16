// @vitest-environment node
/**
 * #193 L7: migawka importerów wyjść rejestru systemowego `src/lib/server/system/**`.
 *
 * Wyjścia przyjmują `userId`/`salonId`. Każdy nowy importer wyjścia ma być widoczny
 * w diffie jako zmiana tej migawki, żeby recenzja sprawdziła pochodzenie argumentu.
 *
 * Mechanizm: program TS na `src/` i checker. Każdy importowany (lub re-eksportowany)
 * specyfikator WARTOŚCI jest rozwiązywany do deklaracji końcowej. Jeśli ta leży
 * w `system/**`, plik trafia do migawki jako importer wpisu `<plik w system/>:<nazwa>`.
 * Ścieżka importu (index, `system/session`, alias, ścieżka względna, re-eksport) nie ma
 * znaczenia: liczy się deklaracja. Importy wyłącznie typów są pomijane.
 *
 * Reguły obok migawki:
 * - W1: `import * as`, `export *`, `export * as` z modułów rejestru = naruszenie.
 * - W3: `import()`, `require()`, `import x = require()` modułów rejestru poza
 *   `system/**` i modułami pośrednimi = naruszenie; specyfikator nieliterałowy = naruszenie.
 * - Zamknięta lista modułów pośrednich (re-eksportują wartość z `system/**`).
 *
 * Kontrakt: PR, który dodaje lub usuwa importera wyjścia, aktualizuje tę migawkę
 * i uzasadnia w opisie, skąd pochodzą `userId`/`salonId`.
 * Zakres: wyłącznie `src/` (bez plików testów).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const SYSTEM_PREFIX = "src/lib/server/system/";

/** Moduły spoza `system/**` objęte W1/W3 (decyzja Ryana). */
const REGISTRY_ADJACENT = ["src/lib/get-user-salon.ts", "src/lib/salon-context.ts", "src/lib/temporary-access.ts"];

/** Zamknięta lista modułów pośrednich: spoza `system/**`, re-eksportują wartość z `system/**`. */
const INTERMEDIATE_MODULES = ["src/lib/salon-context.ts", "src/lib/temporary-access.ts"];

/** Migawka: wpis `<plik w system/>:<deklaracja>` → posortowani importerzy spoza `system/**`. */
const SNAPSHOT: Record<string, string[]> = {
  "auth-adapter.ts:authAdapter": ["src/lib/auth.ts"],
  "cron.ts:cleanupExpiredTemporaryAccess": [
    "src/app/api/cron/cleanup-temporary-access/route.ts",
    "src/lib/temporary-access.ts",
  ],
  "db-system.ts:dbSystem": [],
  "health.ts:checkDatabase": ["src/app/api/diagnostics/route.ts"],
  "health.ts:pingDatabase": ["src/app/api/health/route.ts"],
  "session.ts:getActiveTemporaryAccess": [
    "src/app/api/temporary-access/check/route.ts",
    "src/lib/temporary-access.ts",
  ],
  "session.ts:getUserSalon": ["src/lib/get-user-salon.ts"],
  "session.ts:getUserSalonId": [],
  "session.ts:hasTemporaryAccess": [
    "src/app/api/temporary-access/check/route.ts",
    "src/lib/salon-context.ts",
    "src/lib/temporary-access.ts",
  ],
  "session.ts:isSalonOwner": ["src/lib/session.ts"],
  "session.ts:resolveSalonContext": [
    "src/app/api/push/test/route.ts",
    "src/lib/salon-context.ts",
    "src/lib/session.ts",
  ],
  "session.ts:revokeSalonGrantsForUser": [
    "src/app/api/employees/[id]/link-account/route.ts",
    "src/lib/temporary-access.ts",
  ],
};

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
const isSystem = (relPath: string) => relPath.startsWith(SYSTEM_PREFIX);

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, acc);
    } else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !/\.d\.[cm]?ts$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

type Analysis = {
  files: number;
  importers: Record<string, string[]>;
  intermediates: string[];
  w1: string[];
  w3: string[];
};

function analyze(): Analysis {
  const cfgPath = path.join(ROOT, "tsconfig.json");
  const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, ROOT);
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false };
  const files = walk(SRC);
  const program = ts.createProgram(files, options);
  const checker = program.getTypeChecker();

  /** Plik docelowy specyfikatora (alias `@/`, ścieżki względne, rozszerzenia, `/index`) albo null. */
  const resolveTarget = (spec: string, from: string): string | null => {
    const r = ts.resolveModuleName(spec, from, options, ts.sys).resolvedModule;
    return r && !r.isExternalLibraryImport ? rel(r.resolvedFileName) : null;
  };
  const isRegistryModule = (target: string | null) =>
    target !== null && (isSystem(target) || REGISTRY_ADJACENT.includes(target));

  /** Wpis migawki dla symbolu (deklaracja końcowa w `system/**`, tylko wartości) albo null. */
  const entryOf = (sym: ts.Symbol | undefined): string | null => {
    if (!sym) return null;
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    if (!(target.flags & ts.SymbolFlags.Value)) return null;
    const decl = target.declarations?.[0];
    if (!decl) return null;
    const declFile = rel(decl.getSourceFile().fileName);
    if (!isSystem(declFile)) return null;
    return `${declFile.slice(SYSTEM_PREFIX.length)}:${target.getName()}`;
  };

  const importers = new Map<string, Set<string>>();
  const intermediates = new Set<string>();
  const w1: string[] = [];
  const w3: string[] = [];

  // Klucze: każdy eksport wartości z każdego pliku system/** (deklaracja końcowa), także bez importera.
  for (const sf of program.getSourceFiles()) {
    if (!isSystem(rel(sf.fileName))) continue;
    const mod = checker.getSymbolAtLocation(sf);
    if (!mod) continue;
    for (const exp of checker.getExportsOfModule(mod)) {
      const key = entryOf(exp);
      if (key && !importers.has(key)) importers.set(key, new Set());
    }
  }

  for (const sf of program.getSourceFiles()) {
    const file = rel(sf.fileName);
    if (!file.startsWith("src/") || isSystem(file)) continue;
    const dynamicAllowed = INTERMEDIATE_MODULES.includes(file);

    const record = (sym: ts.Symbol | undefined) => {
      const key = entryOf(sym);
      if (!key) return null;
      if (!importers.has(key)) importers.set(key, new Set());
      importers.get(key)!.add(file);
      return key;
    };

    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        const clause = st.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const spec = st.moduleSpecifier.text;
        if (clause.name) record(checker.getSymbolAtLocation(clause.name));
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb) && isRegistryModule(resolveTarget(spec, sf.fileName))) {
          w1.push(`W1 ${file}: import * as ${nb.name.text} from '${spec}'`);
        }
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) if (!el.isTypeOnly) record(checker.getSymbolAtLocation(el.name));
        }
      } else if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue;
        const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
        if (spec !== null && (!st.exportClause || ts.isNamespaceExport(st.exportClause))) {
          if (isRegistryModule(resolveTarget(spec, sf.fileName))) {
            const form = st.exportClause ? `export * as ${(st.exportClause as ts.NamespaceExport).name.text}` : "export *";
            w1.push(`W1 ${file}: ${form} from '${spec}'`);
          }
          continue;
        }
        if (st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            if (el.isTypeOnly) continue;
            const sym = checker.getExportSpecifierLocalTargetSymbol(el);
            const key = spec !== null ? record(sym) : entryOf(sym);
            if (key) intermediates.add(file);
          }
        }
      } else if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
        if (entryOf(checker.getSymbolAtLocation(st.expression))) intermediates.add(file);
      } else if (
        ts.isImportEqualsDeclaration(st) &&
        ts.isExternalModuleReference(st.moduleReference) &&
        !dynamicAllowed
      ) {
        const arg = st.moduleReference.expression;
        if (!ts.isStringLiteralLike(arg)) w3.push(`W3 ${file}: import ${st.name.text} = require(…) — specyfikator nie jest literałem`);
        else if (isRegistryModule(resolveTarget(arg.text, sf.fileName))) {
          w3.push(`W3 ${file}: import ${st.name.text} = require('${arg.text}')`);
        }
      }
    }

    if (dynamicAllowed) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const kind =
          node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? "import"
            : ts.isIdentifier(node.expression) && node.expression.text === "require"
              ? "require"
              : null;
        if (kind && node.arguments.length > 0) {
          const arg = node.arguments[0]!;
          if (!ts.isStringLiteralLike(arg)) {
            w3.push(`W3 ${file}: ${kind}(${arg.getText(sf)}) — specyfikator nie jest literałem`);
          } else if (isRegistryModule(resolveTarget(arg.text, sf.fileName))) {
            w3.push(`W3 ${file}: ${kind}('${arg.text}')`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const out: Record<string, string[]> = {};
  for (const key of [...importers.keys()].sort()) out[key] = [...importers.get(key)!].sort();
  return { files: files.length, importers: out, intermediates: [...intermediates].sort(), w1: w1.sort(), w3: w3.sort() };
}

describe("L7: importerzy wyjść rejestru systemowego (checker TS, src/)", () => {
  let a: Analysis;

  // Program TS na całym src/ — jawny limit czasu tylko dla budowy (jak w system-registry.test.ts).
  beforeAll(() => {
    a = analyze();
  }, 300_000);

  it("program obejmuje src/ i znajduje wyjścia system/**", () => {
    expect(a.files).toBeGreaterThan(100);
    expect(Object.keys(a.importers).length).toBeGreaterThan(0);
  });

  it("migawka: importerzy per wpis (dokładnie)", () => {
    expect(a.importers).toEqual(SNAPSHOT);
  });

  it("session.ts:revokeSalonGrantsForUser (kasuje dane): lista DOKŁADNIE dzisiejsza", () => {
    expect(a.importers["session.ts:revokeSalonGrantsForUser"]).toEqual([
      "src/app/api/employees/[id]/link-account/route.ts",
      "src/lib/temporary-access.ts",
    ]);
  });

  it("cron.ts:cleanupExpiredTemporaryAccess (kasuje dane): lista DOKŁADNIE dzisiejsza", () => {
    expect(a.importers["cron.ts:cleanupExpiredTemporaryAccess"]).toEqual([
      "src/app/api/cron/cleanup-temporary-access/route.ts",
      "src/lib/temporary-access.ts",
    ]);
  });

  it("zamknięta lista modułów pośrednich (re-eksport wartości z system/**)", () => {
    expect(a.intermediates).toEqual(INTERMEDIATE_MODULES);
  });

  it("W1: brak import * / export * / export * as z modułów rejestru", () => {
    expect(a.w1).toEqual([]);
  });

  it("W3: brak import()/require()/import = require() modułów rejestru poza system/** i pośrednimi; specyfikator tylko literał", () => {
    expect(a.w3).toEqual([]);
  });
});
