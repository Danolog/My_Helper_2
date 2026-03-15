/**
 * Integration tests for /api/services endpoints.
 *
 * Tests cover:
 * - GET /api/services (list with filtering)
 * - POST /api/services (create with validation)
 * - GET /api/services/[id] (single service with variants)
 * - PUT /api/services/[id] (update)
 * - DELETE /api/services/[id] (delete with cascade)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  makeService,
  TEST_IDS,
} from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
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
    services: createTable("services"),
    serviceCategories: createTable("serviceCategories"),
    serviceVariants: createTable("serviceVariants"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

vi.mock("@/lib/validations", () => ({
  isValidUuid: vi.fn((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "test-user-id", email: "test@test.com", name: "Test User" } },
    user: { id: "test-user-id", email: "test@test.com", name: "Test User" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
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

import { GET as listServices, POST as createService } from "@/app/api/services/route";
import {
  GET as getService,
  PUT as updateService,
  DELETE as deleteService,
} from "@/app/api/services/[id]/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with services list", async () => {
    const service = makeService();
    mockDbSelect.mockReturnValue(chainMock([{ service, category: null }]));

    const request = createMockRequest(
      `http://localhost:3000/api/services?salonId=${TEST_IDS.SALON_UUID}`
    );
    const response = await listServices(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
    expect((body as any).data[0].name).toBe("Strzyzenie");
  });

  it("should return 200 with empty list", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/services");
    const response = await listServices(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest("http://localhost:3000/api/services");
    const response = await listServices(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("POST /api/services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 201 when creating a valid service", async () => {
    const newService = makeService();
    mockDbInsert.mockReturnValue(chainMock([newService]));

    const request = createMockRequest("http://localhost:3000/api/services", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        name: "Strzyzenie",
        basePrice: 100,
        baseDuration: 60,
      },
    });

    const response = await createService(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return 400 when required fields are missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/services", {
      method: "POST",
      body: {
        // Missing salonId, name, basePrice, baseDuration
      },
    });

    const response = await createService(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("should return 400 for negative price", async () => {
    const request = createMockRequest("http://localhost:3000/api/services", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        name: "Strzyzenie",
        basePrice: -10,
        baseDuration: 60,
      },
    });

    const response = await createService(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 400 for zero duration", async () => {
    const request = createMockRequest("http://localhost:3000/api/services", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        name: "Strzyzenie",
        basePrice: 100,
        baseDuration: 0,
      },
    });

    const response = await createService(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });
});

describe("GET /api/services/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with service details and variants", async () => {
    const service = makeService();
    // First select: service with category
    // Second select: variants
    mockDbSelect
      .mockReturnValueOnce(chainMock([{ service, category: null }]))
      .mockReturnValueOnce(chainMock([
        { id: "variant-1", serviceId: TEST_IDS.SERVICE_UUID, name: "Krotkie", priceModifier: "-20", durationModifier: -15 },
      ]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`);
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await getService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.name).toBe("Strzyzenie");
    expect((body as any).data.variants).toHaveLength(1);
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/services/bad-id");
    const params = createRouteParams("bad-id");
    const response = await getService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid service ID format");
  });

  it("should return 404 when service not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`);
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await getService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where", "leftJoin"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`);
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await getService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to fetch service");
  });
});

describe("PUT /api/services/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when updating a service", async () => {
    const updated = makeService({ name: "Updated Service" });
    mockDbUpdate.mockReturnValue(chainMock([updated]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`, {
      method: "PUT",
      body: { name: "Updated Service" },
    });
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await updateService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.name).toBe("Updated Service");
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/services/bad-id", {
      method: "PUT",
      body: { name: "X" },
    });
    const params = createRouteParams("bad-id");
    const response = await updateService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 404 when service not found for update", async () => {
    mockDbUpdate.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`, {
      method: "PUT",
      body: { name: "X" },
    });
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await updateService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("should return 200 when updating with all fields", async () => {
    const categoryUuid = "77777777-7777-7777-7777-777777777777";
    const updated = makeService({
      name: "Full Update",
      description: "A full description",
      basePrice: "200.00",
      baseDuration: 90,
      isActive: false,
      categoryId: categoryUuid,
      depositRequired: true,
      depositPercentage: 30,
    });
    mockDbUpdate.mockReturnValue(chainMock([updated]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`, {
      method: "PUT",
      body: {
        name: "Full Update",
        description: "A full description",
        basePrice: 200,
        baseDuration: "90",
        isActive: false,
        categoryId: categoryUuid,
        depositRequired: true,
        depositPercentage: "30",
      },
    });
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await updateService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.name).toBe("Full Update");
    expect((body as any).data.description).toBe("A full description");
    expect((body as any).data.baseDuration).toBe(90);
    expect((body as any).data.isActive).toBe(false);
    expect((body as any).data.categoryId).toBe(categoryUuid);
    expect((body as any).data.depositRequired).toBe(true);
    expect((body as any).data.depositPercentage).toBe(30);
  });

  it("should return 500 when database throws on update", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["update", "set", "where", "returning"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB update error"));
    mockDbUpdate.mockReturnValue(errorChain);

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`, {
      method: "PUT",
      body: { name: "X" },
    });
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await updateService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to update service");
  });
});

describe("DELETE /api/services/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when deleting a service", async () => {
    const deleted = makeService();
    mockDbDelete.mockReturnValue(chainMock([deleted]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`);
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await deleteService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.id).toBe(TEST_IDS.SERVICE_UUID);
  });

  it("should return 400 for invalid UUID format", async () => {
    const request = createMockRequest("http://localhost:3000/api/services/bad-id");
    const params = createRouteParams("bad-id");
    const response = await deleteService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 404 when service not found for deletion", async () => {
    mockDbDelete.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`);
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await deleteService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("should return 500 when database throws on delete", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["delete", "where", "returning"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB delete error"));
    mockDbDelete.mockReturnValue(errorChain);

    const request = createMockRequest(`http://localhost:3000/api/services/${TEST_IDS.SERVICE_UUID}`);
    const params = createRouteParams(TEST_IDS.SERVICE_UUID);
    const response = await deleteService(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Failed to delete service");
  });
});
