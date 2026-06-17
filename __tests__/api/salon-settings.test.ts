/**
 * P0-A · Authorization / tenant-isolation regression for salon-scoped
 * settings routes (`/api/salons/[id]/*-settings`).
 *
 * These routes are scoped to the salon OWNER: the handler loads the salon by
 * id and rejects with 403 when the authenticated user is not the owner. Before
 * the P0-A fix these routes mutated salon settings for ANY authenticated user.
 *
 * We use birthday-settings as the representative route — the other settings
 * routes (fiscal-settings, loyalty-settings, notification-type-settings,
 * we-miss-you-settings) share the identical owner-check pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, createRouteParams, parseResponse, TEST_IDS } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "_table") return name;
        return `${name}.${String(prop)}`;
      },
    });
  return { salons: createTable("salons") };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

// requireAuth returns the CALLER. Tests flip the caller's user id to simulate
// "owner" vs "another logged-in user".
const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/api-validation", () => ({
  validateBody: vi.fn().mockReturnValue(null),
  birthdaySettingsSchema: {},
}));

// -------------------------------------------------------
// Chain builder
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["select", "from", "where", "limit", "update", "set", "returning"];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  (chain as Record<string, unknown>).then = (resolve: (v: unknown[]) => unknown) => resolve(result);
  return chain;
}

const OWNER_ID = "owner-A";
const OTHER_USER_ID = "other-user-B";

import {
  GET as getBirthdaySettings,
  PUT as putBirthdaySettings,
} from "@/app/api/salons/[id]/birthday-settings/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("P0-A authorization — /api/salons/[id]/birthday-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns 200 for the salon owner", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );

    const request = createMockRequest(
      `http://localhost:3000/api/salons/${TEST_IDS.SALON_UUID}/birthday-settings`
    );
    const params = createRouteParams(TEST_IDS.SALON_UUID);
    const response = await getBirthdaySettings(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("GET returns 403 when an authenticated NON-owner reads another salon's settings", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );

    const request = createMockRequest(
      `http://localhost:3000/api/salons/${TEST_IDS.SALON_UUID}/birthday-settings`
    );
    const params = createRouteParams(TEST_IDS.SALON_UUID);
    const response = await getBirthdaySettings(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toContain("uprawnien");
  });

  it("PUT returns 403 when a NON-owner tries to mutate another salon's settings", async () => {
    mockRequireAuth.mockResolvedValue({ user: { id: OTHER_USER_ID } });
    mockDbSelect.mockReturnValue(
      chainMock([{ id: TEST_IDS.SALON_UUID, ownerId: OWNER_ID, settingsJson: {} }])
    );

    const request = createMockRequest(
      `http://localhost:3000/api/salons/${TEST_IDS.SALON_UUID}/birthday-settings`,
      {
        method: "PUT",
        body: {
          enabled: true,
          giftType: "discount",
          discountPercentage: 15,
          productName: "",
          customMessage: "hej",
          autoSend: false,
        },
      }
    );
    const params = createRouteParams(TEST_IDS.SALON_UUID);
    const response = await putBirthdaySettings(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(403);
    expect(body.success).toBe(false);
    // A forbidden caller must never reach the update.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});
