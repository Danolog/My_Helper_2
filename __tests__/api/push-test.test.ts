/**
 * POST /api/push/test — rekord `notifications` w salonie z sesji, odpowiedź
 * bez szczegółów.
 *
 * Przed poprawką trasa brała `select id from salons limit 1` — pierwszy salon
 * z bazy, czyli zapis do cudzego tenanta (P2, audyt bezpieczeństwa). Odpowiedź zwracała cały
 * PushResult, w tym `error` z treścią wyjątku i `notificationId`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const USER = { id: "user-a", name: "Anna", email: "anna@example.com" };
const SALON_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const { mockSendPush, mockResolveSalonContext } = vi.hoisted(() => ({
  mockSendPush: vi.fn(),
  mockResolveSalonContext: vi.fn(),
}));

// Gdyby trasa znów sięgnęła po "pierwszy salon z bazy", dostanie cudzy.
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy"]) c[m] = vi.fn(() => c);
  c.then = (resolve: (v: unknown[]) => unknown) => resolve([{ id: SALON_FOREIGN }]);
  return c;
}
vi.mock("@/lib/db", () => ({ db: { select: () => chain() } }));

vi.mock("@/lib/push", () => ({
  NO_SUBSCRIPTIONS_ERROR: "No subscriptions",
  sendPushNotification: (...args: unknown[]) => mockSendPush(...args),
}));

vi.mock("@/lib/salon-context", () => ({
  resolveSalonContext: (...args: unknown[]) => mockResolveSalonContext(...args),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ user: USER, session: {} })),
  isAuthError: (r: unknown) => r instanceof Response,
}));

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: () => ({ success: true, reset: 0 }) },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/push/test/route";

async function callTest() {
  return parseResponse<{ success: boolean; data: Record<string, unknown> }>(
    await POST(createMockRequest("http://localhost:3000/api/push/test", { method: "POST" }))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveSalonContext.mockResolvedValue({
    ctx: { salonId: SALON_OWN, role: "owner", employeeId: null, userId: USER.id },
  });
  mockSendPush.mockResolvedValue({ success: true, sent: 1, failed: 0, notificationId: "n-1" });
});

describe("POST /api/push/test — salon z sesji", () => {
  it("zapisuje rekord w salonie użytkownika, nie w pierwszym salonie z bazy", async () => {
    const { status } = await callTest();
    expect(status).toBe(200);
    expect(mockSendPush).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ salonId: SALON_OWN })
    );
    expect(mockResolveSalonContext).toHaveBeenCalledWith(USER.id);
  });

  it("konto bez salonu: push idzie, bez rekordu w cudzym salonie", async () => {
    mockResolveSalonContext.mockResolvedValue({ ctx: null, reason: "none" });
    await callTest();
    expect(mockSendPush).toHaveBeenCalledWith(USER.id, expect.objectContaining({ salonId: null }));
  });

  it("konto z niejednoznacznym salonem: salonu nie zgadujemy", async () => {
    mockResolveSalonContext.mockResolvedValue({ ctx: null, reason: "ambiguous" });
    await callTest();
    expect(mockSendPush).toHaveBeenCalledWith(USER.id, expect.objectContaining({ salonId: null }));
  });
});

describe("POST /api/push/test — odpowiedź bez wyroczni", () => {
  it("sukces: tylko łączne liczby", async () => {
    const { body } = await callTest();
    expect(body).toEqual({ success: true, data: { sent: 1, failed: 0 } });
  });

  it("błąd wysyłki: ogólny komunikat, bez treści wyjątku", async () => {
    mockSendPush.mockResolvedValue({
      success: false,
      sent: 0,
      failed: 2,
      error: "connect ECONNREFUSED 10.0.0.5:8443",
    });
    const { body } = await callTest();
    expect(body.success).toBe(false);
    expect(body.data).toEqual({
      sent: 0,
      failed: 2,
      error: "Nie udalo sie wyslac powiadomienia testowego",
    });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });

  it("brak subskrypcji: komunikat o braku urządzeń", async () => {
    mockSendPush.mockResolvedValue({ success: false, sent: 0, failed: 0, error: "No subscriptions" });
    const { body } = await callTest();
    expect(body.data.error).toBe("Brak zarejestrowanych urzadzen dla powiadomien push");
  });

  it("wyjątek trasy: 500 bez szczegółów", async () => {
    mockSendPush.mockRejectedValue(new Error("db host 10.0.0.9 down"));
    const { status, body } = await callTest();
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("10.0.0.9");
  });
});
