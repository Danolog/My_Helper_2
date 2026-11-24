// @vitest-environment node
/**
 * Obserwator statusów Vercela (#110): limit wdrożeń ≠ porażka budowy.
 * Przykłady odpowiadają commitom z review #108 (komentarz 6895089747).
 */
import { describe, expect, it } from "vitest";
import { classifyVercelStatuses, EXIT_CODES } from "../../infra/ci/vercel-status.mjs";

const RATE = "Deployment rate limited — retry in 24 hours.";
const s = (state: string, description: string, t: string, context = "Vercel") => ({
  context,
  state,
  description,
  created_at: `2026-11-15T10:${t}:00Z`,
});

describe("classifyVercelStatuses", () => {
  it("limit: sam failure „rate limited” bez pending → rate-limited (nic o kodzie)", () => {
    expect(classifyVercelStatuses([s("failure", RATE, "00")])).toBe("rate-limited");
  });

  it("porażka budowy: pending „deploying”, potem failure → build-failed", () => {
    expect(
      classifyVercelStatuses([s("failure", "Deployment has failed", "05"), s("pending", "Vercel is deploying your app", "00")]),
    ).toBe("build-failed");
  });

  it("pending „deploying”, potem failure z opisem limitu → build-failed (wystartowała)", () => {
    expect(classifyVercelStatuses([s("pending", "Vercel is deploying your app", "00"), s("failure", RATE, "05")])).toBe(
      "build-failed",
    );
  });

  it("wdrożenie OK: pending, potem success → deployed", () => {
    expect(
      classifyVercelStatuses([s("pending", "Vercel is deploying your app", "00"), s("success", "Deployment has completed", "05")]),
    ).toBe("deployed");
  });

  it("tylko pending → in-progress", () => {
    expect(classifyVercelStatuses([s("pending", "Vercel is deploying your app", "00")])).toBe("in-progress");
  });

  it("failure bez pending i bez limitu → failed-other", () => {
    expect(classifyVercelStatuses([s("failure", "Something else", "00")])).toBe("failed-other");
  });

  it("statusy innych kontekstów są pomijane", () => {
    expect(classifyVercelStatuses([s("success", "ok", "00", "ci/quality-gate")])).toBe("no-vercel-status");
    expect(
      classifyVercelStatuses([s("pending", "Vercel is deploying your app", "00", "other"), s("failure", RATE, "05")]),
    ).toBe("rate-limited");
  });

  it("kody wyjścia: limit ≠ porażka budowy, obie ≠ 0", () => {
    expect(EXIT_CODES["rate-limited"]).not.toBe(EXIT_CODES["build-failed"]);
    expect(EXIT_CODES["build-failed"]).not.toBe(0);
    expect(EXIT_CODES.deployed).toBe(0);
  });
});
