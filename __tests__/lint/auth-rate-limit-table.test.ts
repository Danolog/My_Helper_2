// @vitest-environment node
/**
 * Tabela liczników limitu prób logowania jest dostępna wyłącznie przez wyjście
 * systemowe `src/lib/server/system/auth-throttle.ts` (surowy SQL na puli
 * systemowej). Symbol tabeli z `schema.ts` (`authRateLimitTable`; nie mylić
 * z limiterem `authRateLimit` w `src/lib/rate-limit.ts`) nie jest używany nigdzie w `src/`
 * (ani przez adapter auth, ani przez kod żądań), a nazwa tabeli w SQL pojawia
 * się tylko w schemacie i w tym module.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const SCHEMA = "src/lib/schema.ts";
const MODULE = "src/lib/server/system/auth-throttle.ts";

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(c|m)?(t|j)sx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = walk(SRC).map((abs) => ({
  rel: path.relative(ROOT, abs).split(path.sep).join("/"),
  text: fs.readFileSync(abs, "utf8"),
}));

describe("dostęp do tabeli auth_rate_limit", () => {
  it("symbol authRateLimitTable występuje tylko w schema.ts", () => {
    const users = files.filter((f) => /\bauthRateLimitTable\b/.test(f.text)).map((f) => f.rel);
    expect(users).toEqual([SCHEMA]);
  });

  it("nazwa tabeli auth_rate_limit występuje tylko w schema.ts i w module wyjścia systemowego", () => {
    const users = files.filter((f) => /\bauth_rate_limit\b/.test(f.text)).map((f) => f.rel).sort();
    expect(users).toEqual([SCHEMA, MODULE].sort());
  });

  it("adapter auth nie obejmuje tabeli", () => {
    const adapter = files.find((f) => f.rel === "src/lib/server/system/auth-adapter.ts");
    expect(adapter).toBeDefined();
    expect(adapter!.text).not.toMatch(/authRateLimitTable|auth_rate_limit/);
  });
});
