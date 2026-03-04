import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @vercel/blob
const mockPut = vi.fn();
const mockDel = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: (...args: unknown[]) => mockDel(...args),
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
