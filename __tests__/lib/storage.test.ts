import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @vercel/blob
const mockPut = vi.fn();
const mockDel = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
}));

// Mock @google-cloud/storage (bez prawdziwego zasobnika — weryfikacja na żywo w kroku D)
const mockGcsSave = vi.fn();
const mockGcsDelete = vi.fn();
const mockGcsFile = vi.fn((_path: string) => ({
  save: (...args: unknown[]) => mockGcsSave(...args),
  delete: (...args: unknown[]) => mockGcsDelete(...args),
}));
const mockGcsBucket = vi.fn((_name: string) => ({ file: mockGcsFile }));
const mockGcsCtor = vi.fn();
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    constructor(...args: unknown[]) {
      mockGcsCtor(...args);
    }
    bucket(name: string) {
      return mockGcsBucket(name);
    }
  },
}));

// Mock fs and fs/promises
const mockExistsSync = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockUnlink = vi.fn();
vi.mock("fs", () => ({
  default: { existsSync: (...args: unknown[]) => mockExistsSync(...args) },
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));
vi.mock("fs/promises", () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

import {
  sanitizeFilename,
  validateFile,
  upload,
  deleteFile,
  resolveStorageDriver,
} from "@/lib/storage";

describe("sanitizeFilename", () => {
  it("should return a normal filename unchanged", () => {
    expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
  });

  it("should remove path traversal components", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("foo/bar/baz.txt")).toBe("baz.txt");
    expect(sanitizeFilename("foo\\bar\\baz.txt")).toBe("baz.txt");
  });

  it("should remove dangerous characters", () => {
    const result = sanitizeFilename('file<>:"|?*.jpg');
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain(":");
    expect(result).not.toContain('"');
    expect(result).not.toContain("|");
    expect(result).not.toContain("?");
    expect(result).not.toContain("*");
  });

  it("should collapse multiple dots", () => {
    expect(sanitizeFilename("file...jpg")).toBe("file.jpg");
  });

  it("should remove leading dots", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("...secret")).toBe("secret");
  });

  it("should throw for empty filename after sanitization", () => {
    expect(() => sanitizeFilename("")).toThrow("Invalid filename");
    expect(() => sanitizeFilename("...")).toThrow("Invalid filename");
  });

  it("should throw for filename that becomes empty after sanitization", () => {
    expect(() => sanitizeFilename("<>:")).toThrow("Invalid filename");
  });

  it("should truncate filenames longer than 255 characters", () => {
    const longName = "a".repeat(300) + ".jpg";
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith(".jpg")).toBe(true);
  });

  it("should handle filenames with spaces", () => {
    expect(sanitizeFilename("my photo.jpg")).toBe("my photo.jpg");
  });

  it("should handle filenames with only extension after sanitization", () => {
    expect(sanitizeFilename(".jpg")).toBe("jpg");
  });

  it("should remove null bytes and control characters", () => {
    const result = sanitizeFilename("file\x00name.txt");
    expect(result).not.toContain("\x00");
  });
});

describe("validateFile", () => {
  it("should return valid for an allowed file type within size limit", () => {
    const buffer = Buffer.alloc(1024); // 1KB
    const result = validateFile(buffer, "photo.jpg");
    expect(result).toEqual({ valid: true });
  });

  it("should return valid for all allowed extensions", () => {
    const buffer = Buffer.alloc(100);
    const extensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".pdf",
      ".txt",
      ".csv",
      ".json",
    ];
    for (const ext of extensions) {
      const result = validateFile(buffer, `file${ext}`);
      expect(result).toEqual({ valid: true });
    }
  });

  it("should reject files that exceed the default 5MB limit", () => {
    const buffer = Buffer.alloc(6 * 1024 * 1024); // 6MB
    const result = validateFile(buffer, "large.jpg");
    expect(result).toEqual({
      valid: false,
      error: expect.stringContaining("5MB"),
    });
  });

  it("should reject files that exceed a custom size limit", () => {
    const buffer = Buffer.alloc(2 * 1024 * 1024); // 2MB
    const result = validateFile(buffer, "file.jpg", {
      maxSize: 1 * 1024 * 1024, // 1MB
    });
    expect(result).toEqual({
      valid: false,
      error: expect.stringContaining("1MB"),
    });
  });

  it("should reject disallowed file extensions", () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, "script.exe");
    expect(result).toEqual({
      valid: false,
      error: expect.stringContaining("not allowed"),
    });
  });

  it("should reject .js files", () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, "malicious.js");
    expect(result).toEqual({
      valid: false,
      error: expect.stringContaining("not allowed"),
    });
  });

  it("should reject .html files", () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, "page.html");
    expect(result).toEqual({
      valid: false,
      error: expect.stringContaining("not allowed"),
    });
  });

  it("should handle uppercase extensions", () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, "PHOTO.JPG");
    expect(result).toEqual({ valid: true });
  });

  it("should accept a file exactly at the size limit", () => {
    const buffer = Buffer.alloc(5 * 1024 * 1024); // Exactly 5MB
    const result = validateFile(buffer, "photo.jpg");
    expect(result).toEqual({ valid: true });
  });

  it("should reject a file 1 byte over the limit", () => {
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    const result = validateFile(buffer, "photo.jpg");
    expect(result).toEqual({
      valid: false,
      error: expect.stringContaining("5MB"),
    });
  });
});

describe("upload", () => {
  let originalBlobToken: string | undefined;

  beforeEach(() => {
    originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    mockPut.mockReset();
    mockDel.mockReset();
    mockExistsSync.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockUnlink.mockReset();
  });

  afterEach(() => {
    // Restore original env value
    if (originalBlobToken !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    } else {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });

  it("should upload to Vercel Blob when BLOB_READ_WRITE_TOKEN is set", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    mockPut.mockResolvedValue({
      url: "https://blob.vercel.io/test.jpg",
      pathname: "test.jpg",
    });

    const buffer = Buffer.alloc(1024);
    const result = await upload(buffer, "test.jpg");

    expect(mockPut).toHaveBeenCalledWith("test.jpg", buffer, {
      access: "public",
    });
    expect(result).toEqual({
      url: "https://blob.vercel.io/test.jpg",
      pathname: "test.jpg",
    });
  });

  it("should prepend folder to pathname when uploading to Vercel Blob", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    mockPut.mockResolvedValue({
      url: "https://blob.vercel.io/avatars/photo.jpg",
      pathname: "avatars/photo.jpg",
    });

    const buffer = Buffer.alloc(1024);
    const result = await upload(buffer, "photo.jpg", "avatars");

    expect(mockPut).toHaveBeenCalledWith("avatars/photo.jpg", buffer, {
      access: "public",
    });
    expect(result).toEqual({
      url: "https://blob.vercel.io/avatars/photo.jpg",
      pathname: "avatars/photo.jpg",
    });
  });

  it("should upload to local filesystem when BLOB_READ_WRITE_TOKEN is not set", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValue(undefined);

    const buffer = Buffer.alloc(1024);
    const result = await upload(buffer, "photo.jpg");

    expect(mockWriteFile).toHaveBeenCalled();
    expect(result.url).toBe("/uploads/photo.jpg");
    expect(result.pathname).toBe("photo.jpg");
  });

  it("should create directory when it does not exist on local filesystem", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    mockExistsSync.mockReturnValue(false);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const buffer = Buffer.alloc(1024);
    await upload(buffer, "photo.jpg");

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining("uploads"),
      { recursive: true }
    );
  });

  it("should include folder in local filesystem URL", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValue(undefined);

    const buffer = Buffer.alloc(1024);
    const result = await upload(buffer, "photo.jpg", "gallery");

    expect(result.url).toBe("/uploads/gallery/photo.jpg");
    expect(result.pathname).toBe("gallery/photo.jpg");
  });

  it("should throw an error when file validation fails", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

    // Buffer exceeding the default 5MB limit
    const buffer = Buffer.alloc(6 * 1024 * 1024);

    await expect(upload(buffer, "large.jpg")).rejects.toThrow(
      /File too large/
    );
  });

  it("should sanitize filenames with path traversal attempts", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValue(undefined);

    const buffer = Buffer.alloc(1024);
    const result = await upload(buffer, "../../etc/photo.jpg");

    // The path traversal should be stripped, leaving only "photo.jpg"
    expect(result.url).toBe("/uploads/photo.jpg");
    expect(result.pathname).toBe("photo.jpg");
  });
});

describe("deleteFile", () => {
  let originalBlobToken: string | undefined;

  beforeEach(() => {
    originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    mockPut.mockReset();
    mockDel.mockReset();
    mockExistsSync.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockUnlink.mockReset();
  });

  afterEach(() => {
    if (originalBlobToken !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
    } else {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });

  it("should delete from Vercel Blob when BLOB_READ_WRITE_TOKEN is set", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "token";
    mockDel.mockResolvedValue(undefined);

    await deleteFile("https://blob.vercel.io/test.jpg");

    expect(mockDel).toHaveBeenCalledWith("https://blob.vercel.io/test.jpg");
  });

  it("should delete local file when it exists", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    mockExistsSync.mockReturnValue(true);
    mockUnlink.mockResolvedValue(undefined);

    await deleteFile("/uploads/avatars/avatar.png");

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining("avatars/avatar.png")
    );
  });

  it("should not attempt to delete local file when it does not exist", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    mockExistsSync.mockReturnValue(false);

    await deleteFile("/uploads/missing.jpg");

    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

describe("resolveStorageDriver (G-C2 / G-C3)", () => {
  it("bez STORAGE_DRIVER i z BLOB_READ_WRITE_TOKEN wybiera vercel-blob (G-C3: Vercel bez zmian)", () => {
    expect(resolveStorageDriver({ BLOB_READ_WRITE_TOKEN: "t", NODE_ENV: "production" })).toBe("vercel-blob");
  });

  it("bez STORAGE_DRIVER i bez tokenu poza produkcją wybiera local", () => {
    expect(resolveStorageDriver({ NODE_ENV: "development" })).toBe("local");
    expect(resolveStorageDriver({ NODE_ENV: "test" })).toBe("local");
  });

  it("pusta i biała wartość STORAGE_DRIVER = brak zmiennej", () => {
    expect(resolveStorageDriver({ STORAGE_DRIVER: "", BLOB_READ_WRITE_TOKEN: "t" })).toBe("vercel-blob");
    expect(resolveStorageDriver({ STORAGE_DRIVER: "  ", NODE_ENV: "test" })).toBe("local");
  });

  it("jawny wybór wygrywa z tokenem Blob", () => {
    expect(resolveStorageDriver({ STORAGE_DRIVER: "gcs", BLOB_READ_WRITE_TOKEN: "t" })).toBe("gcs");
    expect(resolveStorageDriver({ STORAGE_DRIVER: "vercel-blob" })).toBe("vercel-blob");
  });

  it("local przy NODE_ENV=production rzuca — jawnie i domyślnie (fail-closed)", () => {
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "local", NODE_ENV: "production" })).toThrow(
      /disabled in production/,
    );
    expect(() => resolveStorageDriver({ NODE_ENV: "production" })).toThrow(/disabled in production/);
  });

  it("literówka w STORAGE_DRIVER rzuca, zamiast cicho wybrać inny sterownik", () => {
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "gsc" })).toThrow(/Unknown STORAGE_DRIVER "gsc"/);
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "GCS" })).toThrow(/Unknown STORAGE_DRIVER/);
  });
});

describe("upload / deleteFile — sterownik gcs (mock SDK)", () => {
  beforeEach(() => {
    mockGcsSave.mockReset().mockResolvedValue(undefined);
    mockGcsDelete.mockReset().mockResolvedValue(undefined);
    mockGcsFile.mockClear();
    mockGcsBucket.mockClear();
    mockGcsCtor.mockClear();
    mockPut.mockReset();
    mockWriteFile.mockReset();
    vi.stubEnv("STORAGE_DRIVER", "gcs");
    vi.stubEnv("GCS_BUCKET", "mh-media");
    vi.stubEnv("GCS_PUBLIC_BASE_URL", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("wgrywa przez klienta GCS (ADC — konstruktor bez argumentów) i zwraca adres storage.googleapis.com/<zasobnik>/…", async () => {
    const buffer = Buffer.alloc(1024);
    const result = await upload(buffer, "photo.jpg", "gallery");

    expect(mockGcsCtor).toHaveBeenCalledWith();
    expect(mockGcsBucket).toHaveBeenCalledWith("mh-media");
    expect(mockGcsFile).toHaveBeenCalledWith("gallery/photo.jpg");
    expect(mockGcsSave).toHaveBeenCalledWith(buffer, { resumable: false, contentType: "image/jpeg" });
    expect(result).toEqual({
      url: "https://storage.googleapis.com/mh-media/gallery/photo.jpg",
      pathname: "gallery/photo.jpg",
    });
    expect(mockPut).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("działa także przy NODE_ENV=production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await upload(Buffer.alloc(10), "a.png");
    expect(result.url).toBe("https://storage.googleapis.com/mh-media/a.png");
  });

  it("brak GCS_BUCKET rzuca przed jakimkolwiek wywołaniem SDK", async () => {
    vi.stubEnv("GCS_BUCKET", "");
    await expect(upload(Buffer.alloc(10), "photo.jpg")).rejects.toThrow(/requires GCS_BUCKET/);
    expect(mockGcsSave).not.toHaveBeenCalled();
  });

  it("koduje spacje i polskie znaki w adresie, ale nie w nazwie obiektu", async () => {
    const result = await upload(Buffer.alloc(10), "zdjęcie ślubne.jpg", "gallery");
    expect(mockGcsFile).toHaveBeenCalledWith("gallery/zdjęcie ślubne.jpg");
    expect(result.url).toBe(
      "https://storage.googleapis.com/mh-media/gallery/zdj%C4%99cie%20%C5%9Blubne.jpg",
    );
    expect(result.pathname).toBe("gallery/zdjęcie ślubne.jpg");
  });

  it("GCS_PUBLIC_BASE_URL z ukośnikiem końcowym nie daje podwójnego ukośnika", async () => {
    vi.stubEnv("GCS_PUBLIC_BASE_URL", "https://media.example.pl/");
    const result = await upload(Buffer.alloc(10), "a.webp", "gallery");
    expect(result.url).toBe("https://media.example.pl/gallery/a.webp");
  });

  it("nieznane rozszerzenie nie przejdzie walidacji (contentType z mapy, nie z wejścia)", async () => {
    await expect(upload(Buffer.alloc(10), "x.exe")).rejects.toThrow(/not allowed/);
    expect(mockGcsSave).not.toHaveBeenCalled();
  });

  it("błąd SDK przechodzi do wywołującego (trasa zwraca kontrolowane 500)", async () => {
    mockGcsSave.mockRejectedValue(new Error("403 forbidden"));
    await expect(upload(Buffer.alloc(10), "a.jpg")).rejects.toThrow("403 forbidden");
  });

  it("deleteFile kasuje obiekt z naszego zasobnika (dekodując ścieżkę)", async () => {
    await deleteFile("https://storage.googleapis.com/mh-media/gallery/zdj%C4%99cie%20a.jpg");
    expect(mockGcsFile).toHaveBeenCalledWith("gallery/zdjęcie a.jpg");
    expect(mockGcsDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it("deleteFile odmawia adresu spoza zasobnika (w tym cudzego zasobnika o wspólnym prefiksie)", async () => {
    await expect(deleteFile("https://storage.googleapis.com/mh-media-other/a.jpg")).rejects.toThrow(
      /outside the configured GCS bucket/,
    );
    await expect(deleteFile("/uploads/a.jpg")).rejects.toThrow(/outside/);
    expect(mockGcsDelete).not.toHaveBeenCalled();
  });
});

describe("upload — local przy NODE_ENV=production (G-C2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rzuca zamiast zapisać na ulotny dysk", async () => {
    mockWriteFile.mockReset();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("STORAGE_DRIVER", "");
    await expect(upload(Buffer.alloc(10), "a.jpg")).rejects.toThrow(/disabled in production/);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
