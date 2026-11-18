/**
 * One default model identifier for text AI features.
 *
 * - `getAIModel()` returns `OPENROUTER_MODEL` when set and non-empty,
 *   otherwise `DEFAULT_AI_MODEL`.
 * - The business chat and the review alerts route take the model from
 *   `getAIModel()` and do not carry their own default or env read.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_AI_MODEL, getAIModel } from "@/lib/ai/openrouter";

// vi.mock calls are hoisted above the imports.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/schema", () => ({ aiGeneratedMedia: {}, salons: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/ai/gate", () => ({
  isProAIError: vi.fn(),
  requireProAI: vi.fn(),
  requireProPlan: vi.fn(),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter: vi.fn() }));

describe("getAIModel()", () => {
  const original = process.env.OPENROUTER_MODEL;

  beforeEach(() => {
    delete process.env.OPENROUTER_MODEL;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = original;
  });

  it("returns DEFAULT_AI_MODEL when OPENROUTER_MODEL is not set", () => {
    expect(getAIModel()).toBe(DEFAULT_AI_MODEL);
  });

  it("returns OPENROUTER_MODEL when it is set", () => {
    process.env.OPENROUTER_MODEL = "test-provider/override-model";
    expect(getAIModel()).toBe("test-provider/override-model");
  });

  it("returns DEFAULT_AI_MODEL when OPENROUTER_MODEL is an empty string", () => {
    process.env.OPENROUTER_MODEL = "";
    expect(getAIModel()).toBe(DEFAULT_AI_MODEL);
  });
});

describe("DEFAULT_AI_MODEL", () => {
  it("is anthropic/claude-sonnet-5.5", () => {
    expect(DEFAULT_AI_MODEL).toBe("anthropic/claude-sonnet-5.5");
  });
});

describe("callers take the model from getAIModel()", () => {
  const SOURCES = [
    "src/lib/ai/business/chat.ts",
    "src/app/api/ai/business/review-alerts/route.ts",
  ];

  for (const file of SOURCES) {
    it(`${file} has no model literal and no direct OPENROUTER_MODEL read`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toContain("anthropic/claude-");
      expect(source).not.toContain("process.env.OPENROUTER_MODEL");
      expect(source).toContain("getAIModel()");
    });
  }
});
