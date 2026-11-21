/**
 * POST /api/clients/[id]/loyalty/redeem — kontrakt body z panelu
 * (client-loyalty-tab.tsx wysyła { rewardTierId, salonId }).
 * Wcześniej schemat wymagał { tierId, pointsToRedeem } i każde umorzenie
 * kończyło się 400 "Validation failed".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/clients/[id]/loyalty/redeem/route";
import { createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";

const SALON_ID = TEST_IDS.SALON_UUID;
const CLIENT_ID = TEST_IDS.CLIENT_UUID;

const mockSalonLimit = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockSalonLimit(...args),
        }),
      }),
    }),
  },
}));

const mockRaw = vi.fn();
const mockUpdateOwned = vi.fn();
vi.mock("@/lib/server/repository", () => ({
  forSalon: () => ({
    raw: (...args: unknown[]) => mockRaw(...args),
    updateOwned: (...args: unknown[]) => mockUpdateOwned(...args),
  }),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue("11111111-1111-1111-1111-111111111111"),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id" } },
    user: { id: "test-user-id" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));


const TIER = {
  id: "tier-1",
  name: "Rabat 10%",
  pointsRequired: 100,
  rewardType: "discount",
  rewardValue: 10,
  description: "",
};

function post(body: unknown) {
  return POST(
    createMockRequest(`http://localhost/api/clients/${CLIENT_ID}/loyalty/redeem`, {
      method: "POST",
      body,
    }),
    createRouteParams(CLIENT_ID)
  );
}

describe("POST /api/clients/[id]/loyalty/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSalonLimit.mockResolvedValue([
      { id: SALON_ID, settingsJson: { loyalty: { enabled: true, rewardTiers: [TIER] } } },
    ]);
    mockRaw
      .mockResolvedValueOnce([{ id: "loyalty-1", clientId: CLIENT_ID, salonId: SALON_ID, points: 150 }])
      .mockResolvedValueOnce([{ id: "tx-1" }]);
    mockUpdateOwned.mockResolvedValue(undefined);
  });

  it("body z panelu ({ rewardTierId, salonId }) przechodzi walidację i umarza punkty", async () => {
    const { status, body } = await parseResponse<{
      success: boolean;
      error?: string;
      data?: { redemption: { pointsSpent: number }; balance: { currentPoints: number } };
    }>(await post({ rewardTierId: "tier-1", salonId: SALON_ID }));

    expect(body.error).not.toBe("Validation failed");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.redemption.pointsSpent).toBe(100);
    expect(body.data!.balance.currentPoints).toBe(50);
    expect(mockUpdateOwned).toHaveBeenCalledTimes(1);
  });

  it("brak rewardTierId => 400 walidacji, bez zapisu", async () => {
    const { status, body } = await parseResponse<{ error: string; details: Record<string, string> }>(
      await post({ salonId: SALON_ID })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(body.details.rewardTierId).toBeDefined();
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("stary kształt { tierId, pointsToRedeem } => 400 walidacji, bez zapisu", async () => {
    const { status, body } = await parseResponse<{ error: string }>(
      await post({ tierId: "tier-1", pointsToRedeem: 100 })
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });

  it("nieznany rewardTierId => 404 (nie 400 walidacji)", async () => {
    const { status } = await parseResponse(await post({ rewardTierId: "nie-ma", salonId: SALON_ID }));
    expect(status).toBe(404);
    expect(mockUpdateOwned).not.toHaveBeenCalled();
  });
});
