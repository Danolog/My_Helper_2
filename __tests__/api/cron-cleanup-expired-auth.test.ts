/**
 * Cron retencji tabel auth: wygasłe sesje i rekordy weryfikacji.
 *
 * Strażniki trasy:
 * - sekret crona (requireCronSecret): brak nagłówka → 401, zły → 401,
 *   brak skonfigurowanego sekretu → 500 (fail-closed), wyjście niewołane;
 * - liczniki w odpowiedzi pochodzą z wyjścia systemowego;
 * - błąd wyjścia → 500 bez szczegółów błędu w odpowiedzi;
 * - GET zachowuje się jak POST.
 *
 * Zapytania i partie: __tests__/lib/system-auth-retention.test.ts; zachowanie
 * na prawdziwej bazie (granica, aktywne zostają, liczniki):
 * __tests__/pg/auth-retention.pg.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn() }));
vi.mock("@/lib/server/system", () => ({
  cleanupExpiredAuthRecords: (...a: unknown[]) => cleanup(...a),
}));

// Tylko moduł sesji: auth-middleware (bramka CRON_SECRET) zostaje prawdziwy.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import { GET, POST } from "@/app/api/cron/cleanup-expired-auth/route";

const CRON_URL = "http://localhost/api/cron/cleanup-expired-auth";
const SECRET = "test-cron-secret";

function cronRequest(method: "GET" | "POST", secret: string | null = SECRET) {
  return createMockRequest(CRON_URL, {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe("/api/cron/cleanup-expired-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    cleanup.mockResolvedValue({ deletedSessions: 0, deletedVerifications: 0, complete: true });
  });

  it("401 bez nagłówka z sekretem", async () => {
    const { status } = await parseResponse(await POST(cronRequest("POST", null)));
    expect(status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("401 ze złym sekretem", async () => {
    const { status } = await parseResponse(await POST(cronRequest("POST", "wrong-secret")));
    expect(status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("500, gdy CRON_SECRET nie jest skonfigurowany (fail-closed)", async () => {
    delete process.env.CRON_SECRET;
    const { status } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("200 z poprawnym sekretem: liczniki z wyjścia", async () => {
    cleanup.mockResolvedValue({ deletedSessions: 3, deletedVerifications: 2, complete: true });

    const { status, body } = await parseResponse(await POST(cronRequest("POST")));

    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      deletedSessions: 3,
      deletedVerifications: 2,
      complete: true,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("200 przy zerze do skasowania", async () => {
    const { status, body } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, deletedSessions: 0, deletedVerifications: 0 });
  });

  it("przebieg przerwany limitem partii → complete: false w odpowiedzi", async () => {
    cleanup.mockResolvedValue({ deletedSessions: 50_000, deletedVerifications: 0, complete: false });
    const { status, body } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(200);
    expect(body.complete).toBe(false);
  });

  it("500 przy błędzie wyjścia, bez treści błędu w odpowiedzi", async () => {
    cleanup.mockRejectedValue(new Error("boom secret-detail"));
    const { status, body } = await parseResponse(await POST(cronRequest("POST")));
    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret-detail");
  });

  it("GET zachowuje się jak POST", async () => {
    cleanup.mockResolvedValue({ deletedSessions: 1, deletedVerifications: 1, complete: true });
    const { status, body } = await parseResponse(await GET(cronRequest("GET")));
    expect(status).toBe(200);
    expect(body.deletedSessions).toBe(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("GET bez sekretu → 401", async () => {
    const { status } = await parseResponse(await GET(cronRequest("GET", null)));
    expect(status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
