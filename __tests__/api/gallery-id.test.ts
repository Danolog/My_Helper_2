/**
 * Integration tests for /api/gallery/[id] — tenant isolation (P0-A IDOR).
 *
 * Regression for the gap found in the P0 security review (point P0-A):
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

// PATCH/DELETE: kontekst salonu (salons.ownerId / employees.userId) — rola
// z ctx.role, nigdy z user.role. Flip per test.
const mockGetSalonContext = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: (...args: unknown[]) => mockGetSalonContext(...args),
}));

// GET nadal używa getUserSalonId.
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
    // assertSalonRefs (PATCH employeeId/serviceId) importuje wszystkie tabele refów.
    clients: createTable("clients"),
    serviceCategories: createTable("serviceCategories"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  // `sql` używa warstwa repo (forSalon): sql`...` do set_config oraz
  // sql.raw(...) do SET LOCAL ROLE (naprawa W2) — mock musi mieć oba.
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
}));

// fs unlink must never be reached on a foreign-salon DELETE.
const mockUnlink = vi.fn().mockResolvedValue(undefined);
vi.mock("fs/promises", () => ({
  default: { unlink: (...args: unknown[]) => mockUnlink(...args) },
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

// Walidacja prawdziwa (bez mocka): PATCH zapisuje wyłącznie sparsowane
// wartości schematu, więc pusty mock schematu nie ma już sensu. Kontrakt
// i allowlista: __tests__/api/gallery-security.test.ts.

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

const PHOTO_UUID = TEST_IDS.VALID_UUID;

// Właściciel salonu A rozpoznany po salons.ownerId (ctx.role "owner") — konto
// BEZ user.role, jak 30/31 właścicieli na produkcji.
function ownerSession() {
  return { user: { id: "owner-salon-a" } };
}
const ownerCtx = {
  salonId: TEST_IDS.SALON_UUID,
  role: "owner",
  employeeId: null,
  userId: "owner-salon-a",
};
// Pracownik salonu A z user.role="owner" na koncie — rola konta nic nie daje.
function staffSession() {
  return { user: { id: "staff-a", role: "owner" } };
}
const staffCtx = {
  salonId: TEST_IDS.SALON_UUID,
  role: "employee",
  employeeId: "emp-staff-a",
  userId: "staff-a",
};

// =======================================================
// P0-A · Tenant isolation regression (IDOR) — gallery/[id]
// =======================================================
describe("P0-A tenant isolation — /api/gallery/[id] PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue(ownerCtx);
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
    expect(mockGetSalonContext).toHaveBeenCalled();
    // Mutation must never run on a foreign record.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when the caller has no salon and never queries", async () => {
    mockGetSalonContext.mockResolvedValue(null);

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
    mockGetSalonContext.mockResolvedValue(ownerCtx);
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
    expect(mockGetSalonContext).toHaveBeenCalled();
    // Neither the row delete nor the disk unlink may run on a foreign record.
    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) when the caller has no salon and never queries", async () => {
    mockGetSalonContext.mockResolvedValue(null);

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

// =======================================================
// Rola z kontekstu salonu (ctx.role), nie z user.role
// =======================================================
describe("gallery/[id] — uprawnienia z ctx.role, nie z user.role", () => {
  const foreignEmployeePhoto = {
    id: PHOTO_UUID,
    salonId: TEST_IDS.SALON_UUID,
    employeeId: "emp-someone-else",
    beforePhotoUrl: null,
    afterPhotoUrl: null,
  };
  const ownStaffPhoto = { ...foreignEmployeePhoto, employeeId: "emp-staff-a" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("PATCH: właściciel bez user.role edytuje zdjęcie innego pracownika swojego salonu", async () => {
    mockGetSession.mockResolvedValue(ownerSession());
    mockGetSalonContext.mockResolvedValue(ownerCtx);
    mockDbSelect
      .mockReturnValueOnce(chainMock([foreignEmployeePhoto]))
      .mockReturnValueOnce(chainMock([foreignEmployeePhoto]));
    mockDbUpdate.mockReturnValue(chainMock([foreignEmployeePhoto]));

    const response = await patchPhoto(
      createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
        method: "PATCH",
        body: { description: "owner edit" },
      }),
      createRouteParams(PHOTO_UUID)
    );

    expect(response.status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("DELETE: właściciel bez user.role usuwa zdjęcie innego pracownika swojego salonu", async () => {
    mockGetSession.mockResolvedValue(ownerSession());
    mockGetSalonContext.mockResolvedValue(ownerCtx);
    mockDbSelect.mockReturnValue(chainMock([foreignEmployeePhoto]));
    mockDbDelete.mockReturnValue(chainMock([]));

    const response = await deletePhoto(
      createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, { method: "DELETE" }),
      createRouteParams(PHOTO_UUID)
    );

    expect(response.status).toBe(200);
    expect(mockDbDelete).toHaveBeenCalled();
  });

  it("PATCH: pracownik z user.role='owner' NIE edytuje cudzego zdjęcia (403)", async () => {
    mockGetSession.mockResolvedValue(staffSession());
    mockGetSalonContext.mockResolvedValue(staffCtx);
    mockDbSelect.mockReturnValue(chainMock([foreignEmployeePhoto]));

    const response = await patchPhoto(
      createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
        method: "PATCH",
        body: { description: "x" },
      }),
      createRouteParams(PHOTO_UUID)
    );

    expect(response.status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("DELETE: pracownik z user.role='owner' NIE usuwa cudzego zdjęcia (403, bez unlink)", async () => {
    mockGetSession.mockResolvedValue(staffSession());
    mockGetSalonContext.mockResolvedValue(staffCtx);
    mockDbSelect.mockReturnValue(chainMock([foreignEmployeePhoto]));

    const response = await deletePhoto(
      createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, { method: "DELETE" }),
      createRouteParams(PHOTO_UUID)
    );

    expect(response.status).toBe(403);
    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("PATCH: pracownik edytuje własne zdjęcie", async () => {
    mockGetSession.mockResolvedValue(staffSession());
    mockGetSalonContext.mockResolvedValue(staffCtx);
    mockDbSelect
      .mockReturnValueOnce(chainMock([ownStaffPhoto]))
      .mockReturnValueOnce(chainMock([ownStaffPhoto]));
    mockDbUpdate.mockReturnValue(chainMock([ownStaffPhoto]));

    const response = await patchPhoto(
      createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_UUID}`, {
        method: "PATCH",
        body: { description: "own edit" },
      }),
      createRouteParams(PHOTO_UUID)
    );

    expect(response.status).toBe(200);
  });
});
