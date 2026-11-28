/**
 * Strażnik bramki tras AI (statyczny odczyt źródeł, wzorzec frozen-routes-guard).
 *
 * 1. Każda trasa pod src/app/api/ai/** woła requireProAI( albo requireProPlan(.
 * 2. Każda trasa w src/app/api/**, która woła model, woła requireProAI(
 *    (requireProPlan nie wystarcza — bez limitu zapytań i budżetu).
 * 3. Żadna trasa nie woła isProPlan( bezpośrednio.
 * 4. Każda trasa, która woła model, zapisuje zużycie (trackAIUsage().
 * 5. Wyjątki tylko z jawnej listy, z powodem; wpis, który przestał być
 *    potrzebny albo prawdziwy, czerwieni test.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import { frozenModuleForApiPath } from "@/lib/features";

const ROOT = process.cwd();
const API_DIR = join(ROOT, "src", "app", "api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (/^route\.(m|c)?[jt]sx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Kod bez komentarzy — komentarz z nazwą bramki nie może zaliczyć reguły. */
export function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Wywołanie albo import modelu (SDK AI, dostawca, helpery wołające model). */
export const MODEL_CALL =
  /\b(generateText|streamText|generateObject|streamObject|generateImage|streamBusinessChat|createAIClient|createOpenRouter|getChatModel)\s*\(|\bfrom\s*["'`](ai|@openrouter\/ai-sdk-provider|@google\/genai|@ai-sdk\/[^"'`]+)["'`]/;
const REQUIRE_PRO_AI = /\brequireProAI\s*\(/;
const REQUIRE_PRO_PLAN = /\brequireProPlan\s*\(/;
const IS_PRO_PLAN = /\bisProPlan\s*\(/;
const TRACK_USAGE = /\btrackAIUsage\s*\(/;
const FROZEN_GUARD = /\bfrozenModuleResponse\s*\(/;

type Route = { path: string; api: string; code: string };

const ROUTES: Route[] = routeFiles(API_DIR).map((file) => {
  const path = relative(ROOT, file).split(sep).join("/");
  const api = "/" + path.replace(/^src\/app\//, "").replace(/\/route\.(m|c)?[jt]sx?$/, "");
  return { path, api, code: codeOnly(readFileSync(file, "utf8")) };
});

const AI_ROUTES = ROUTES.filter((r) => r.path.startsWith("src/app/api/ai/"));
const MODEL_ROUTES = ROUTES.filter((r) => MODEL_CALL.test(r.code));

/**
 * Crony: bez sesji (CRON_SECRET), plan salonu sprawdzają przez isProPlan(salonId).
 * Zapis zużycia i budżet dla nich — osobna zmiana.
 */
const CRON_EXCEPTIONS: Record<string, string> = {
  "src/app/api/notifications/birthday/route.ts": "cron bez sesji, osobna zmiana",
  "src/app/api/notifications/we-miss-you/route.ts": "cron bez sesji, osobna zmiana",
};

/** Trasy zamrożone (404 przed bramką). Wpis pada, gdy moduł zostanie odmrożony. */
const FROZEN_NO_TRACK_EXCEPTIONS: Record<string, string> = {
  "src/app/api/ai/image/generate/route.ts": "zamrożone, zapis zużycia w R3-C",
  "src/app/api/ai/image/service-illustration/route.ts": "zamrożone, zapis zużycia w R3-C",
};

const isCron = (p: string) => p in CRON_EXCEPTIONS;

describe("strażnik bramki tras AI", () => {
  it("kontrola: skaner widzi trasy (test nie jest pusty)", () => {
    expect(ROUTES.length).toBeGreaterThan(100);
    expect(AI_ROUTES.length).toBeGreaterThan(15);
    expect(MODEL_ROUTES.length).toBeGreaterThan(10);
  });

  it("1. każda trasa pod api/ai/** woła requireProAI albo requireProPlan", () => {
    const missing = AI_ROUTES.filter(
      (r) => !REQUIRE_PRO_AI.test(r.code) && !REQUIRE_PRO_PLAN.test(r.code),
    ).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("2. każda trasa wołająca model woła requireProAI", () => {
    const missing = MODEL_ROUTES.filter(
      (r) => !isCron(r.path) && !REQUIRE_PRO_AI.test(r.code),
    ).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("3. żadna trasa nie woła isProPlan bezpośrednio", () => {
    const hits = ROUTES.filter(
      (r) => !isCron(r.path) && IS_PRO_PLAN.test(r.code),
    ).map((r) => r.path);
    expect(hits).toEqual([]);
  });

  it("4. każda trasa wołająca model zapisuje zużycie (trackAIUsage)", () => {
    const missing = MODEL_ROUTES.filter(
      (r) =>
        !isCron(r.path) &&
        !(r.path in FROZEN_NO_TRACK_EXCEPTIONS) &&
        !TRACK_USAGE.test(r.code),
    ).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  describe("5. lista wyjątków jest aktualna", () => {
    const byPath = new Map(ROUTES.map((r) => [r.path, r]));

    it.each(Object.keys(CRON_EXCEPTIONS))("cron %s istnieje, woła model i isProPlan", (path) => {
      const r = byPath.get(path);
      expect(r, path).toBeDefined();
      expect(MODEL_CALL.test(r!.code)).toBe(true);
      expect(IS_PRO_PLAN.test(r!.code)).toBe(true);
      expect(REQUIRE_PRO_AI.test(r!.code)).toBe(false);
    });

    it.each(Object.keys(FROZEN_NO_TRACK_EXCEPTIONS))(
      "%s nadal jest zamrożona i nadal potrzebuje wyjątku",
      (path) => {
        const r = byPath.get(path);
        expect(r, path).toBeDefined();
        // Odmrożenie modułu bez poprawki zapisu zużycia czerwieni ten test.
        expect(frozenModuleForApiPath(r!.api), r!.api).not.toBeNull();
        expect(FROZEN_GUARD.test(r!.code)).toBe(true);
        expect(MODEL_CALL.test(r!.code)).toBe(true);
        expect(TRACK_USAGE.test(r!.code), "zapis zużycia jest — usuń wpis z listy").toBe(false);
      },
    );

    it("każdy wpis ma powód", () => {
      for (const reason of [
        ...Object.values(CRON_EXCEPTIONS),
        ...Object.values(FROZEN_NO_TRACK_EXCEPTIONS),
      ]) {
        expect(reason.trim().length).toBeGreaterThan(5);
      }
    });
  });

  it("kontrola: reguły łapią warianty, a komentarz nie zalicza bramki", () => {
    for (const sample of [
      `const r = await generateText({ model });`,
      `return streamText({ model, messages });`,
      `import { generateText } from "ai";`,
      `import { createOpenRouter } from "@openrouter/ai-sdk-provider";`,
      `import { GoogleGenAI } from "@google/genai";`,
      `const img = await generateImage(prompt);`,
      `return streamBusinessChat({ salonId, apiKey, messages });`,
      `const model = getChatModel();`,
    ]) {
      expect(MODEL_CALL.test(sample), sample).toBe(true);
    }
    expect(MODEL_CALL.test(`import { aiRateLimit } from "@/lib/rate-limit";`)).toBe(false);
    expect(REQUIRE_PRO_AI.test(codeOnly(`// requireProAI({ op: "text" })\nconst x = 1;`))).toBe(false);
    expect(REQUIRE_PRO_AI.test(codeOnly(`/* requireProAI() */`))).toBe(false);
    expect(REQUIRE_PRO_PLAN.test(codeOnly(`const g = await requireProPlan();`))).toBe(true);
    expect(codeOnly(`const u = "https://x.test/a"; // c`)).toContain("https://x.test/a");
  });
});
