// @vitest-environment node
/**
 * Testy trasy POST /api/gallery/upload — bramka zawartości pliku.
 *
 * Trasa dekoduje bajty przysłane przez dowolne zalogowane konto biblioteką
 * sharp (PRAWDZIWĄ — tutaj celowo nie jest mockowana). Rozszerzenie pliku
 * pochodzi wyłącznie z formatu wykrytego w bajtach, nigdy z nazwy ani z typu
 * zadeklarowanego przez klienta. Te testy pilnują tej bramki przy każdej
 * zmianie wersji sharp:
 * - poprawny obraz przechodzi i dostaje miniaturę,
 * - śmieciowe bajty i SVG podpisane jako PNG kończą się kodem 400,
 *   a do magazynu plików nic nie trafia.
 *
 * Środowisko `node` (nie happy-dom): trasa czyta `request.formData()`,
 * więc Request, FormData i File muszą pochodzić z jednej implementacji.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/gallery/upload/route";

// -------------------------------------------------------
// Mocki (sharp zostaje prawdziwy). vi.mock jest wynoszone nad importy,
// a fabryki sięgają do zmiennych mock* dopiero przy wywołaniu.
// -------------------------------------------------------

const mockUpload = vi.fn();
vi.mock("@/lib/storage", () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}));

const mockRequireAuth = vi.fn();
const mockIsAuthError = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

const mockRateLimitCheck = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: (...args: unknown[]) => mockRateLimitCheck(...args) },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// -------------------------------------------------------
// Dane testowe
// -------------------------------------------------------

// Najmniejszy poprawny PNG (1x1 piksel) — stałe bajty, niezależne od sharp.
const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const GARBAGE = Buffer.from("to nie jest obraz, tylko losowy tekst 0123456789");

const SVG_AS_PNG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'
);

function uploadRequest(bytes: Buffer | null, type = "image/png", name = "zdjecie.png") {
  const formData = new FormData();
  if (bytes) {
    formData.append("file", new File([new Uint8Array(bytes)], name, { type }));
  }
  return new Request("http://localhost:3000/api/gallery/upload", {
    method: "POST",
    body: formData,
  });
}

// -------------------------------------------------------
// Testy
// -------------------------------------------------------

describe("POST /api/gallery/upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitCheck.mockReturnValue({ success: true, reset: 0 });
    mockRequireAuth.mockResolvedValue({
      session: { user: { id: "test-user-id" } },
      user: { id: "test-user-id" },
    });
    mockIsAuthError.mockReturnValue(false);
    mockUpload.mockImplementation(async (_buffer: Buffer, filename: string, folder: string) => ({
      url: `/uploads/${folder}/${filename}`,
    }));
  });

  it("przyjmuje poprawny obraz PNG i zapisuje oryginał oraz miniaturę (200)", async () => {
    const response = await POST(uploadRequest(VALID_PNG));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // Rozszerzenie z wykrytego formatu, nazwa losowa — nie z nazwy pliku klienta.
    expect(body.data.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload.mock.calls.map((call) => call[2]).sort()).toEqual([
      "gallery",
      "gallery/thumbs",
    ]);
    // Miniatura to wynik pracy sharp — niepusty bufor.
    const thumbCall = mockUpload.mock.calls.find((call) => call[2] === "gallery/thumbs");
    expect(Buffer.isBuffer(thumbCall?.[0])).toBe(true);
    expect((thumbCall?.[0] as Buffer).length).toBeGreaterThan(0);
  });

  it("nadaje rozszerzenie z zawartości, nie z nazwy pliku (PNG nazwany .html)", async () => {
    const response = await POST(uploadRequest(VALID_PNG, "image/png", "atak.html"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.filename).toMatch(/\.png$/);
  });

  it("odrzuca śmieciowe bajty podpisane jako image/png (400) i nic nie zapisuje", async () => {
    const response = await POST(uploadRequest(GARBAGE));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid file content");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("odrzuca SVG podpisane jako image/png (400) i nic nie zapisuje", async () => {
    const response = await POST(uploadRequest(SVG_AS_PNG));

    expect(response.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("odrzuca niedozwolony typ zadeklarowany przez klienta (400)", async () => {
    const response = await POST(uploadRequest(VALID_PNG, "image/svg+xml", "obraz.svg"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Invalid file type");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("zwraca 400, gdy w żądaniu nie ma pliku", async () => {
    const response = await POST(uploadRequest(null));

    expect(response.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("przepuszcza odpowiedź 401 dla niezalogowanego i nie dekoduje pliku", async () => {
    const unauthorized = Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
    mockRequireAuth.mockResolvedValue(unauthorized);
    mockIsAuthError.mockReturnValue(true);

    const response = await POST(uploadRequest(VALID_PNG));

    expect(response.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("zwraca 429 po przekroczeniu limitu żądań", async () => {
    mockRateLimitCheck.mockReturnValue({ success: false, reset: 30_000 });

    const response = await POST(uploadRequest(VALID_PNG));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("zwraca 500, gdy magazyn plików zawiedzie", async () => {
    mockUpload.mockRejectedValue(new Error("storage down"));

    const response = await POST(uploadRequest(VALID_PNG));

    expect(response.status).toBe(500);
  });
});
