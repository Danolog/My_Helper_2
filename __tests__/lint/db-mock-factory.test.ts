// @vitest-environment node
/**
 * #193 P0b: żaden plik testu nie mockuje modułu `db` bez fabryki.
 *
 * Automock (`vi.mock("@/lib/db")`) i `{ spy: true }` ładują prawdziwy moduł i
 * przechodzą po eksporcie, a leniwe Proxy `db` tworzy wtedy klienta: bez
 * adresu bazy rzuca, z adresem łączy się z prawdziwą bazą. Bezpiecznik
 * `dbSystem` w `__tests__/setup.ts` zakłada, że `db` jest albo prawdziwym
 * Proxy, albo obiektem z fabryki testu — automock łamie to założenie.
 *
 * Moduł rozpoznawany po aliasie `@/lib/db` i ścieżkach względnych
 * rozwiązywanych do `src/lib/db`. Naruszenie = `vi.mock`/`vi.doMock` bez
 * drugiego argumentu albo z drugim argumentem, który nie jest funkcją.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DB_MODULE = path.join(ROOT, "src/lib/db");
const MOCK_FNS = new Set(["mock", "doMock"]);

function stripExt(p: string): string {
  return p.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
}

function resolvesToDb(spec: string, fileAbs: string): boolean {
  let target: string;
  if (spec.startsWith("@/")) target = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) target = path.resolve(path.dirname(fileAbs), spec);
  else return false;
  return stripExt(target) === DB_MODULE;
}

/** Specyfikator modułu z pierwszego argumentu: literał, szablon bez podstawień albo `import("…")`. */
function moduleSpec(arg: ts.Expression | undefined): string | undefined {
  if (!arg) return undefined;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isCallExpression(arg) && arg.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return moduleSpec(arg.arguments[0]);
  }
  return undefined;
}

function isFactory(arg: ts.Expression | undefined): boolean {
  return !!arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
}

/** Zwraca opisy naruszeń `plik:linia  tekst wywołania`. */
function findDbMockWithoutFactory(source: string, fileAbs: string): string[] {
  const sf = ts.createSourceFile(fileAbs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "vi" &&
      MOCK_FNS.has(node.expression.name.text)
    ) {
      const spec = moduleSpec(node.arguments[0]);
      if (spec !== undefined && resolvesToDb(spec, fileAbs) && !isFactory(node.arguments[1])) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        out.push(`${path.relative(ROOT, fileAbs)}:${line}  ${node.getText(sf).split("\n")[0]}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string, accept: (rel: string) => boolean, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, accept, acc);
    else if (accept(path.relative(ROOT, abs))) acc.push(abs);
  }
  return acc;
}

const TEST_SOURCES = [
  ...walk(path.join(ROOT, "__tests__"), (rel) => /\.[cm]?[jt]sx?$/.test(rel)),
  ...walk(path.join(ROOT, "src"), (rel) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)),
];

describe("vi.mock modułu db wyłącznie z fabryką", () => {
  it("skan obejmuje pliki testów", () => {
    expect(TEST_SOURCES.length).toBeGreaterThan(100);
  });

  it("żaden plik testu nie mockuje @/lib/db bez fabryki (automock, { spy: true })", () => {
    const violations = TEST_SOURCES.flatMap((f) => findDbMockWithoutFactory(fs.readFileSync(f, "utf8"), f));
    expect(violations, "mockuj @/lib/db fabryką: vi.mock(\"@/lib/db\", () => ({ db: … }))").toEqual([]);
  }, 30_000);

  const probeFile = path.join(ROOT, "__tests__/lib/__probe__.test.ts");
  it.each([
    ["automock aliasu", `vi.mock("@/lib/db");`, 1],
    ["spy: true", `vi.mock("@/lib/db", { spy: true });`, 1],
    ["ścieżka względna", `vi.mock("../../src/lib/db");`, 1],
    ["import()", `vi.mock(import("@/lib/db"));`, 1],
    ["doMock", "vi.doMock(`@/lib/db`);", 1],
    ["fabryka strzałkowa", `vi.mock("@/lib/db", () => ({ db: {} }));`, 0],
    ["fabryka async", `vi.mock("@/lib/db", async () => ({ db: {} }));`, 0],
    ["inny moduł db-system", `vi.mock("@/lib/server/system/db-system");`, 0],
    ["moduł o podobnej nazwie", `vi.mock("@/lib/db-utils");`, 0],
    ["tekst w łańcuchu", `const s = 'vi.mock("@/lib/db")';`, 0],
  ] as const)("detektor: %s", (_name, code, expected) => {
    expect(findDbMockWithoutFactory(code, probeFile)).toHaveLength(expected);
  });
});
