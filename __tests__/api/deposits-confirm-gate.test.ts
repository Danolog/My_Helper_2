/**
 * POST /api/deposits/confirm — deweloperski symulator potwierdzenia zadatku.
 * Bramka (#106, C3): na KAŻDYM hostingu (Vercel `VERCEL=1`, Cloud Run
 * `K_SERVICE`) i przy NODE_ENV=production → 404, zanim cokolwiek się stanie
 * (zero odczytu body, zero confirmDepositPayment). Bramka hostingu stoi
 * pierwsza i nie zależy od NODE_ENV. W produkcji zadatek potwierdza
 * wyłącznie podpisany webhook Stripe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/deposits/confirm/route";
import { createMockRequest, parseResponse } from "./helpers";

const mockConfirm = vi.fn();
vi.mock("@/lib/deposit-confirmation", () => ({
  confirmDepositPayment: (...a: unknown[]) => mockConfirm(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: () => ({ success: true, reset: 0 }) },
  getClientIp: () => "127.0.0.1",
}));

const DEPOSIT_ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

function req() {
  return createMockRequest("http://localhost:3000/api/deposits/confirm", {
    method: "POST",
    body: { depositPaymentId: DEPOSIT_ID, sessionId: "cs_test_sim" },
  });
}

beforeEach(() => {
  mockConfirm.mockReset().mockResolvedValue({
    success: true,
    alreadyConfirmed: true,
  });
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("K_SERVICE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/deposits/confirm — bramka hostingu i produkcji", () => {
  it.each([
    ["Vercel, NODE_ENV=development", { VERCEL: "1", NODE_ENV: "development" }],
    ["Vercel, NODE_ENV=test", { VERCEL: "1", NODE_ENV: "test" }],
    ["Cloud Run, NODE_ENV=development", { K_SERVICE: "myhelper", NODE_ENV: "development" }],
    ["Cloud Run, NODE_ENV=production", { K_SERVICE: "myhelper", NODE_ENV: "production" }],
    ["lokalnie, NODE_ENV=production (pnpm start, serwer E2E)", { NODE_ENV: "production" }],
  ])("%s → 404 bez potwierdzenia", async (_label, env) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("lokalny pnpm dev (bez VERCEL/K_SERVICE, NODE_ENV=development) → symulator działa", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { status, body } = await parseResponse<{ success: boolean }>(await POST(req()));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockConfirm).toHaveBeenCalledWith(DEPOSIT_ID, expect.anything());
  });

  it.each(["0", "true", ""])("VERCEL=%j (nie \"1\") nie blokuje lokalnego dev", async (vercel) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", vercel);
    expect((await POST(req())).status).toBe(200);
  });

  it("K_SERVICE pusty/biały nie blokuje lokalnego dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("K_SERVICE", "  ");
    expect((await POST(req())).status).toBe(200);
  });
});
