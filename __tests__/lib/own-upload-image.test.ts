// @vitest-environment node
/**
 * loadOwnUploadImage (C2b) — odczyt obrazu tylko z naszego magazynu:
 *  - gcs: przez SDK (getMetadata -> download) na nazwie obiektu z walidatora,
 *    ZERO fetch na adres od klienta;
 *  - local: z dysku public/uploads/<objectName>;
 *  - adres spoza allowlisty: not_allowed bez SDK i bez fetch.
 * Ścieżka Blob (fetch, redirect: manual, limity): __tests__/api/ai-image-enhance.test.ts.
 */
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetMetadata = vi.fn();
const mockDownload = vi.fn();
const mockFile = vi.fn((_name: string) => ({
  getMetadata: () => mockGetMetadata(),
  download: () => mockDownload(),
}));
const mockBucket = vi.fn((_name: string) => ({ file: mockFile }));
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket(name: string) {
      return mockBucket(name);
    }
  },
}));

const mockReadFile = vi.fn();
vi.mock("fs/promises", () => ({
  default: { readFile: (...a: unknown[]) => mockReadFile(...a) },
  readFile: (...a: unknown[]) => mockReadFile(...a),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { loadOwnUploadImage } from "@/lib/own-upload-image";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const SALON = "7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f";
const GCS_URL = `https://storage.googleapis.com/mh-media/gallery/${ID}.jpg`;
const MAX = 1000;

const fetchSpy = vi.spyOn(globalThis, "fetch");

function useEnv(vars: Record<string, string>) {
  for (const key of ["STORAGE_DRIVER", "GCS_BUCKET", "GCS_PUBLIC_BASE_URL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"]) {
    vi.stubEnv(key, vars[key] ?? "");
  }
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  fetchSpy.mockReset();
  mockGetMetadata.mockReset().mockResolvedValue([{ contentType: "image/jpeg", size: "100" }]);
  mockDownload.mockReset().mockResolvedValue([Buffer.alloc(100)]);
  mockFile.mockClear();
  mockBucket.mockClear();
  mockReadFile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gcs — odczyt przez SDK", () => {
  beforeEach(() => useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "mh-media" }));

  it("happy path: getMetadata -> download na nazwie obiektu, bez fetch", async () => {
    const result = await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX });
    expect(result).toEqual({ ok: true, buffer: Buffer.alloc(100) });
    expect(mockBucket).toHaveBeenCalledWith("mh-media");
    expect(mockFile).toHaveBeenCalledWith(`gallery/${ID}.jpg`);
    expect(mockGetMetadata).toHaveBeenCalledTimes(1);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("enhanced własnego salonu", async () => {
    const url = `https://storage.googleapis.com/mh-media/enhanced/enhanced-${SALON}-1700000000000.jpg`;
    const result = await loadOwnUploadImage(url, SALON, { maxBytes: MAX });
    expect(result.ok).toBe(true);
    expect(mockFile).toHaveBeenCalledWith(`enhanced/enhanced-${SALON}-1700000000000.jpg`);
  });

  it("rozmiar z metadanych ponad limit -> too_large bez download", async () => {
    mockGetMetadata.mockResolvedValue([{ contentType: "image/jpeg", size: String(MAX + 1) }]);
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "too_large" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("brak/nieliczbowy rozmiar -> fetch_failed bez download", async () => {
    mockGetMetadata.mockResolvedValue([{ contentType: "image/jpeg" }]);
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "fetch_failed" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it.each(["text/html", "image/svg+xml", "", "application/octet-stream"])(
    "Content-Type %s -> not_image bez download",
    async (contentType) => {
      mockGetMetadata.mockResolvedValue([{ contentType, size: "10" }]);
      expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "not_image" });
      expect(mockDownload).not.toHaveBeenCalled();
    },
  );

  it("Content-Type z parametrami i wielkimi literami jest normalizowany", async () => {
    mockGetMetadata.mockResolvedValue([{ contentType: "Image/PNG; charset=binary", size: "10" }]);
    expect((await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).ok).toBe(true);
  });

  it("pobrana treść ponad limit (obiekt zmieniony po getMetadata) -> too_large", async () => {
    mockDownload.mockResolvedValue([Buffer.alloc(MAX + 1)]);
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "too_large" });
  });

  it("błąd SDK (404/403) -> fetch_failed, nie wyjątek", async () => {
    mockGetMetadata.mockRejectedValue(new Error("No such object"));
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "fetch_failed" });
    mockGetMetadata.mockResolvedValue([{ contentType: "image/jpeg", size: "10" }]);
    mockDownload.mockRejectedValue(new Error("403"));
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "fetch_failed" });
  });

  it("timeout SDK -> fetch_failed", async () => {
    mockGetMetadata.mockReturnValue(new Promise(() => {}));
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: "fetch_failed",
    });
  });

  it.each([
    `https://storage.googleapis.com/mh-media-evil/gallery/${ID}.jpg`,
    `https://mh-media.storage.googleapis.com/gallery/${ID}.jpg`,
    `https://storage.googleapis.com/mh-media/gallery/${ID}.jpg?alt=media`,
    "http://169.254.169.254/computeMetadata/v1/",
    `https://storage.googleapis.com/mh-media/enhanced/enhanced-0a0b0c0d-1e1f-4a2b-9c3d-4e5f6a7b8c9d-1700000000000.jpg`,
  ])("spoza allowlisty %s -> not_allowed bez SDK i bez fetch", async (url) => {
    expect(await loadOwnUploadImage(url, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "not_allowed" });
    expect(mockFile).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("local — odczyt z dysku", () => {
  beforeEach(() => useEnv({}));

  it("czyta public/uploads/<objectName>, bez fetch i bez SDK", async () => {
    mockReadFile.mockResolvedValue(Buffer.alloc(5));
    const result = await loadOwnUploadImage(`/uploads/gallery/${ID}.png`, SALON, { maxBytes: MAX });
    expect(result).toEqual({ ok: true, buffer: Buffer.alloc(5) });
    expect(mockReadFile).toHaveBeenCalledWith(join(process.cwd(), "public", "uploads", "gallery", `${ID}.png`));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("adres GCS przy braku GCS_BUCKET -> not_allowed", async () => {
    expect(await loadOwnUploadImage(GCS_URL, SALON, { maxBytes: MAX })).toEqual({ ok: false, reason: "not_allowed" });
  });
});
