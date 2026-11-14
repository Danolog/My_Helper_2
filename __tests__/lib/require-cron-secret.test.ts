/**
 * requireCronSecret — brama tras cronowych.
 * Kontrakt:
 *   - brak CRON_SECRET w env => 500,
 *   - brak / zly / inna dlugosc naglowka => 401 (bez wyjatku z timingSafeEqual),
 *   - poprawny "Bearer <secret>" => null,
 *   - porownanie czasowo-stale (timingSafeEqual), nie `===`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { timingSafeEqualSpy } = vi.hoisted(() => ({ timingSafeEqualSpy: vi.fn() }));

// Node builtin bywa rozwiazywany jako "node:crypto" albo "crypto" — mockujemy oba
// (vi.mock jest hoistowany, wiec fabryki musza byc inline).
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, default: { ...actual, timingSafeEqual: timingSafeEqualSpy }, timingSafeEqual: timingSafeEqualSpy };
});
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, default: { ...actual, timingSafeEqual: timingSafeEqualSpy }, timingSafeEqual: timingSafeEqualSpy };
});

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { requireCronSecret } from "@/lib/auth-middleware";

const SECRET = "s3cr3t-cron-value-1234567890";

function req(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost:3000/api/cron/test", { headers });
}

describe("requireCronSecret", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("zwraca 500, gdy CRON_SECRET nie jest skonfigurowany", async () => {
    delete process.env.CRON_SECRET;
    const res = await requireCronSecret(req(`Bearer ${SECRET}`));
    expect(res?.status).toBe(500);
  });

  it("przepuszcza poprawny naglowek Bearer", async () => {
    expect(await requireCronSecret(req(`Bearer ${SECRET}`))).toBeNull();
  });

  it("zwraca 401 bez naglowka authorization", async () => {
    const res = await requireCronSecret(req());
    expect(res?.status).toBe(401);
  });

  it("zwraca 401 dla zlego sekretu o tej samej dlugosci", async () => {
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith("0") ? "1" : "0");
    const res = await requireCronSecret(req(`Bearer ${wrong}`));
    expect(res?.status).toBe(401);
  });

  it("zwraca 401 (nie rzuca) dla naglowka o innej dlugosci", async () => {
    const res = await requireCronSecret(req(`Bearer ${SECRET}x`));
    expect(res?.status).toBe(401);
  });

  it("porownuje sekret czasowo-stale (timingSafeEqual)", async () => {
    await requireCronSecret(req(`Bearer ${SECRET}`));
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });
});
