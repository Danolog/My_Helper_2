/**
 * Bezpieczeństwo galerii (P1, przegląd Ryana na #32, komentarz 6887577648).
 *
 * #32 zamknął allowlistę adresów zdjęć i przynależność pracownika/usługi do
 * salonu tylko w POST /api/gallery. Te testy pilnują pozostałych dróg:
 *
 *  1. PATCH /api/gallery/[id] — schemat .strict() = body z UI
 *     (photo-edit-dialog.tsx, photo-link-dialog.tsx); adresy zdjęć wyłącznie
 *     z naszego uploadu; employeeId/serviceId z salonu sesji; zapis tylko
 *     z wartości po walidacji (wcześniej trasa destrukturyzowała SUROWE body,
 *     więc POST z dobrym adresem + PATCH z dowolnym omijał allowlistę).
 *  2. DELETE — kasowanie plików lokalnych wyłącznie pod public/uploads/gallery/
 *     (i gallery/thumbs/); traversal odrzucany BEZ unlink.
 *  3. DELETE na Vercel Blob — del() NIE jest wołane (jak na main): plik nie
 *     jest powiązany z salonem, więc salon A mógłby skasować plik salonu B
 *     (B1 Ryana/Leo na #45). Wiersz usuwany, 200.
 *  4. GET /api/gallery — salon z sesji; salonId z query tylko porównany (403).
 *  5. POST/PATCH — adres przypięty już do innego wpisu TEGO salonu = 400
 *     (inaczej DELETE jednego wpisu kasowałby plik drugiego).
 *  6. showProductsToClients wraca w GET listy i odpowiedzi PATCH (B2 Leo).
 *
 * Walidacja jest PRAWDZIWA (bez mocka @/lib/api-validation) — test ma złapać
 * zmianę schematu, nie tylko trasy.
 */
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, createRouteParams, parseResponse } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();
const mockDbInsert = vi.fn();
const mockUpdateSet = vi.fn();

const mockTx = {
  select: (...args: unknown[]) => mockDbSelect(...args),
  update: (...args: unknown[]) => mockDbUpdate(...args),
  delete: (...args: unknown[]) => mockDbDelete(...args),
  insert: (...args: unknown[]) => mockDbInsert(...args),
  execute: vi.fn().mockResolvedValue(undefined), // SET LOCAL (forSalon)
};

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    transaction: (fn: (tx: typeof mockTx) => unknown) => fn(mockTx),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: { user: { id: "user-a" } },
    user: { id: "user-a" },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
  requireCronSecret: vi.fn(),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn(),
  getUserSalon: vi.fn(),
}));

const mockGetSalonContext = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: (...args: unknown[]) => mockGetSalonContext(...args),
  hasFeatureAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/schema", () => {
  const createTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "_table" ? name : `${name}.${String(prop)}`) });
  return {
    galleryPhotos: createTable("galleryPhotos"),
    employees: createTable("employees"),
    services: createTable("services"),
    clients: createTable("clients"),
    serviceCategories: createTable("serviceCategories"),
  };
});

const mockEq = vi.fn((...args: unknown[]) => ({ type: "eq", args }));
const mockNe = vi.fn((...args: unknown[]) => ({ type: "ne", args }));
const mockInArray = vi.fn((...args: unknown[]) => ({ type: "inArray", args }));
vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => mockEq(...args),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  or: vi.fn((...args: unknown[]) => ({ type: "or", args })),
  ne: (...args: unknown[]) => mockNe(...args),
  inArray: (...args: unknown[]) => mockInArray(...args),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => ({ type: "sql", args })),
    { raw: vi.fn((query: string) => ({ type: "sql.raw", query })) }
  ),
}));

const mockUnlink = vi.fn().mockResolvedValue(undefined);
vi.mock("fs/promises", () => ({
  default: { unlink: (...args: unknown[]) => mockUnlink(...args) },
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

// Nigdy prawdziwy Blob — tylko mock.
const mockBlobDel = vi.fn().mockResolvedValue(undefined);
vi.mock("@vercel/blob", () => ({
  del: (...args: unknown[]) => mockBlobDel(...args),
  put: vi.fn(),
}));

const mockLoggerError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function chainMock(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "leftJoin", "limit", "orderBy", "update", "delete", "returning"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.set = (...args: unknown[]) => {
    mockUpdateSet(...args);
    return chain;
  };
  chain.then = (resolve: (val: unknown[]) => unknown) => resolve(result);
  return chain;
}

import { GET as getPhoto, PATCH, DELETE } from "@/app/api/gallery/[id]/route";
import { getUserSalonId } from "@/lib/get-user-salon";
import { GET as listGallery, POST as createGallery } from "@/app/api/gallery/route";

// -------------------------------------------------------
// Fixtures
// -------------------------------------------------------

const SALON_A = crypto.randomUUID();
const SALON_B = crypto.randomUUID();
const PHOTO_ID = crypto.randomUUID();
const EMP_A = crypto.randomUUID();
const EMP_OTHER = crypto.randomUUID();
const SERVICE_A = crypto.randomUUID();
const BLOB_TOKEN = "vercel_blob_rw_StoreA1_secretpart";
const BLOB_HOST = "https://storea1.public.blob.vercel-storage.com";
const localUrl = () => `/uploads/gallery/${crypto.randomUUID()}.jpg`;

const ownerCtx = { salonId: SALON_A, role: "owner", employeeId: null, userId: "user-a" };
const staffCtx = { salonId: SALON_A, role: "employee", employeeId: EMP_A, userId: "user-a" };

function photoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID,
    salonId: SALON_A,
    employeeId: EMP_A,
    serviceId: null,
    beforePhotoUrl: null,
    afterPhotoUrl: localUrl(),
    ...overrides,
  };
}

/** Body 1:1 z photo-edit-dialog.tsx (handleSaveEdit). */
function uiEditBody(overrides: Record<string, unknown> = {}) {
  return {
    description: "Balayage",
    techniques: "",
    productsUsed: "",
    employeeId: EMP_A,
    serviceId: SERVICE_A,
    duration: 90,
    showProductsToClients: false,
    ...overrides,
  };
}

async function patch(body: unknown) {
  const req = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_ID}`, { method: "PATCH", body });
  return parseResponse(await PATCH(req, createRouteParams(PHOTO_ID)));
}

async function del() {
  const req = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_ID}`, { method: "DELETE" });
  return parseResponse(await DELETE(req, createRouteParams(PHOTO_ID)));
}

async function create(body: unknown) {
  const req = createMockRequest("http://localhost:3000/api/gallery", { method: "POST", body });
  return parseResponse(await createGallery(req));
}

/** Projekcja (obiekt z select()) z n-tego wywołania SELECT-a. */
function selectProjection(n: number) {
  return mockDbSelect.mock.calls[n]?.[0] as Record<string, unknown> | undefined;
}

async function list(query: string) {
  const req = createMockRequest(`http://localhost:3000/api/gallery${query}`, { method: "GET" });
  return parseResponse(await listGallery(req));
}

/** Kolejne SELECT-y: zdjęcie, potem (opcjonalnie) refy, na końcu join odpowiedzi. */
function selectsReturn(...results: unknown[][]) {
  for (const r of results) mockDbSelect.mockReturnValueOnce(chainMock(r));
  mockDbSelect.mockReturnValue(chainMock([{ id: PHOTO_ID }]));
}

const galleryDir = path.resolve(process.cwd(), "public", "uploads", "gallery");

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset czyści też kolejkę mockReturnValueOnce — test kończący się
  // wcześnie (400/403) nie może zostawić wyników SELECT-ów następnemu.
  mockDbSelect.mockReset();
  mockUnlink.mockReset();
  mockBlobDel.mockReset();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockGetSession.mockResolvedValue({ user: { id: "user-a" } });
  mockGetSalonContext.mockResolvedValue(ownerCtx);
  mockDbUpdate.mockReturnValue(chainMock([{ id: PHOTO_ID }]));
  mockDbDelete.mockReturnValue(chainMock([{ id: PHOTO_ID }]));
  mockUnlink.mockResolvedValue(undefined);
  mockBlobDel.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// =======================================================
// 1. PATCH
// =======================================================

describe("PATCH /api/gallery/[id] — kontrakt z UI", () => {
  it("200 dla body z photo-edit-dialog; zapis z wartości po walidacji (w tym showProductsToClients)", async () => {
    selectsReturn([photoRow()], [{ id: EMP_A }], [{ id: SERVICE_A }]);
    const { status, body } = await patch(uiEditBody());

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      description: "Balayage",
      techniques: null,
      productsUsed: null,
      employeeId: EMP_A,
      serviceId: SERVICE_A,
      duration: 90,
      showProductsToClients: false,
    });
  });

  it("200 dla body z photo-link-dialog (adres z naszego uploadu)", async () => {
    // zdjęcie, sprawdzenie duplikatu (brak), join odpowiedzi
    selectsReturn([photoRow({ beforePhotoUrl: null })], []);
    const url = localUrl();
    const { status } = await patch({ beforePhotoUrl: url });
    expect(status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledWith({ beforePhotoUrl: url });
  });

  it("200 dla adresu z naszego store'u Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", BLOB_TOKEN);
    selectsReturn([photoRow()], []);
    const url = `${BLOB_HOST}/gallery/${crypto.randomUUID()}.webp`;
    const { status } = await patch({ afterPhotoUrl: url });
    expect(status).toBe(200);
  });

  it.each([
    ["obcy host", "https://evil.example/a.jpg"],
    ["metadane chmury", "http://169.254.169.254/latest/meta-data/"],
    ["traversal", "/uploads/../../package.json"],
    ["traversal w galerii", "/uploads/gallery/../../../.env"],
    ["zakodowany traversal", "/uploads/gallery/%2e%2e/%2e%2e/x.jpg"],
    ["backslash", "/uploads/gallery/..\\..\\x.jpg"],
    ["miniatura zamiast zdjęcia", `/uploads/gallery/thumbs/${crypto.randomUUID()}.jpg`],
    ["svg", `/uploads/gallery/${crypto.randomUUID()}.svg`],
  ])("400 dla afterPhotoUrl spoza uploadu (%s), bez zapisu", async (_l, url) => {
    selectsReturn([photoRow()]);
    const { status } = await patch({ afterPhotoUrl: url });
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("400 dla beforePhotoUrl spoza uploadu", async () => {
    selectsReturn([photoRow()]);
    const { status } = await patch({ beforePhotoUrl: "https://evil.example/b.jpg" });
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("400 dla cudzego store'u Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", BLOB_TOKEN);
    selectsReturn([photoRow()]);
    const { status } = await patch({
      afterPhotoUrl: `https://other.public.blob.vercel-storage.com/gallery/${crypto.randomUUID()}.jpg`,
    });
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["salonId", { salonId: SALON_B }],
    ["nieznane pole", { title: "x" }],
    ["id", { id: crypto.randomUUID() }],
  ])("400 dla pola spoza kontraktu (%s) — .strict()", async (_l, extra) => {
    selectsReturn([photoRow()]);
    const { status } = await patch({ description: "x", ...extra });
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["duration jako tekst", { duration: "abc" }],
    ["duration ponad dobę", { duration: 1441 }],
    ["employeeId nie UUID", { employeeId: "abc" }],
    ["serviceId pusty napis", { serviceId: "" }],
    ["showProductsToClients nie boolean", { showProductsToClients: "tak" }],
  ])("400 — %s", async (_l, body) => {
    selectsReturn([photoRow()]);
    const { status } = await patch(body);
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("400, gdy po zmianie zdjęcie nie miałoby ani 'przed', ani 'po'", async () => {
    selectsReturn([photoRow({ beforePhotoUrl: null })]);
    const { status } = await patch({ afterPhotoUrl: null });
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("400 dla pustego body", async () => {
    selectsReturn([photoRow()]);
    const { status } = await patch({});
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("odpowiedź zawiera showProductsToClients (B2) — PATCH {showProductsToClients:false}", async () => {
    selectsReturn([photoRow()], [{ id: PHOTO_ID, showProductsToClients: false }]);
    const { status, body } = await patch({ showProductsToClients: false });

    expect(status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledWith({ showProductsToClients: false });
    expect((body.data as Record<string, unknown>).showProductsToClients).toBe(false);
    // projekcja joina odpowiedzi (2. SELECT) musi zawierać kolumnę
    expect(selectProjection(1)).toHaveProperty(
      "showProductsToClients",
      "galleryPhotos.showProductsToClients"
    );
  });
});

describe("GET /api/gallery/[id] — showProductsToClients (B2)", () => {
  it("projekcja zawiera showProductsToClients", async () => {
    vi.mocked(getUserSalonId).mockResolvedValue(SALON_A);
    mockDbSelect.mockReturnValue(chainMock([{ id: PHOTO_ID, showProductsToClients: false }]));
    const req = createMockRequest(`http://localhost:3000/api/gallery/${PHOTO_ID}`, { method: "GET" });
    const { status, body } = await parseResponse(await getPhoto(req, createRouteParams(PHOTO_ID)));

    expect(status).toBe(200);
    expect((body.data as Record<string, unknown>).showProductsToClients).toBe(false);
    expect(selectProjection(0)).toHaveProperty(
      "showProductsToClients",
      "galleryPhotos.showProductsToClients"
    );
  });
});

describe("PATCH/POST /api/gallery — plik przypięty do innego wpisu salonu", () => {
  it("PATCH: 400, gdy adres jest już w innym wpisie salonu — bez zapisu", async () => {
    const url = localUrl();
    selectsReturn([photoRow({ beforePhotoUrl: null })], [{ id: crypto.randomUUID() }]);
    const { status, body } = await patch({ beforePhotoUrl: url });

    expect(status).toBe(400);
    expect(body.error).toBe("Ten plik zdjecia jest juz uzyty w innym wpisie galerii");
    expect(mockDbUpdate).not.toHaveBeenCalled();
    // zapytanie w kontekście salonu sesji, z pominięciem edytowanego wpisu
    expect(mockEq).toHaveBeenCalledWith("galleryPhotos.salonId", SALON_A);
    expect(mockNe).toHaveBeenCalledWith("galleryPhotos.id", PHOTO_ID);
    expect(mockInArray).toHaveBeenCalledWith("galleryPhotos.beforePhotoUrl", [url]);
    expect(mockInArray).toHaveBeenCalledWith("galleryPhotos.afterPhotoUrl", [url]);
  });

  it("PATCH bez zmiany adresów nie pyta o duplikat", async () => {
    selectsReturn([photoRow()]);
    const { status } = await patch({ description: "x" });
    expect(status).toBe(200);
    expect(mockInArray).not.toHaveBeenCalled();
  });

  it("PATCH czyszczący jedno zdjęcie (null) nie pyta o duplikat", async () => {
    selectsReturn([photoRow({ beforePhotoUrl: localUrl() })]);
    const { status } = await patch({ afterPhotoUrl: null });
    expect(status).toBe(200);
    expect(mockInArray).not.toHaveBeenCalled();
  });

  it("POST: 400, gdy adres jest już w innym wpisie salonu — bez insertu", async () => {
    const url = localUrl();
    selectsReturn([{ id: crypto.randomUUID() }]);
    const { status, body } = await create({
      salonId: SALON_A,
      employeeId: null,
      serviceId: null,
      afterPhotoUrl: url,
      beforePhotoUrl: null,
      description: null,
      techniques: null,
      productsUsed: null,
      duration: null,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("Ten plik zdjecia jest juz uzyty w innym wpisie galerii");
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("galleryPhotos.salonId", SALON_A);
    expect(mockInArray).toHaveBeenCalledWith("galleryPhotos.afterPhotoUrl", [url]);
    expect(mockNe).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/gallery/[id] — pracownik i usługa z salonu sesji", () => {
  it("400, gdy employeeId należy do innego salonu (zapytanie zawężone do salonu sesji)", async () => {
    selectsReturn([photoRow()], []);
    const { status, body } = await patch({ employeeId: EMP_OTHER });
    expect(status).toBe(400);
    expect(body.error).toBe("Nieprawidlowe dane dla tego salonu");
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("employees.salonId", SALON_A);
  });

  it("400, gdy serviceId należy do innego salonu", async () => {
    selectsReturn([photoRow()], []);
    const { status } = await patch({ serviceId: crypto.randomUUID() });
    expect(status).toBe(400);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("services.salonId", SALON_A);
  });

  it("200, gdy właściciel czyści pracownika i usługę (null)", async () => {
    selectsReturn([photoRow()]);
    const { status } = await patch({ employeeId: null, serviceId: null });
    expect(status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledWith({ employeeId: null, serviceId: null });
  });

  it("403, gdy pracownik przepina swoje zdjęcie na innego pracownika", async () => {
    mockGetSalonContext.mockResolvedValue(staffCtx);
    selectsReturn([photoRow({ employeeId: EMP_A })], [{ id: EMP_OTHER }]);
    const { status } = await patch(uiEditBody({ employeeId: EMP_OTHER }));
    expect(status).toBe(403);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("200, gdy pracownik zapisuje formularz ze sobą jako pracownikiem", async () => {
    mockGetSalonContext.mockResolvedValue(staffCtx);
    selectsReturn([photoRow({ employeeId: EMP_A })], [{ id: EMP_A }], [{ id: SERVICE_A }]);
    const { status } = await patch(uiEditBody());
    expect(status).toBe(200);
  });

  it("404 dla zdjęcia innego salonu — bez walidacji refów i zapisu", async () => {
    selectsReturn([]);
    const { status } = await patch({ employeeId: EMP_OTHER });
    expect(status).toBe(404);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// =======================================================
// 2–3. DELETE
// =======================================================

describe("DELETE /api/gallery/[id] — pliki lokalne", () => {
  it("kasuje zdjęcie i miniaturę spod public/uploads/gallery/", async () => {
    const name = `${crypto.randomUUID()}.jpg`;
    selectsReturn([photoRow({ afterPhotoUrl: `/uploads/gallery/${name}` })]);
    const { status } = await del();

    expect(status).toBe(200);
    expect(mockUnlink).toHaveBeenCalledWith(path.join(galleryDir, name));
    expect(mockUnlink).toHaveBeenCalledWith(path.join(galleryDir, "thumbs", name));
    expect(mockBlobDel).not.toHaveBeenCalled();
  });

  it.each([
    ["wyjście z uploads", "/uploads/../../package.json"],
    ["wyjście z galerii", "/uploads/gallery/../../../.env"],
    ["inny folder uploads", "/uploads/avatars/x.jpg"],
    ["zakodowany traversal", "/uploads/gallery/%2e%2e/%2e%2e/x.jpg"],
    ["backslash", "/uploads/gallery/..\\..\\..\\x.jpg"],
    ["podfolder galerii", "/uploads/gallery/sub/x.jpg"],
    ["bajt zerowy", "/uploads/gallery/x.jpg\u0000.png"],
    ["sam katalog", "/uploads/gallery/"],
  ])("traversal / ścieżka spoza galerii (%s): wiersz usunięty, bez unlink", async (_l, url) => {
    selectsReturn([photoRow({ afterPhotoUrl: url, beforePhotoUrl: url })]);
    const { status } = await del();

    expect(status).toBe(200);
    expect(mockDbDelete).toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("brak pliku (ENOENT) nie psuje odpowiedzi", async () => {
    mockUnlink.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    selectsReturn([photoRow()]);
    const { status } = await del();
    expect(status).toBe(200);
  });
});

describe("DELETE /api/gallery/[id] — Vercel Blob (mock)", () => {
  beforeEach(() => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", BLOB_TOKEN);
  });

  it("adres z naszego store'u: del() nie jest wołane, wiersz usunięty, 200 (B1)", async () => {
    selectsReturn([
      photoRow({
        beforePhotoUrl: `${BLOB_HOST}/gallery/${crypto.randomUUID()}.jpg`,
        afterPhotoUrl: `${BLOB_HOST}/gallery/${crypto.randomUUID()}.png`,
      }),
    ]);
    const { status, body } = await del();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDbDelete).toHaveBeenCalled();
    expect(mockBlobDel).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("nie wywołuje del() dla adresu spoza naszego store'u", async () => {
    selectsReturn([
      photoRow({
        afterPhotoUrl: `https://other.public.blob.vercel-storage.com/gallery/${crypto.randomUUID()}.jpg`,
        beforePhotoUrl: "https://evil.example/a.jpg",
      }),
    ]);
    const { status } = await del();
    expect(status).toBe(200);
    expect(mockBlobDel).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("zdjęcie innego salonu (404) nie rusza Blob", async () => {
    selectsReturn([]);
    const { status } = await del();
    expect(status).toBe(404);
    expect(mockBlobDel).not.toHaveBeenCalled();
  });
});

// =======================================================
// 4. GET /api/gallery
// =======================================================

describe("GET /api/gallery — salon z sesji", () => {
  it("403 dla salonId innego salonu, bez zapytania do bazy", async () => {
    const { status } = await list(`?salonId=${SALON_B}`);
    expect(status).toBe(403);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("200 dla własnego salonId — zapytanie po salonie z sesji", async () => {
    mockDbSelect.mockReturnValue(chainMock([{ id: PHOTO_ID }]));
    const { status, body } = await list(`?salonId=${SALON_A}`);
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(mockEq).toHaveBeenCalledWith("galleryPhotos.salonId", SALON_A);
  });

  it("lista zawiera showProductsToClients (B2) — dialog edycji startuje z wartości z bazy", async () => {
    mockDbSelect.mockReturnValue(chainMock([{ id: PHOTO_ID, showProductsToClients: false }]));
    const { status, body } = await list("");
    expect(status).toBe(200);
    expect((body.data as Array<Record<string, unknown>>)[0]?.showProductsToClients).toBe(false);
    expect(selectProjection(0)).toHaveProperty(
      "showProductsToClients",
      "galleryPhotos.showProductsToClients"
    );
  });

  it("200 bez salonId — salon z sesji", async () => {
    mockDbSelect.mockReturnValue(chainMock([]));
    const { status } = await list("");
    expect(status).toBe(200);
    expect(mockEq).toHaveBeenCalledWith("galleryPhotos.salonId", SALON_A);
  });

  it("404, gdy użytkownik nie ma salonu", async () => {
    mockGetSalonContext.mockResolvedValue(null);
    const { status } = await list(`?salonId=${SALON_A}`);
    expect(status).toBe(404);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it.each([
    ["employeeId", "?employeeId=abc"],
    ["serviceId", "?serviceId=1"],
  ])("400 dla filtra %s, który nie jest UUID (zamiast 500 z Postgresa)", async (_l, q) => {
    const { status } = await list(q);
    expect(status).toBe(400);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });
});
