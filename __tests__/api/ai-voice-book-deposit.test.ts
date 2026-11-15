/**
 * #63: POST /api/ai/voice/book — usługa z zadatkiem nie powstaje z rozmowy
 * bez wpłaty (moduł voiceAi zamrożony; reguła na wypadek odmrożenia).
 * Bez wyjątku dla personelu: sesja należy do salonu, wizytę zamawia rozmówca.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, createChainMock } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
const SERVICE = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), calc: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => h.select(...a),
    insert: (...a: unknown[]) => h.insert(...a),
  },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "owner" }, session: {} }),
  isAuthError: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue("11111111-1111-4111-8111-111111111111"),
}));
vi.mock("@/lib/subscription", () => ({ isProPlan: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));

import { POST } from "@/app/api/ai/voice/book/route";

function post() {
  return POST(
    createMockRequest("http://localhost:3000/api/ai/voice/book", {
      method: "POST",
      body: { serviceId: SERVICE, preferredDate: "2026-12-01", preferredTime: "10:00", callerPhone: "123456789" },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  // Step A: usługa salonu; kolejne zapytania (pracownik itd.) puste
  h.select
    .mockReturnValueOnce(
      createChainMock([{ id: SERVICE, name: "Koloryzacja", basePrice: "200", baseDuration: 60, salonId: SALON }])
    )
    .mockReturnValue(createChainMock([]));
});

describe("POST /api/ai/voice/book — zadatek (#63)", () => {
  it("usługa z zadatkiem → 400 DEPOSIT_REQUIRED przed doborem terminu, bez zapisu", async () => {
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 60, serviceName: "Koloryzacja" });

    const res = await post();
    const { status, body } = await parseResponse<{ code: string }>(res);

    expect(status).toBe(400);
    expect(body.code).toBe("DEPOSIT_REQUIRED");
    expect(h.select).toHaveBeenCalledTimes(1); // tylko Step A — bez pracownika i kolizji
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.calc).toHaveBeenCalledWith(
      expect.objectContaining({ salonId: SALON, serviceId: SERVICE, sessionUser: null })
    );
  });

  it("błąd wyliczenia → 503, bez zapisu", async () => {
    h.calc.mockRejectedValue(new Error("db down"));
    const res = await post();
    expect(res.status).toBe(503);
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("usługa bez zadatku → strażnik przepuszcza (trasa idzie dalej do doboru pracownika)", async () => {
    h.calc.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "Koloryzacja" });
    const res = await post();
    expect(res.status).not.toBe(503);
    expect(((await parseResponse<{ code?: string }>(res)).body).code).not.toBe("DEPOSIT_REQUIRED");
    expect(h.select.mock.calls.length).toBeGreaterThan(1);
  });
});
