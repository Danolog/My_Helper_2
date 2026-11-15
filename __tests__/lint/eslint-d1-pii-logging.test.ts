// @vitest-environment node
/**
 * D1 (Ryan): reguła `no-restricted-syntax` z eslint.config.mjs blokuje ręczne
 * wyciąganie `params`/`detail` z obiektu błędu (dane osobowe z INSERT-a).
 * Test uruchamia PRAWDZIWĄ konfigurację repo na kodzie w pamięci — zmiana
 * selektora albo poziomu (error → warn/off) czerwieni test.
 */
import path from "node:path";
import { ESLint } from "eslint";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const FILE = path.join(ROOT, "src/lib/__d1-fixture__.ts");
const D1_TEXT = "Parametry zapytania i `detail` Postgresa zawierają dane osobowe";

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.config.mjs") });
}, 60_000);

async function d1Errors(code: string) {
  const [result] = await eslint.lintText(code, { filePath: FILE });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("D1: params/detail błędu nie trafiają do logu ręcznie", () => {
  it.each([
    ["error.params", "export function f(error: any) { return error.params; }"],
    ["err.detail", "export function f(err: any) { return err.detail; }"],
    ["e.cause.detail", "export function f(e: any) { return e.cause.detail; }"],
    ["x.cause.params", "export function f(x: any) { return x.cause.params; }"],
    ["const { params } = error", "export function f(error: any) { const { params } = error; return params; }"],
    ["const { detail } = e", "export function f(e: any) { const { detail } = e; return detail; }"],
  ])("%s → błąd D1 (severity error)", async (_name, code) => {
    const msgs = await d1Errors(code);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.severity).toBe(2);
    expect(msgs[0]?.message).toContain(D1_TEXT);
  }, 30_000);

  it("routeCtx.params (parametry trasy w api-handler.ts) przechodzi", async () => {
    const msgs = await d1Errors(
      "export async function f(routeCtx: { params: Promise<unknown> }) { return await routeCtx.params; }"
    );
    expect(msgs).toHaveLength(0);
  }, 30_000);

  it("src/lib/api-handler.ts w repo nie łamie D1", async () => {
    const [result] = await eslint.lintFiles([path.join(ROOT, "src/lib/api-handler.ts")]);
    expect(result).toBeDefined();
    expect((result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(0);
  }, 30_000);
});
