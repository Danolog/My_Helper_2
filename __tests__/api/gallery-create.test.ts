/**
 * Kontrakt POST /api/gallery — body dokładnie takie, jakie buduje UI
 * (src/components/gallery/photo-upload-dialog.tsx, handleUpload):
 *   { salonId, employeeId|null, serviceId|null, afterPhotoUrl|null,
 *     beforePhotoUrl|null, description|null, techniques|null,
 *     productsUsed|null, duration: number|null }
 *
 * Przed poprawką schemat wymagał imageUrl (którego UI nie wysyła), więc każde
 * dodanie zdjęcia kończyło się 400. Do tego właściciel mógł zapisać zdjęcie
 * do CUDZEGO salonu (warunek salonId sprawdzany tylko dla nie-właścicieli),
 * a adresy zdjęć nie były ograniczone do naszego uploadu.
 *
 * Id to prawdziwe UUID v4 (crypto.randomUUID()), bo walidacja id w repo
 * (Zod 4 .uuid()) odrzuca "zerowe" id z seeda — tego tutaj nie testujemy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockTxSelect = vi.fn();
const mockTxInsert = vi.fn();
const mockInsertValues = vi.fn();

const mockTx = {
  select: (...args: unknown[]) => mockTxSelect(...args),
  insert: (...args: unknown[]) => mockTxInsert(...args),
  execute: vi.fn().mockResolvedValue(undefined), // SET LOCAL (forSalon)
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockTxSelect(...args),
    insert: (...args: unknown[]) => mockTxInsert(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-a", email: "a@test.pl", name: "A" } },
    user: { id: "user-a", email: "a@test.pl", name: "A" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
  requireCronSecret: vi.fn(),
}));

const mockGetSalonContext = vi.fn();
const mockHasFeatureAccess = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: (...args: unknown[]) => mockGetSalonContext(...args),
  hasFeatureAccess: (...args: unknown[]) => mockHasFeatureAccess(...args),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`) });
  return {
    galleryPhotos: createTable("galleryPhotos"),
    employees: createTable("employees"),
    services: createTable("services"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "leftJoin", "orderBy", "returning"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.values = (...args: unknown[]) => {
    mockInsertValues(...args);
    return chain;
  };
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

import { POST } from "@/app/api/gallery/route";

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

const SALON_A = crypto.randomUUID();
const SALON_B = crypto.randomUUID();
const EMPLOYEE_A = crypto.randomUUID();
const SERVICE_A = crypto.randomUUID();
const localUrl = () => `/uploads/gallery/${crypto.randomUUID()}.jpg`;

/** Body 1:1 z photo-upload-dialog.tsx (pola formularza puste -> null). */
function uiBody(overrides: Record<string, unknown> = {}) {
  return {
    salonId: SALON_A,
    employeeId: EMPLOYEE_A,
    serviceId: SERVICE_A,
    afterPhotoUrl: localUrl(),
    beforePhotoUrl: null,
    description: "Koloryzacja balayage",
    techniques: null,
    productsUsed: null,
    duration: 90,
    ...overrides,
  };
}

async function post(body: unknown) {
  const req = createMockRequest("http://localhost:3000/api/gallery", { method: "POST", body });
  return parseResponse(await POST(req));
}

function ctx(role: "owner" | "employee" | "receptionist", salonId = SALON_A) {
  return { salonId, role, employeeId: null, userId: "user-a" };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockGetSalonContext.mockResolvedValue(ctx("owner"));
  mockHasFeatureAccess.mockResolvedValue(false);
  // pracownik i usługa należą do salonu A
  mockTxSelect.mockImplementation(() => chainMock([{ id: "found" }]));
  mockTxInsert.mockImplementation(() => chainMock([{ id: crypto.randomUUID() }]));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// =======================================================

describe("POST /api/gallery — kontrakt z UI", () => {
  it("201 dla body z UI, tylko zdjęcie 'po'", async () => {
    const body = uiBody();
    const { status, body: res } = await post(body);

    expect(status).toBe(201);
    expect(res.success).toBe(true);
    const values = mockInsertValues.mock.calls[0]?.[0];
    expect(values).toMatchObject({
      salonId: SALON_A,
      employeeId: EMPLOYEE_A,
      serviceId: SERVICE_A,
      afterPhotoUrl: body.afterPhotoUrl,
      beforePhotoUrl: null,
      duration: 90,
      techniques: null,
    });
  });

  it("201 dla tylko zdjęcia 'przed'", async () => {
    const before = localUrl();
    const { status } = await post(uiBody({ afterPhotoUrl: null, beforePhotoUrl: before }));
    expect(status).toBe(201);
    expect(mockInsertValues.mock.calls[0]?.[0]).toMatchObject({ beforePhotoUrl: before, afterPhotoUrl: null });
  });

  it("201 dla obu zdjęć i pustych pól formularza", async () => {
    const { status } = await post(
      uiBody({
        beforePhotoUrl: localUrl(),
        employeeId: null,
        serviceId: null,
        description: null,
        duration: null,
      })
    );
    expect(status).toBe(201);
    expect(mockInsertValues.mock.calls[0]?.[0]).toMatchObject({ employeeId: null, serviceId: null, duration: null });
  });

  it("201 dla adresu z naszego store'u Vercel Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_StoreA1_secret");
    const url = `https://storea1.public.blob.vercel-storage.com/gallery/${crypto.randomUUID()}.png`;
    const { status } = await post(uiBody({ afterPhotoUrl: url }));
    expect(status).toBe(201);
  });

  it("400, gdy nie ma ani 'przed', ani 'po'", async () => {
    const { status } = await post(uiBody({ afterPhotoUrl: null, beforePhotoUrl: null }));
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["obcy host", "https://evil.example/a.jpg"],
    ["metadane chmury", "http://169.254.169.254/latest/meta-data/"],
    ["traversal", "/uploads/gallery/../../../.env"],
    ["cudzy store Blob", `https://other.public.blob.vercel-storage.com/gallery/${crypto.randomUUID()}.jpg`],
  ])("400 dla adresu spoza naszego uploadu (%s)", async (_label, url) => {
    const { status } = await post(uiBody({ afterPhotoUrl: url }));
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("400 dla adresu spoza uploadu w polu 'przed'", async () => {
    const { status } = await post(uiBody({ beforePhotoUrl: "https://evil.example/b.jpg" }));
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/gallery — obcy salon", () => {
  it("403, gdy WŁAŚCICIEL salonu A zapisuje do salonu B", async () => {
    mockGetSalonContext.mockResolvedValue(ctx("owner", SALON_A));
    const { status } = await post(uiBody({ salonId: SALON_B, employeeId: null, serviceId: null }));
    expect(status).toBe(403);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("403, gdy pracownik salonu A zapisuje do salonu B", async () => {
    mockGetSalonContext.mockResolvedValue(ctx("employee", SALON_A));
    const { status } = await post(uiBody({ salonId: SALON_B, employeeId: null, serviceId: null }));
    expect(status).toBe(403);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("404, gdy użytkownik nie ma salonu", async () => {
    mockGetSalonContext.mockResolvedValue(null);
    const { status } = await post(uiBody());
    expect(status).toBe(404);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("400, gdy pracownik z body nie należy do salonu", async () => {
    // pierwsze zapytanie (pracownik) nic nie znajduje
    mockTxSelect.mockImplementationOnce(() => chainMock([]));
    const { status } = await post(uiBody());
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("400, gdy usługa z body nie należy do salonu", async () => {
    mockTxSelect
      .mockImplementationOnce(() => chainMock([{ id: EMPLOYEE_A }]))
      .mockImplementationOnce(() => chainMock([]));
    const { status } = await post(uiBody());
    expect(status).toBe(400);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });

  it("201 dla pracownika we własnym salonie", async () => {
    mockGetSalonContext.mockResolvedValue(ctx("employee", SALON_A));
    const { status } = await post(uiBody());
    expect(status).toBe(201);
  });

  it("403 dla recepcji bez grantu gallery-manage", async () => {
    mockGetSalonContext.mockResolvedValue(ctx("receptionist", SALON_A));
    const { status } = await post(uiBody());
    expect(status).toBe(403);
    expect(mockTxInsert).not.toHaveBeenCalled();
  });
});
