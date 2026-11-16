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

// Łańcuch importów: auth.ts → fabryka → wyjścia systemowe (§10d pkt 1).
// Wykrywanie po specyfikatorze modułu w tekście (import, export from, import(), require).
const FACTORY = "src/lib/auth-rate-limit-options.ts";
const AUTH = "src/lib/auth.ts";
const SYSTEM_INDEX = "src/lib/server/system/index.ts";
const specifierRe = (name: string) => new RegExp(`["'\`][^"'\`\\n]*/${name}(?:\\.[cm]?[jt]sx?)?["'\`]`);
/** Kod bez komentarzy (ścieżki w komentarzach dokumentacyjnych to nie importy). */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const codeFiles = files.map((f) => ({ rel: f.rel, text: code(f.text) }));

describe("kto importuje fabrykę i wyjścia limitu logowania", () => {
  it("fabrykę auth-rate-limit-options importuje w src/ wyłącznie auth.ts", () => {
    const importers = codeFiles
      .filter((f) => f.rel !== FACTORY && specifierRe("auth-rate-limit-options").test(f.text))
      .map((f) => f.rel);
    expect(importers).toEqual([AUTH]);
  });

  it("moduł system/auth-throttle wskazuje bezpośrednio wyłącznie fabryka (i re-eksport w index.ts rejestru)", () => {
    const importers = codeFiles
      .filter((f) => f.rel !== MODULE && specifierRe("auth-throttle").test(f.text))
      .map((f) => f.rel)
      .sort();
    expect(importers).toEqual([FACTORY, SYSTEM_INDEX].sort());
  });

  it("auth.ts nie importuje rejestru system/ ani wyjść limitu bezpośrednio", () => {
    const auth = codeFiles.find((f) => f.rel === AUTH)!;
    expect(auth.text).not.toMatch(specifierRe("auth-throttle"));
    expect(auth.text).not.toMatch(/\b(consumeAuthRateLimit|reserveAccountSignInAttempt|clearSignInFailures)\b/);
  });

  it("migawka L7: dokładnie trzy wyjścia auth-throttle, każde importowane wyłącznie przez fabrykę", () => {
    const l7 = fs.readFileSync(path.join(ROOT, "__tests__/lint/system-importers.test.ts"), "utf8");
    const entries = [...l7.matchAll(/^\s*"(auth-throttle\.ts:[A-Za-z]+)":\s*(\[[^\]]*\]),/gm)].map((m) => [
      m[1],
      JSON.parse(m[2]!) as string[],
    ]);
    expect(Object.fromEntries(entries)).toEqual({
      "auth-throttle.ts:clearSignInFailures": [FACTORY],
      "auth-throttle.ts:consumeAuthRateLimit": [FACTORY],
      "auth-throttle.ts:reserveAccountSignInAttempt": [FACTORY],
    });
  });
});
