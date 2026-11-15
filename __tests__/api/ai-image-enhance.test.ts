/**
 * POST /api/ai/image/enhance — SSRF (P1, bramka przed GCP).
 *
 * Trasa pobiera obraz po adresie z żądania. Na Cloud Run dowolny adres =
 * serwer metadanych (169.254.169.254 / metadata.google.internal) i token
 * konta usługi. UI (components/gallery/photo-enhance-dialog.tsx) wysyła
 * wyłącznie adres zdjęcia galerii (before/afterPhotoUrl) albo — po
 * zaakceptowaniu — adres zwrócony przez sam enhance. Dlatego allowlista
 * naszego storage, nie denylista adresów prywatnych.
 *
 * Każdy adres spoza allowlisty -> 400 bez jednego wywołania fetch.
 * Brak prawdziwej sieci: global fetch, storage i fs są zamockowane.
 */
import sharp from "sharp";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/ai/image/enhance/route";
import { createMockRequest, parseResponse } from "./helpers";

const mockRequireProAI = vi.fn();
vi.mock("@/lib/ai/openrouter", () => ({
  requireProAI: (...args: unknown[]) => mockRequireProAI(...args),
  isProAIError: (r: unknown) => r instanceof Response,
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockUpload = vi.fn();
vi.mock("@/lib/storage", () => ({
  upload: (...args: unknown[]) => mockUpload(...args),
}));

const mockReadFile = vi.fn();
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    default: { ...actual, readFile: (...a: unknown[]) => mockReadFile(...a) },
    readFile: (...a: unknown[]) => mockReadFile(...a),
  };
});


const SALON_ID = "7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f";
const OTHER_SALON_ID = "0a0b0c0d-1e1f-4a2b-9c3d-4e5f6a7b8c9d";
const PHOTO_ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const TOKEN = "vercel_blob_rw_AbC123xyz_secretpart";
const BLOB_HOST = "abc123xyz.public.blob.vercel-storage.com";
const GALLERY_BLOB_URL = `https://${BLOB_HOST}/gallery/${PHOTO_ID}.jpg`;

let fetchSpy: ReturnType<typeof vi.fn>;
let PNG: Buffer;

function req(imageUrl: unknown, preset = "auto") {
  return createMockRequest("http://localhost:3000/api/ai/image/enhance", {
    method: "POST",
    body: { imageUrl, preset },
  });
}

function imageResponse(body: Buffer, headers: Record<string, string> = {}) {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(body.length), ...headers },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  PNG ??= await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .png()
    .toBuffer();
  mockRequireProAI.mockResolvedValue({ salonId: SALON_ID });
  mockUpload.mockResolvedValue({
    url: `https://${BLOB_HOST}/enhanced/enhanced-${SALON_ID}-1700000000000.jpg`,
    pathname: `enhanced/enhanced-${SALON_ID}-1700000000000.jpg`,
  });
  fetchSpy = vi.fn(async () => imageResponse(PNG));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/ai/image/enhance — SSRF: adres spoza naszego storage -> 400 bez fetch", () => {
  it.each([
    ["http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token", "metadane GCP (IP)"],
    ["http://metadata.google.internal/computeMetadata/v1/", "metadane GCP (nazwa)"],
    ["http://metadata.google.internal", "metadane GCP bez ścieżki"],
    ["http://localhost/", "loopback po nazwie"],
    ["http://localhost:3000/api/diagnostics", "własny serwer"],
    ["http://[::1]/", "loopback IPv6"],
    ["http://127.1/", "skrócony zapis 127.0.0.1"],
    ["http://0x7f000001/", "127.0.0.1 szesnastkowo"],
    ["http://2130706433/", "127.0.0.1 dziesiętnie"],
    ["http://[::ffff:169.254.169.254]/", "IPv4-mapped IPv6"],
    ["http://[fd00::1]/", "IPv6 ULA"],
    ["http://10.0.0.1/", "sieć prywatna"],
    ["https://evil.example/photo.jpg", "obcy host"],
    ["https://evil.example/redirect?to=http://169.254.169.254/", "obcy host z przekierowaniem"],
    [`https://other123.public.blob.vercel-storage.com/gallery/${PHOTO_ID}.jpg`, "cudzy store Blob"],
    [`http://${BLOB_HOST}/gallery/${PHOTO_ID}.jpg`, "nasz store po http"],
    [`https://${BLOB_HOST}@169.254.169.254/gallery/${PHOTO_ID}.jpg`, "userinfo podszywa host"],
    [`https://${BLOB_HOST}/avatars/${PHOTO_ID}.jpg`, "inny folder"],
    [`https://${BLOB_HOST}/enhanced/enhanced-${OTHER_SALON_ID}-1700000000000.jpg`, "enhanced cudzego salonu"],
    ["file:///etc/passwd", "file:"],
    ["data:image/png;base64,AAAA", "data:"],
  ])("odrzuca %s (%s)", async (imageUrl) => {
    const res = await POST(req(imageUrl));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("brak imageUrl / nie-string -> 400 bez fetch", async () => {
    for (const bad of [undefined, 123, "", "x".repeat(600)]) {
      const res = await POST(req(bad));
      expect(res.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lokalny storage (bez tokenu Blob): adres absolutny -> 400 bez fetch", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const res = await POST(req("http://localhost:3000/uploads/gallery/" + PHOTO_ID + ".jpg"));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/image/enhance — pobranie z naszego Bloba", () => {
  it("nie podąża za przekierowaniem (redirect: manual), 3xx na adres wewnętrzny -> 400", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/computeMetadata/v1/" },
      }),
    );
    const res = await POST(req(GALLERY_BLOB_URL));
    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GALLERY_BLOB_URL);
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("odpowiedź nie-obrazowa (Content-Type) -> 400", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("{\"access_token\":\"x\"}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const res = await POST(req(GALLERY_BLOB_URL));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("Content-Length ponad 10 MB -> 400 bez czytania treści", async () => {
    fetchSpy.mockResolvedValueOnce(
      imageResponse(PNG, { "content-length": String(11 * 1024 * 1024) }),
    );
    const res = await POST(req(GALLERY_BLOB_URL));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("treść ponad 10 MB bez Content-Length -> 400 (limit przy strumieniowaniu)", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    fetchSpy.mockResolvedValueOnce(
      new Response(new Uint8Array(big), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const res = await POST(req(GALLERY_BLOB_URL));
    expect(res.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("timeout / błąd sieci -> 400, nie 500", async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const res = await POST(req(GALLERY_BLOB_URL));
    expect(res.status).toBe(400);
  });

  it("happy path: zdjęcie galerii -> 200, enhanced w Blob", async () => {
    const res = await POST(req(GALLERY_BLOB_URL, "warm"));
    const { status, body: data } = await parseResponse<{
      success: boolean;
      enhancedUrl: string;
      preset: string;
      metadata: { width: number; height: number; format: string };
    }>(res);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.preset).toBe("warm");
    expect(data.metadata).toEqual({ width: 8, height: 8, format: "png" });
    expect(data.enhancedUrl).toContain(`/enhanced/enhanced-${SALON_ID}-`);
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it("ponowny enhance: adres enhanced własnego salonu -> 200", async () => {
    const url = `https://${BLOB_HOST}/enhanced/enhanced-${SALON_ID}-1700000000000.jpg`;
    const res = await POST(req(url));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual" }));
  });
});

describe("POST /api/ai/image/enhance — lokalny storage (dev, bez tokenu Blob)", () => {
  it("czyta /uploads/gallery/<uuid>.<ext> z dysku, bez fetch -> 200", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    mockReadFile.mockResolvedValueOnce(PNG);
    const res = await POST(req(`/uploads/gallery/${PHOTO_ID}.png`));
    const { status, body: data } = await parseResponse<{ success: boolean; enhancedUrl: string }>(res);
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.enhancedUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const [path] = mockReadFile.mock.calls[0] as [string];
    expect(path.endsWith(`public/uploads/gallery/${PHOTO_ID}.png`)).toBe(true);
  });

  it("brak pliku na dysku -> 400", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const res = await POST(req(`/uploads/gallery/${PHOTO_ID}.jpg`));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ai/image/enhance — bramka planu", () => {
  it("bez Pro -> odpowiedź bramki, bez fetch", async () => {
    mockRequireProAI.mockResolvedValueOnce(Response.json({ error: "Pro" }, { status: 403 }));
    const res = await POST(req(GALLERY_BLOB_URL));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
