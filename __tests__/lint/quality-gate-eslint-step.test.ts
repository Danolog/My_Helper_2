/**
 * Bramka CI uruchamia ESLint (`pnpm lint`) w jobie „TypeScript Check”.
 * Krok pada na błędach ESLint; ostrzeżenia nie blokują (brak --max-warnings).
 * Test pada, gdy krok zniknie, zostanie wyciszony albo przeniesiony poza job.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WF = readFileSync(join(ROOT, ".github/workflows/quality-gate.yml"), "utf8");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };

/** Treść joba najwyższego poziomu (wcięcie 2 spacje pod `jobs:`), bez linii komentarza. */
function job(name: string): string {
  const body = WF.slice(WF.indexOf("\njobs:\n") + 7);
  const heads = [...body.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)];
  const i = heads.findIndex((m) => m[1] === name);
  if (i < 0) return "";
  const end = i + 1 < heads.length ? heads[i + 1]!.index : body.length;
  return body
    .slice(heads[i]!.index, end)
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

/** Kroki joba (każdy zaczyna się od `      - `). */
const steps = (j: string) => j.slice(j.indexOf("\n    steps:\n")).split(/\n(?= {6}- )/).slice(1);
const runOf = (s: string) => s.match(/^\s*(?:- )?run:\s*(.+)$/m)?.[1]?.trim() ?? "";

describe("quality-gate.yml: krok ESLint", () => {
  const tc = job("typecheck");

  it("job typecheck istnieje i ma dokładnie jeden krok `pnpm lint`, po instalacji zależności", () => {
    expect(tc).toContain("name: TypeScript Check");
    const runs = steps(tc).map(runOf);
    expect(runs.filter((r) => r === "pnpm lint")).toHaveLength(1);
    expect(runs.indexOf("pnpm lint")).toBeGreaterThan(runs.indexOf("pnpm install --frozen-lockfile"));
    expect(runs.indexOf("pnpm install --frozen-lockfile")).toBeGreaterThanOrEqual(0);
  });

  it("krok ESLint nie jest wyciszony (bez continue-on-error, || true, if)", () => {
    const step = steps(tc).find((s) => runOf(s) === "pnpm lint")!;
    expect(step).not.toMatch(/continue-on-error|\|\|\s*true|^\s*if:/m);
    expect(tc).not.toMatch(/continue-on-error/);
  });

  it("skrypt lint: eslint bez --max-warnings — błędy blokują, ostrzeżenia nie", () => {
    expect(PKG.scripts.lint).toMatch(/^eslint\b/);
    expect(PKG.scripts.lint).not.toMatch(/--max-warnings|--quiet|\|\||;/);
  });
});
