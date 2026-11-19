// @vitest-environment node
/**
 * Reguła `no-restricted-syntax` z eslint.config.mjs: pierwszy argument
 * `logger.error|warn|info|debug(...)` (komunikat) nie niesie treści błędu.
 * Komunikat nie przechodzi przez redakcję kontekstu, więc treść błędu podaje
 * się w drugim argumencie. Test uruchamia PRAWDZIWĄ konfigurację repo na
 * kodzie w pamięci — zmiana selektora albo poziomu (error → warn/off)
 * czerwieni test.
 */
import path from "node:path";
import { ESLint } from "eslint";
import { describe, it, expect, beforeAll } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const FILE = path.join(ROOT, "src/lib/__logger-message-fixture__.ts");
const RULE_TEXT = "Treść błędu podaje się w kontekście loggera";

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, overrideConfigFile: path.join(ROOT, "eslint.config.mjs") });
}, 60_000);

async function ruleMessages(code: string) {
  const [result] = await eslint.lintText(code, { filePath: FILE });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

const HEAD = 'import { logger } from "@/lib/logger";\n';

describe("komunikat loggera bez treści błędu", () => {
  it.each([
    ["szablon z error.message", "export function f(error: Error) { logger.error(`Padło: ${error.message}`); }"],
    ["szablon z err.stack", "export function f(err: Error) { logger.warn(`Padło: ${err.stack}`); }"],
    ["szablon z x?.message", "export function f(x?: Error) { logger.info(`Padło: ${x?.message}`); }"],
    ["szablon z identyfikatorem error", "export function f(error: unknown) { logger.error(`Padło: ${error}`); }"],
    ["szablon z identyfikatorem err", "export function f(err: unknown) { logger.debug(`Padło: ${err}`); }"],
    ["szablon z identyfikatorem e", "export function f(e: unknown) { logger.warn(`Padło: ${e}`); }"],
    ["szablon z String(...)", "export function f(x: unknown) { logger.error(`Padło: ${String(x)}`); }"],
    ["konkatenacja z .message", 'export function f(e: Error) { logger.error("Padło: " + e.message); }'],
    ["konkatenacja z .stack w środku", 'export function f(e: Error) { logger.error("Padło: " + e.stack + " koniec"); }'],
    ["konkatenacja z identyfikatorem err", 'export function f(err: unknown) { logger.info("Padło: " + err); }'],
    ["konkatenacja ze String(...)", 'export function f(x: unknown) { logger.warn("a" + 1 + String(x)); }'],
  ])("%s → błąd (severity error)", async (_name, code) => {
    const msgs = await ruleMessages(HEAD + code);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.severity).toBe(2);
    expect(msgs[0]?.message).toContain(RULE_TEXT);
  }, 30_000);

  it.each([
    ["stały napis", 'export function f() { logger.error("Padło"); }'],
    ["szablon z identyfikatorem salonu i licznikiem", "export function f(salonId: string, count: number) { logger.info(`Salon ${salonId}: ${count}`); }"],
    ["błąd w kontekście", 'export function f(error: unknown) { logger.error("x", { error }); }'],
    [".message w drugim argumencie", 'export function f(e: Error) { logger.error("x", { error: e.message }); }'],
    ["szablon z .message w drugim argumencie", "export function f(e: Error) { logger.warn(\"x\", `${e.message}` as never); }"],
    ["konkatenacja bez treści błędu", 'export function f(salonId: string) { logger.info("Salon " + salonId); }'],
    [
      "wywołanie na obiekcie innym niż logger",
      "const audit = { error: (_m: string) => undefined }; export function f(e: Error) { audit.error(`Padło: ${e.message}`); }",
    ],
  ])("%s → przechodzi", async (_name, code) => {
    expect(await ruleMessages(HEAD + code)).toHaveLength(0);
  }, 30_000);
});
