// @vitest-environment node
/**
 * Strażnik G-C2b (brief C, decyzja z recenzji na #111):
 *  1. Inwariant okrężny: adres zwrócony przez lib/storage.upload dla KAŻDEGO
 *     sterownika (gcs z mockiem SDK, vercel-blob z mockiem put, local z mockiem fs)
 *     przyjmuje isOwnUploadUrl — z właściwym źródłem i nazwą obiektu.
 *  2. Test statyczny: decyzja „czy plik trafia do trwałego magazynu" nie jest
 *     zaszyta w tokenie Blob — `BLOB_READ_WRITE_TOKEN` występuje w `src`
 *     tylko w 3 dozwolonych plikach.
 * Negatywy walidatora: __tests__/lib/upload-url.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPut = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...args: unknown[]) => mockPut(...args),
  del: vi.fn(),
}));

const mockGcsSave = vi.fn();
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket() {
      return { file: () => ({ save: (...args: unknown[]) => mockGcsSave(...args) }) };
    }
  },
}));

vi.mock("fs/promises", () => ({
  default: { writeFile: vi.fn(), mkdir: vi.fn() },
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { upload } from "@/lib/storage";
import { isOwnUploadUrl } from "@/lib/upload-url";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const SALON = "7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f";
const TOKEN = "vercel_blob_rw_AbC123xyz_secretpart";

function useEnv(vars: Record<string, string>) {
  for (const key of ["STORAGE_DRIVER", "GCS_BUCKET", "GCS_PUBLIC_BASE_URL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"]) {
    vi.stubEnv(key, vars[key] ?? "");
  }
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  mockGcsSave.mockReset().mockResolvedValue(undefined);
  // Blob zwraca adres swojego store'u z losowym sufiksem — jak prawdziwy put()
  mockPut.mockReset().mockImplementation(async (pathname: string) => {
    const withSuffix = pathname.replace(/\.(\w+)$/, "-Xy12AbCdEf34GhIj56KlMn78OpQr90.$1");
    return {
      url: `https://abc123xyz.public.blob.vercel-storage.com/${withSuffix}`,
      pathname: withSuffix,
    };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CASES = [
  { driver: "gcs", env: { STORAGE_DRIVER: "gcs", GCS_BUCKET: "mh-media" } },
  {
    driver: "gcs",
    env: { STORAGE_DRIVER: "gcs", GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: "https://media.example.pl/mh-media" },
  },
  { driver: "vercel-blob", env: { BLOB_READ_WRITE_TOKEN: TOKEN } },
  { driver: "local", env: {} },
] as const;

describe("G-C2b: upload() -> isOwnUploadUrl() (inwariant okrężny)", () => {
  it.each(CASES)("galeria, sterownik $driver ($env.GCS_PUBLIC_BASE_URL)", async ({ driver, env }) => {
    useEnv(env);
    const { url, pathname } = await upload(Buffer.alloc(16), `${ID}.jpg`, "gallery");
    const match = isOwnUploadUrl(url, { folder: "gallery" });
    expect(match).toEqual({ ok: true, origin: driver, objectName: pathname });
  });

  it.each(CASES.filter((c) => c.driver !== "local"))(
    "enhanced, sterownik $driver ($env.GCS_PUBLIC_BASE_URL)",
    async ({ driver, env }) => {
      useEnv(env);
      const { url, pathname } = await upload(
        Buffer.alloc(16),
        `enhanced-${SALON}-1700000000000.jpg`,
        "enhanced",
      );
      expect(isOwnUploadUrl(url, { folder: "enhanced", salonId: SALON })).toEqual({
        ok: true,
        origin: driver,
        objectName: pathname,
      });
    },
  );

  it("gcs w produkcji: zapis i walidacja zgodne", async () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "mh-media" });
    vi.stubEnv("NODE_ENV", "production");
    const { url } = await upload(Buffer.alloc(16), `${ID}.webp`, "gallery");
    expect(isOwnUploadUrl(url, { folder: "gallery" }).ok).toBe(true);
  });

  it("niepoprawny GCS_PUBLIC_BASE_URL: upload rzuca przed SDK (nie powstaje adres, którego walidator nie przyjmie)", async () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: "mh-media", GCS_PUBLIC_BASE_URL: "https://media.example.pl/" });
    await expect(upload(Buffer.alloc(16), `${ID}.jpg`, "gallery")).rejects.toThrow(/GCS_PUBLIC_BASE_URL/);
    expect(mockGcsSave).not.toHaveBeenCalled();
  });
});

describe("G-C2b: BLOB_READ_WRITE_TOKEN w src tylko w 3 dozwolonych plikach", () => {
  const ALLOWED = ["src/lib/env.ts", "src/lib/storage.ts", "src/lib/upload-url.ts"];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  it("grep po src (z komentarzami) daje tylko env.ts, storage.ts, upload-url.ts", () => {
    const root = process.cwd();
    const hits = walk(join(root, "src"))
      .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("BLOB_READ_WRITE_TOKEN"))
      .map((f) => relative(root, f).split(sep).join("/"))
      .sort();
    expect(hits).toEqual(ALLOWED);
  });
});
