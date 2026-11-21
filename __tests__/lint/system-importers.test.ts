// @vitest-environment node
/**
 * #193 L7: migawka importerów wyjść rejestru systemowego `src/lib/server/system/**`.
 *
 * Część wyjść przyjmuje `userId`/`salonId`. Każdy nowy importer wyjścia ma być widoczny
 * w diffie jako zmiana tej migawki, żeby recenzja sprawdziła pochodzenie argumentu.
 *
 * Mechanizm: program TS na `src/` i checker. Każdy importowany (lub re-eksportowany)
 * specyfikator WARTOŚCI jest rozwiązywany do deklaracji końcowej. Jeśli ta leży
 * w `system/**`, plik trafia do migawki jako importer wpisu `<plik w system/>:<nazwa>`.
 * Ścieżka importu (index, `system/session`, alias, ścieżka względna, re-eksport) nie ma
 * znaczenia: liczy się deklaracja. Importy wyłącznie typów są pomijane.
 *
 * Moduły rejestru (cel W1/W3) są wyliczane z programu: `system/**`, moduły opakowujące
 * z #193 (`REGISTRY_ADJACENT`) oraz każdy plik, którego eksporty zawierają wpis z `system/**`.
 *
 * Reguły obok migawki:
 * - W1: `import * as`, `export *`, `export * as` z modułów rejestru = naruszenie.
 * - W3 (cały `src/` poza `system/**`, bez wyjątków): `import()`, `require()`,
 *   `import x = require()` modułu rejestru = naruszenie; specyfikator nieliterałowy = naruszenie;
 *   `createRequire(…)` i `<x>.require(…)` = naruszenie niezależnie od argumentu.
 * - Zamknięta lista modułów pośrednich (re-eksportują wartość z `system/**`) — tylko lista,
 *   nie daje żadnego zwolnienia z W1/W3.
 * - W `src/` nie ma plików JS (`tsconfig` ma `allowJs`; plik JS byłby poza programem).
 * - Fail-closed konfiguracji: tsconfig wczytany bez błędów, alias `@/` rozwiązuje się do rejestru.
 *
 * Kontrakt: PR, który dodaje lub usuwa importera wyjścia, aktualizuje tę migawkę i uzasadnia
 * w opisie, skąd pochodzą `userId`/`salonId`. Dwa poziomy akceptacji:
 * - wyjścia kasujące dane albo nieodwracalnie zmieniające stan wizyty lub płatności w wielu
 *   salonach (osobne asercje „lista DOKŁADNIE”): zmianę akceptują CTO i CRCO;
 * - pozostałe wyjścia: zmianę akceptuje CTO, CRCO do wglądu.
 * Zakres: wyłącznie `src/` (bez plików testów).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const SYSTEM_PREFIX = "src/lib/server/system/";

/** Moduły opakowujące wyjścia spoza `system/**`, zawsze objęte W1/W3 (#193). */
const REGISTRY_ADJACENT = ["src/lib/get-user-salon.ts", "src/lib/salon-context.ts", "src/lib/temporary-access.ts"];

/**
 * Zamknięta lista modułów pośrednich: spoza `system/**`, re-eksportują wartość z `system/**`.
 * Wyłącznie lista do porównania — wpis tutaj nie zwalnia z W1/W3.
 */
const INTERMEDIATE_MODULES = ["src/lib/salon-context.ts", "src/lib/temporary-access.ts"];

const CONTRACT =
  "zmiana importerów wyjść rejestru systemowego (#193 L7): zaktualizuj SNAPSHOT" +
  " (dla wyjść kasujących dane także osobną listę DOKŁADNIE) i w opisie PR podaj, skąd pochodzą" +
  " userId/salonId w nowym miejscu; zmianę akceptuje CTO, CRCO do wglądu";
const DATA_DELETING_CONTRACT =
  "zmiana importerów wyjścia kasującego dane (#193 L7): zaktualizuj SNAPSHOT i listę DOKŁADNIE," +
  " w opisie PR podaj, skąd pochodzą userId/salonId w nowym miejscu; zmianę akceptują CTO i CRCO";
const IRREVERSIBLE_STATE_CONTRACT =
  "zmiana importerów wyjścia nieodwracalnie zmieniającego stan wizyt lub płatności w wielu salonach (#193 L7):" +
  " zaktualizuj SNAPSHOT i listę DOKŁADNIE, w opisie PR podaj, skąd pochodzą userId/salonId w nowym miejscu;" +
  " zmianę akceptują CTO i CRCO";
const INTERMEDIATE_CONTRACT =
  "zmiana listy modułów pośrednich rejestru systemowego (#193 L7): zaktualizuj INTERMEDIATE_MODULES" +
  " i SNAPSHOT, w opisie PR podaj, po co nowy moduł re-eksportuje wyjście; zmianę akceptuje CTO, CRCO do wglądu";

/** Migawka: wpis `<plik w system/>:<deklaracja>` → posortowani importerzy spoza `system/**`. */
const SNAPSHOT: Record<string, string[]> = {
  "auth-adapter.ts:authAdapter": ["src/lib/auth.ts"],
  "auth-throttle.ts:clearSignInFailures": ["src/lib/auth-rate-limit-options.ts"],
  "auth-throttle.ts:consumeAuthRateLimit": ["src/lib/auth-rate-limit-options.ts"],
  "auth-throttle.ts:reserveAccountSignInAttempt": ["src/lib/auth-rate-limit-options.ts"],
  // Publiczna lista salonów: bez argumentów (brak userId/salonId), tylko odczyt.
  "catalog.ts:listPublicSalonCatalog": ["src/app/api/salons/route.ts"],
  // #193: tylko odczyt hasha; userId = session.user.id z auth.api.getSession (nie z żądania).
  "credentials.ts:findCredentialPasswordHash": ["src/app/api/clients/[id]/route.ts"],
  "cron.ts:cleanupExpiredTemporaryAccess": [
    "src/app/api/cron/cleanup-temporary-access/route.ts",
    "src/lib/temporary-access.ts",
  ],
  "db-system.ts:dbSystem": [],
  "deposits-cleanup.ts:cleanupStaleDepositBookings": ["src/app/api/cron/cleanup-pending-deposits/route.ts"],
  "health.ts:checkDatabase": ["src/app/api/diagnostics/route.ts"],
  "health.ts:pingDatabase": ["src/app/api/health/route.ts"],
  "notifications.ts:countPushSubscriptions": [
    "src/app/api/cron/push-reminders-24h/route.ts",
    "src/app/api/cron/push-reminders/route.ts",
  ],
  "notifications.ts:deleteUndeliverablePushSubscriptions": ["src/lib/push.ts"],
  "notifications.ts:findDueAppointmentReminders": ["src/app/api/reminders/appointment/route.ts"],
  "notifications.ts:findDuePushReminders": [
    "src/app/api/cron/push-reminders-24h/route.ts",
    "src/app/api/cron/push-reminders/route.ts",
  ],
  "notifications.ts:findDueSmsReminders": ["src/app/api/cron/sms-reminders/route.ts"],
  "notifications.ts:getPendingCronReminders": [
    "src/app/api/cron/push-reminders-24h/route.ts",
    "src/app/api/cron/push-reminders/route.ts",
    "src/app/api/cron/sms-reminders/route.ts",
  ],
  "notifications.ts:getPushSubscriptionsForUser": ["src/lib/push.ts"],
  "notifications.ts:getUserIdsWithPushSubscriptions": [
    "src/app/api/cron/push-reminders-24h/route.ts",
    "src/app/api/cron/push-reminders/route.ts",
  ],
  "notifications.ts:markAppointmentRemindersSent": ["src/app/api/reminders/appointment/route.ts"],
  "notifications.ts:markCronRemindersSent": [
    "src/app/api/cron/push-reminders-24h/route.ts",
    "src/app/api/cron/push-reminders/route.ts",
    "src/app/api/cron/sms-reminders/route.ts",
  ],
  "plans.ts:ensurePlansExist": ["src/app/api/subscription-plans/route.ts"],
  "seed.ts:seedDemoData": ["src/app/api/seed/route.ts"],
  "waiting-list.ts:resolveWaitingListToken": ["src/lib/waiting-list.ts"],
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
  // #193: tylko odczyt (flagi, bez id innych salonów); email z treści żądania właściciela,
  // exceptEmployeeId = pracownik już znaleziony przez forSalon(salonId z getUserSalonId).
  "staff-access.ts:findAccountForEmployeeLink": ["src/app/api/employees/[id]/link-account/route.ts"],
};

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");
const isSystem = (relPath: string) => relPath.startsWith(SYSTEM_PREFIX);

/** Pliki `src/` do analizy (TS) i pliki JS (mają nie istnieć). */
function walk(dir: string, acc = { ts: [] as string[], js: [] as string[] }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, acc);
    } else if (/\.(js|jsx|mjs|cjs)$/.test(e.name)) {
      acc.js.push(p);
    } else if (
      /\.(ts|tsx|mts|cts)$/.test(e.name) &&
      !/\.d\.[cm]?ts$/.test(e.name) &&
      !/\.(test|spec)\./.test(e.name) &&
      !p.split(path.sep).includes("__tests__")
    ) {
      acc.ts.push(p);
    }
  }
  return acc;
}

type Analysis = {
  files: number;
  jsFiles: string[];
  configErrors: string[];
  aliasProbe: string | null;
  registryModules: string[];
  importers: Record<string, string[]>;
  intermediates: string[];
  w1: string[];
  w3: string[];
};

function analyze(): Analysis {
  const cfgPath = path.join(ROOT, "tsconfig.json");
  const raw = ts.readConfigFile(cfgPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, ROOT);
  const configErrors = [...(raw.error ? [raw.error] : []), ...parsed.errors].map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  );
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false };
  const walked = walk(SRC);
  const files = walked.ts;
  const program = ts.createProgram(files, options);
  const checker = program.getTypeChecker();

  /** Plik docelowy specyfikatora (alias `@/`, ścieżki względne, rozszerzenia, `/index`) albo null. */
  const resolveTarget = (spec: string, from: string): string | null => {
    const r = ts.resolveModuleName(spec, from, options, ts.sys).resolvedModule;
    return r && !r.isExternalLibraryImport ? rel(r.resolvedFileName) : null;
  };
  const aliasProbe = resolveTarget("@/lib/server/system", path.join(SRC, "lib/__alias_probe__.ts"));

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
  const registry = new Set<string>(REGISTRY_ADJACENT);
  const w1: string[] = [];
  const w3: string[] = [];

  for (const sf of program.getSourceFiles()) {
    const file = rel(sf.fileName);
    if (!file.startsWith("src/")) continue;
    const mod = checker.getSymbolAtLocation(sf);
    if (isSystem(file)) {
      registry.add(file);
      // Klucze: każdy eksport wartości z każdego pliku system/** (deklaracja końcowa), także bez importera.
      for (const exp of mod ? checker.getExportsOfModule(mod) : []) {
        const key = entryOf(exp);
        if (key && !importers.has(key)) importers.set(key, new Set());
      }
      continue;
    }
    // Moduł spoza system/**, którego eksporty zawierają wpis z system/** = moduł pośredni i moduł rejestru.
    if (mod && checker.getExportsOfModule(mod).some((exp) => entryOf(exp) !== null)) {
      intermediates.add(file);
      registry.add(file);
    }
  }
  const isRegistryModule = (target: string | null) => target !== null && registry.has(target);

  for (const sf of program.getSourceFiles()) {
    const file = rel(sf.fileName);
    if (!file.startsWith("src/") || isSystem(file)) continue;

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
      } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
        const arg = st.moduleReference.expression;
        if (!ts.isStringLiteralLike(arg)) w3.push(`W3 ${file}: import ${st.name.text} = require(…) — specyfikator nie jest literałem`);
        else if (isRegistryModule(resolveTarget(arg.text, sf.fileName))) {
          w3.push(`W3 ${file}: import ${st.name.text} = require('${arg.text}')`);
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const kind =
          callee.kind === ts.SyntaxKind.ImportKeyword
            ? "import"
            : ts.isIdentifier(callee) && callee.text === "require"
              ? "require"
              : null;
        const nameOf = (e: ts.Expression) =>
          ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
        const calleeName = nameOf(callee);
        if (kind && node.arguments.length > 0) {
          const arg = node.arguments[0]!;
          if (!ts.isStringLiteralLike(arg)) {
            w3.push(`W3 ${file}: ${kind}(${arg.getText(sf)}) — specyfikator nie jest literałem`);
          } else if (isRegistryModule(resolveTarget(arg.text, sf.fileName))) {
            w3.push(`W3 ${file}: ${kind}('${arg.text}')`);
          }
        } else if (
          calleeName === "createRequire" ||
          (ts.isPropertyAccessExpression(callee) && calleeName === "require")
        ) {
          w3.push(`W3 ${file}: ${callee.getText(sf)}(…) — require poza importem, niezależnie od argumentu`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  const out: Record<string, string[]> = {};
  for (const key of [...importers.keys()].sort()) out[key] = [...importers.get(key)!].sort();
  return {
    files: files.length,
    jsFiles: walked.js.map(rel).sort(),
    configErrors,
    aliasProbe,
    registryModules: [...registry].sort(),
    importers: out,
    intermediates: [...intermediates].sort(),
    w1: w1.sort(),
    w3: w3.sort(),
  };
}

describe("L7: importerzy wyjść rejestru systemowego (checker TS, src/)", () => {
  let a: Analysis;

  // Program TS na całym src/ — jawny limit czasu tylko dla budowy (jak w system-registry.test.ts).
  beforeAll(() => {
    a = analyze();
  }, 300_000);

  it("konfiguracja: tsconfig bez błędów, sonda aliasu @/ trafia w rejestr (fail-closed)", () => {
    expect(a.configErrors, "błędy wczytania tsconfig.json").toEqual([]);
    expect(a.aliasProbe, "sonda aliasu: @/lib/server/system ma się rozwiązać do system/index.ts").toBe(
      "src/lib/server/system/index.ts",
    );
    expect(a.files).toBeGreaterThan(100);
    expect(Object.keys(a.importers).length).toBeGreaterThan(0);
  });

  it("src/ bez plików JS (allowJs: plik JS byłby poza analizą)", () => {
    expect(a.jsFiles, "plik JS w src/ omija analizę importerów rejestru (#193 L7) — przepisz na TS").toEqual([]);
  });

  it("migawka: importerzy per wpis (dokładnie)", () => {
    expect(a.importers, CONTRACT).toEqual(SNAPSHOT);
  });

  it("session.ts:revokeSalonGrantsForUser (kasuje dane): lista DOKŁADNIE dzisiejsza", () => {
    expect(a.importers["session.ts:revokeSalonGrantsForUser"], DATA_DELETING_CONTRACT).toEqual([
      "src/app/api/employees/[id]/link-account/route.ts",
      "src/lib/temporary-access.ts",
    ]);
  });

  it("cron.ts:cleanupExpiredTemporaryAccess (kasuje dane): lista DOKŁADNIE dzisiejsza", () => {
    expect(a.importers["cron.ts:cleanupExpiredTemporaryAccess"], DATA_DELETING_CONTRACT).toEqual([
      "src/app/api/cron/cleanup-temporary-access/route.ts",
      "src/lib/temporary-access.ts",
    ]);
  });

  it("auth-throttle.ts:clearSignInFailures (kasuje dane): lista DOKŁADNIE dzisiejsza", () => {
    expect(a.importers["auth-throttle.ts:clearSignInFailures"], DATA_DELETING_CONTRACT).toEqual([
      "src/lib/auth-rate-limit-options.ts",
    ]);
  });

  it("notifications.ts:deleteUndeliverablePushSubscriptions (kasuje dane): lista DOKŁADNIE — tylko push.ts", () => {
    expect(a.importers["notifications.ts:deleteUndeliverablePushSubscriptions"], DATA_DELETING_CONTRACT).toEqual([
      "src/lib/push.ts",
    ]);
  });

  it("deposits-cleanup.ts:cleanupStaleDepositBookings (anuluje wizyty i płatności w wielu salonach): lista DOKŁADNIE — tylko trasa crona", () => {
    expect(a.importers["deposits-cleanup.ts:cleanupStaleDepositBookings"], IRREVERSIBLE_STATE_CONTRACT).toEqual([
      "src/app/api/cron/cleanup-pending-deposits/route.ts",
    ]);
  });

  it("zamknięta lista modułów pośrednich (re-eksport wartości z system/**)", () => {
    expect(a.intermediates, INTERMEDIATE_CONTRACT).toEqual(INTERMEDIATE_MODULES);
  });

  it("moduły rejestru dla W1/W3 = system/** + opakowujące + wyliczone pośrednie", () => {
    const systemFiles = a.registryModules.filter(isSystem);
    expect(systemFiles.length).toBeGreaterThan(0);
    expect(a.registryModules).toEqual([...new Set([...systemFiles, ...REGISTRY_ADJACENT, ...a.intermediates])].sort());
  });

  it("W1: brak import * / export * / export * as z modułów rejestru", () => {
    expect(a.w1, "przestrzeń nazw modułu rejestru omija migawkę importerów (#193 L7) — importuj nazwy").toEqual([]);
  });

  it("W3: brak import()/require()/import = require() modułów rejestru, createRequire i <x>.require w src/ poza system/**", () => {
    expect(a.w3, "import dynamiczny lub require omija migawkę importerów (#193 L7) — użyj importu statycznego").toEqual([]);
  });
});
