/**
 * Integration tests for /api/products endpoints.
 *
 * Tests cover:
 * - GET /api/products (list with filtering)
 * - POST /api/products (create with validation + low stock alerts)
 * - GET /api/products/[id] (single product)
 * - PUT /api/products/[id] (update with low stock check)
 * - DELETE /api/products/[id] (delete)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
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
    products: createTable("products"),
    notifications: createTable("notifications"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
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

import { GET as listProducts, POST as createProduct } from "@/app/api/products/route";
import {
  GET as getProduct,
  PUT as updateProduct,
  DELETE as deleteProduct,
} from "@/app/api/products/[id]/route";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with products list", async () => {
    const product = makeProduct();
    mockDbSelect.mockReturnValue(chainMock([product]));

    const request = createMockRequest(
      `http://localhost:3000/api/products?salonId=${TEST_IDS.SALON_UUID}`
    );
    const response = await listProducts(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.count).toBe(1);
    expect((body as any).data[0].name).toBe("Szampon");
  });

  it("should return 200 with empty list", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/products");
    const response = await listProducts(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(0);
  });

  it("should return 500 when database throws", async () => {
    const errorChain: Record<string, unknown> = {};
    const methods = ["select", "from", "where"];
    for (const m of methods) {
      (errorChain as Record<string, ReturnType<typeof vi.fn>>)[m] = vi.fn().mockReturnValue(errorChain);
    }
    errorChain.then = (_: unknown, reject: (err: Error) => void) => reject(new Error("DB error"));
    mockDbSelect.mockReturnValue(errorChain);

    const request = createMockRequest("http://localhost:3000/api/products");
    const response = await listProducts(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("POST /api/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 201 when creating a valid product", async () => {
    const newProduct = makeProduct();
    // Insert returns new product
    mockDbInsert.mockReturnValue(chainMock([newProduct]));
    // Low stock check - no existing notification
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest("http://localhost:3000/api/products", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        name: "Szampon",
        quantity: 10,
        minQuantity: 2,
        unit: "szt.",
        pricePerUnit: 25,
      },
    });

    const response = await createProduct(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it("should return 400 when required fields are missing", async () => {
    const request = createMockRequest("http://localhost:3000/api/products", {
      method: "POST",
      body: {
        // Missing salonId, name
      },
    });

    const response = await createProduct(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Validation failed");
  });

  it("should return 400 for invalid quantity format", async () => {
    const request = createMockRequest("http://localhost:3000/api/products", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        name: "Szampon",
        quantity: "abc",
      },
    });

    const response = await createProduct(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("should return 400 for negative quantity", async () => {
    const request = createMockRequest("http://localhost:3000/api/products", {
      method: "POST",
      body: {
        salonId: TEST_IDS.SALON_UUID,
        name: "Szampon",
        quantity: -5,
      },
    });

    const response = await createProduct(request);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });
});

describe("GET /api/products/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with product details", async () => {
    const product = makeProduct();
    mockDbSelect.mockReturnValue(chainMock([product]));

    const request = createMockRequest(`http://localhost:3000/api/products/${TEST_IDS.PRODUCT_UUID}`);
    const params = createRouteParams(TEST_IDS.PRODUCT_UUID);
    const response = await getProduct(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.name).toBe("Szampon");
  });

  it("should return 404 when product not found", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/products/${TEST_IDS.PRODUCT_UUID}`);
    const params = createRouteParams(TEST_IDS.PRODUCT_UUID);
    const response = await getProduct(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });
});

describe("PUT /api/products/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when updating a product", async () => {
    const updated = makeProduct({ name: "Updated Szampon" });
    mockDbUpdate.mockReturnValue(chainMock([updated]));
    // Low stock check - no existing notification
    mockDbSelect.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/products/${TEST_IDS.PRODUCT_UUID}`, {
      method: "PUT",
      body: { name: "Updated Szampon" },
    });
    const params = createRouteParams(TEST_IDS.PRODUCT_UUID);
    const response = await updateProduct(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.name).toBe("Updated Szampon");
  });

  it("should return 404 when product not found for update", async () => {
    mockDbUpdate.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/products/${TEST_IDS.PRODUCT_UUID}`, {
      method: "PUT",
      body: { name: "X" },
    });
    const params = createRouteParams(TEST_IDS.PRODUCT_UUID);
    const response = await updateProduct(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });
});

describe("DELETE /api/products/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 when deleting a product", async () => {
    const deleted = makeProduct();
    mockDbDelete.mockReturnValue(chainMock([deleted]));

    const request = createMockRequest(`http://localhost:3000/api/products/${TEST_IDS.PRODUCT_UUID}`);
    const params = createRouteParams(TEST_IDS.PRODUCT_UUID);
    const response = await deleteProduct(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body as any).data.id).toBe(TEST_IDS.PRODUCT_UUID);
    expect(body.message).toContain("deleted");
  });

  it("should return 404 when product not found for deletion", async () => {
    mockDbDelete.mockReturnValue(chainMock([]));

    const request = createMockRequest(`http://localhost:3000/api/products/${TEST_IDS.PRODUCT_UUID}`);
    const params = createRouteParams(TEST_IDS.PRODUCT_UUID);
    const response = await deleteProduct(request, params);
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });
});
