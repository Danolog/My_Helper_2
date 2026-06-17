/**
 * Integration tests for /api/gallery/[id] — tenant isolation (P0-A IDOR).
 *
 * Regression for the gap found in Ryan's review (07-ryan-review-p0.md):
 * GET was scoped to the caller's salon, but PATCH and DELETE were not — a
 * salon-A owner could edit/delete a salon-B photo (and unlink its file from
 * disk) by guessing the photo UUID, because authorization keyed off the role
 * ("owner") instead of salon membership.
 *
 * These tests pin the fix: the salon is derived from the session and a
 * foreign-salon photo is invisible (scoped WHERE -> empty -> 404), so the
 * mutation and the file unlink never run on another tenant's data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// `tx` deleguje do tych samych mocków co `db` — warstwa repo (forSalon) otwiera
// db.transaction() i woła tx.select/update/delete (ADR-001 R1). Asercje na
// mockDbSelect/Update/Delete działają po migracji trasy na repozytorium.
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  delete: (...args: unknown[]) => mockDbDelete(...args),
  execute: vi.fn().mockResolvedValue(undefined), // SET LOCAL app.current_salon_id
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

// Session: a logged-in salon-A owner (role grants no cross-tenant power).
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

// requireAuth is used by GET.
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

// Tenant resolver — flip per test to simulate "no salon" / wrong tenant.
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(TEST_IDS.SALON_UUID),
  getUserSalon: vi.fn().mockResolvedValue({ id: TEST_IDS.SALON_UUID }),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) => {
    const proxy = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "_table") return name;
          return `${name}.${String(prop)}`;
        },
      }
    );
    return proxy;
  };
  return {
    galleryPhotos: createTable("galleryPhotos"),
    employees: createTable("employees"),
    services: createTable("services"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  // `sql` używa warstwa repo (forSalon) do SET LOCAL app.current_salon_id.
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

// fs unlink must never be reached on a foreign-salon DELETE.
const mockUnlink = vi.fn().mockResolvedValue(undefined);
vi.mock("fs/promises", () => ({
  default: { unlink: (...args: unknown[]) => mockUnlink(...args) },
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock("@/lib/api-validation", () => ({
  validateBody: vi.fn().mockReturnValue(null),
  updateGalleryPhotoSchema: {},
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// -------------------------------------------------------
// Chain builder helper (mirrors __tests__/api/helpers chain shape)
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const methods = [
    "select", "from", "where", "leftJoin", "innerJoin",
    "limit", "orderBy", "groupBy",
    "insert", "values", "update", "set", "delete",
    "returning", "execute",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Import route handlers
// -------------------------------------------------------

import {
  PATCH as patchPhoto,
  DELETE as deletePhoto,
} from "@/app/api/gallery/[id]/route";

import { getUserSalonId } from "@/lib/get-user-salon";
const mockGetUserSalonId = vi.mocked(getUserSalonId);

const PHOTO_UUID = TEST_IDS.VALID_UUID;

// A salon-A owner session: role "owner" must NOT bypass salon scoping.
function ownerSession() {
  return { user: { id: "owner-salon-a", role: "owner" } };
}

// =======================================================
// P0-A · Tenant isolation regression (IDOR) — gallery/[id]
// =======================================================
describe("P0-A tenant isolation — /api/gallery/[id] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserSalonId.mockResolvedValue(TEST_IDS.SALON_UUID);
    mockGetSession.mockResolvedValue(ownerSession());
  });

  it("returns 404 for a photo owned by another salon (no cross-tenant edit)", async () => {
    // Scoped SELECT finds nothing -> foreign photo is invisible.
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
      method: "PATCH",
      body: { description: "hijack attempt" },
    });
    const response = await patchPhoto(request, createRouteParams(PHOTO_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
    // Mutation must never run on a foreign record.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when the caller has no salon and never queries", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
      method: "PATCH",
      body: { description: "x" },
    });
    const response = await patchPhoto(request, createRouteParams(PHOTO_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("allows the owner to edit a photo that belongs to their own salon", async () => {
    const ownPhoto = {
      id: PHOTO_UUID,
      salonId: TEST_IDS.SALON_UUID,
      employeeId: null,
      beforePhotoUrl: null,
      afterPhotoUrl: null,
    };
    // 1st SELECT (scoped fetch) -> own photo; UPDATE -> returning; 2nd SELECT (join) -> row.
    mockDbSelect
      .mockReturnValueOnce(chainMock([ownPhoto]))
      .mockReturnValueOnce(chainMock([ownPhoto]));
    mockDbUpdate.mockReturnValue(chainMock([ownPhoto]));

    const request = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
      method: "PATCH",
      body: { description: "legit edit" },
    });
    const response = await patchPhoto(request, createRouteParams(PHOTO_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDbUpdate).toHaveBeenCalled();
  });
});

describe("P0-A tenant isolation — /api/gallery/[id] DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserSalonId.mockResolvedValue(TEST_IDS.SALON_UUID);
    mockGetSession.mockResolvedValue(ownerSession());
  });

  it("returns 404 for a photo owned by another salon and never unlinks the file", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
      method: "DELETE",
    });
    const response = await deletePhoto(request, createRouteParams(PHOTO_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockGetUserSalonId).toHaveBeenCalled();
    // Neither the row delete nor the disk unlink may run on a foreign record.
    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when the caller has no salon and never queries", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const request = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
      method: "DELETE",
    });
    const response = await deletePhoto(request, createRouteParams(PHOTO_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("allows the owner to delete a photo that belongs to their own salon", async () => {
    const ownPhoto = {
      id: PHOTO_UUID,
      salonId: TEST_IDS.SALON_UUID,
      employeeId: null,
      beforePhotoUrl: null,
      afterPhotoUrl: null,
    };
    mockDbSelect.mockReturnValue(chainMock([ownPhoto]));
    mockDbDelete.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
      method: "DELETE",
    });
    const response = await deletePhoto(request, createRouteParams(PHOTO_UUID));
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDbDelete).toHaveBeenCalled();
  });
});
