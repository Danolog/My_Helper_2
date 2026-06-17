/**
 * Integration tests for /api/appointments/[id]/materials endpoints.
 *
 * Tests cover:
 * - GET /api/appointments/[id]/materials (list materials for appointment)
 * - POST /api/appointments/[id]/materials (add material with inventory deduction)
 * - DELETE /api/appointments/[id]/materials (remove material with inventory restore)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  makeAppointment,
  makeProduct,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// `tx` deleguje do tych samych mocków co `db` — warstwa repo (forSalon) otwiera
// db.transaction() i woła tx.select/update/delete/insert + tx.execute (SET LOCAL).
const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  insert: (...args: unknown[]) => mockDbInsert(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  delete: (...args: unknown[]) => mockDbDelete(...args),
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
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
  return {
    appointments: createTable("appointments"),
    appointmentMaterials: createTable("appointmentMaterials"),
    products: createTable("products"),
  };
});

vi.mock("drizzle-orm", () => {
  const sql = Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((s: string) => ({ type: "sql.raw", s })) }
  );
  return {
    eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
    // `and` is required since the P0-A tenant-isolation fix scopes the queries
    // with `and(eq(id), eq(salonId))`. Without it the route throws -> 500.
    and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
    sql,
  };
});

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
}));

// Tenant isolation (P0-A): the route resolves the salon from the session.
// Without this mock the route hits the real DB-backed resolver and throws.
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(TEST_IDS.SALON_UUID),
  getUserSalon: vi.fn().mockResolvedValue({ id: TEST_IDS.SALON_UUID }),
}));

// -------------------------------------------------------
// Chain builder
// -------------------------------------------------------

function chainMock(result: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "select", "from", "where", "leftJoin",
    "limit", "orderBy",
    "insert", "values", "update", "set", "delete",
    "returning",
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  (chain as Record<string, unknown>).then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

// -------------------------------------------------------
// Import route handlers
// -------------------------------------------------------

import {
  GET as getMaterials,
  POST as addMaterial,
  DELETE as removeMaterial,
} from "@/app/api/appointments/[id]/materials/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/appointments/[id]/materials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with materials list", async () => {
    const appointment = makeAppointment();
    const product = makeProduct();
    const material = {
      id: "material-1",
      appointmentId: TEST_IDS.APPOINTMENT_UUID,
      productId: TEST_IDS.PRODUCT_UUID,
      quantityUsed: "2",
      notes: null,
    };

    // First: verify appointment exists
    mockDbSelect.mockReturnValueOnce(chainMock([appointment]));
    // Second: get materials with product details
    mockDbSelect.mockReturnValueOnce(chainMock([{ material, product }]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getMaterials(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it("should return 404 when appointment not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await getMaterials(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Appointment not found");
  });
});

describe("POST /api/appointments/[id]/materials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 201 when adding material successfully", async () => {
    const appointment = makeAppointment();
    const product = makeProduct({ quantity: "10" });
    const updatedProduct = makeProduct({ quantity: "8" });
    const newMaterial = {
      id: "material-1",
      appointmentId: TEST_IDS.APPOINTMENT_UUID,
      productId: TEST_IDS.PRODUCT_UUID,
      quantityUsed: "2",
      notes: null,
    };

    // Verify appointment exists
    mockDbSelect.mockReturnValueOnce(chainMock([appointment]));
    // Verify product exists
    mockDbSelect.mockReturnValueOnce(chainMock([product]));
    // Insert material
    mockDbInsert.mockReturnValue(chainMock([newMaterial]));
    // Update product quantity
    mockDbUpdate.mockReturnValue(chainMock([]));
    // Fetch updated product
    mockDbSelect.mockReturnValueOnce(chainMock([updatedProduct]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`,
      {
        method: "POST",
        body: {
          productId: TEST_IDS.PRODUCT_UUID,
          quantityUsed: "2",
        },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await addMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return 400 when productId or quantityUsed is missing", async () => {
    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`,
      {
        method: "POST",
        body: {},
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await addMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("should return 400 when quantityUsed is zero", async () => {
    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`,
      {
        method: "POST",
        body: {
          productId: TEST_IDS.PRODUCT_UUID,
          quantityUsed: "0",
        },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await addMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 404 when appointment not found for adding material", async () => {
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`,
      {
        method: "POST",
        body: {
          productId: TEST_IDS.PRODUCT_UUID,
          quantityUsed: "2",
        },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await addMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Appointment not found");
  });

  it("should return 404 when product not found", async () => {
    const appointment = makeAppointment();
    mockDbSelect.mockReturnValueOnce(chainMock([appointment]));
    mockDbSelect.mockReturnValueOnce(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`,
      {
        method: "POST",
        body: {
          productId: TEST_IDS.PRODUCT_UUID,
          quantityUsed: "2",
        },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await addMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Product not found");
  });

  it("should return 400 when insufficient stock", async () => {
    const appointment = makeAppointment();
    const product = makeProduct({ quantity: "1" });

    mockDbSelect.mockReturnValueOnce(chainMock([appointment]));
    mockDbSelect.mockReturnValueOnce(chainMock([product]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`,
      {
        method: "POST",
        body: {
          productId: TEST_IDS.PRODUCT_UUID,
          quantityUsed: "5",
        },
      }
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await addMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Niewystarczajaca ilosc");
  });
});

describe("DELETE /api/appointments/[id]/materials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when removing a material and restoring inventory", async () => {
    const material = {
      id: "material-1",
      appointmentId: TEST_IDS.APPOINTMENT_UUID,
      productId: TEST_IDS.PRODUCT_UUID,
      quantityUsed: "2",
      notes: null,
    };

    // Find material
    mockDbSelect.mockReturnValue(chainMock([material]));
    // Restore inventory
    mockDbUpdate.mockReturnValue(chainMock([]));
    // Delete material
    mockDbDelete.mockReturnValue(chainMock([material]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials?materialId=material-1`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await removeMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain("removed");
  });

  it("should return 400 when materialId query param is missing", async () => {
    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await removeMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("materialId");
  });

  it("should return 404 when material not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(
      `http://localhost:3000/api/appointments/${TEST_IDS.APPOINTMENT_UUID}/materials?materialId=nonexistent`
    );
    const params = createRouteParams(TEST_IDS.APPOINTMENT_UUID);
    const response = await removeMaterial(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });
});
