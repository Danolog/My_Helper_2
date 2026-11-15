/**
 * isOwnUploadUrl / ownUploadOrigins (C2b) — przyjmuje wyłącznie adresy, które
 * zwraca nasz upload (lib/storage.upload), dla każdego skonfigurowanego źródła:
 *  - local (tylko gdy upload pisze na dysk): /uploads/gallery/<uuid>.<ext>
 *  - gcs: https://storage.googleapis.com/<bucket>/gallery/<uuid>.<ext>
 *  - vercel-blob: https://<storeId>.public.blob.vercel-storage.com/gallery/<uuid>.<ext>
 *    (storeId = 4. segment tokenu albo BLOB_STORE_ID)
 * Wszystko inne (obce hosty, http, adresy metadanych, traversal) -> { ok: false }.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { isOwnUploadUrl, ownUploadOrigins, type OwnUploadKind } from "@/lib/upload-url";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const TOKEN = "vercel_blob_rw_AbC123xyz_secretpart";
const BLOB_HOST = "abc123xyz.public.blob.vercel-storage.com";
const BUCKET = "mh-media";
const GCS = `https://storage.googleapis.com/${BUCKET}`;
const SALON = "7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f";
const OTHER = "0a0b0c0d-1e1f-4a2b-9c3d-4e5f6a7b8c9d";

const GALLERY: OwnUploadKind = { folder: "gallery" };
const ENHANCED: OwnUploadKind = { folder: "enhanced", salonId: SALON };

function useEnv(vars: Record<string, string>) {
  for (const key of ["STORAGE_DRIVER", "GCS_BUCKET", "GCS_PUBLIC_BASE_URL", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID"]) {
    vi.stubEnv(key, vars[key] ?? "");
  }
}

const gallery = (url: unknown) => isOwnUploadUrl(url, GALLERY).ok;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("local (bez tokenu Blob, bez STORAGE_DRIVER)", () => {
  beforeEach(() => useEnv({}));

  it.each(["jpg", "png", "webp", "gif"])("przyjmuje /uploads/gallery/<uuid>.%s", (ext) => {
    expect(isOwnUploadUrl(`/uploads/gallery/${ID}.${ext}`, GALLERY)).toEqual({
      ok: true,
      origin: "local",
      objectName: `gallery/${ID}.${ext}`,
    });
  });

  it.each([
    [`/uploads/gallery/${ID}.svg`, "rozszerzenie spoza uploadu"],
    [`/uploads/gallery/${ID}.jpeg`, "upload zapisuje jpg, nie jpeg"],
    [`/uploads/gallery/thumbs/${ID}.jpg`, "miniatura to nie zdjęcie galerii"],
    [`/uploads/avatars/${ID}.jpg`, "inny folder"],
    [`/uploads/gallery/../../.env`, "traversal"],
    [`/uploads/gallery/%2e%2e/${ID}.jpg`, "zakodowany traversal"],
    [`/uploads/gallery/${ID}.jpg?x=1`, "query"],
    [`//evil.example/uploads/gallery/${ID}.jpg`, "protocol-relative"],
    [`/uploads/gallery/not-a-uuid.jpg`, "nazwa nie z uploadu"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg`, "Blob bez skonfigurowanego storeId"],
    [`${GCS}/gallery/${ID}.jpg`, "adres GCS przy braku GCS_BUCKET"],
  ])("odrzuca %s (%s)", (url) => {
    expect(gallery(url)).toBe(false);
  });

  it("enhanced lokalnie nie istnieje (enhance zwraca data URI)", () => {
    expect(isOwnUploadUrl(`/uploads/enhanced/enhanced-${SALON}-1700000000000.jpg`, ENHANCED).ok).toBe(false);
  });

  it("local w produkcji (upload rzuca) -> dysku nie przyjmujemy", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(gallery(`/uploads/gallery/${ID}.jpg`)).toBe(false);
  });

  it("literówka w STORAGE_DRIVER -> dysku nie przyjmujemy", () => {
    vi.stubEnv("STORAGE_DRIVER", "gsc");
    expect(gallery(`/uploads/gallery/${ID}.jpg`)).toBe(false);
  });
});

describe("vercel-blob (token ustawiony)", () => {
  beforeEach(() => useEnv({ BLOB_READ_WRITE_TOKEN: TOKEN }));

  it("przyjmuje adres naszego store'u i zwraca nazwę obiektu", () => {
    expect(isOwnUploadUrl(`https://${BLOB_HOST}/gallery/${ID}.webp`, GALLERY)).toEqual({
      ok: true,
      origin: "vercel-blob",
      objectName: `gallery/${ID}.webp`,
    });
  });

  it("przyjmuje adres z losowym sufiksem Bloba", () => {
    expect(gallery(`https://${BLOB_HOST}/gallery/${ID}-Xy12AbCdEf34GhIj56KlMn78OpQr90.jpg`)).toBe(true);
  });

  it.each([
    [`https://other123.public.blob.vercel-storage.com/gallery/${ID}.jpg`, "cudzy store"],
    [`http://${BLOB_HOST}/gallery/${ID}.jpg`, "http zamiast https"],
    [`https://${BLOB_HOST}:8443/gallery/${ID}.jpg`, "port"],
    [`https://user:pw@${BLOB_HOST}/gallery/${ID}.jpg`, "userinfo"],
    [`https://${BLOB_HOST}/avatars/${ID}.jpg`, "inny folder"],
    [`https://${BLOB_HOST}/gallery/sub/${ID}.jpg`, "podfolder"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg#x`, "fragment"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg?x=1`, "query"],
    [`https://${BLOB_HOST}/gallery/%2e%2e/${ID}.jpg`, "zakodowany traversal"],
    [`https://${BLOB_HOST}.evil.example/gallery/${ID}.jpg`, "host doklejony jako subdomena"],
    [`http://169.254.169.254/latest/meta-data/`, "metadane chmury"],
    [`https://evil.example/gallery/${ID}.jpg`, "obcy host"],
    [`/uploads/gallery/${ID}.jpg`, "ścieżka lokalna, gdy upload idzie do Bloba"],
    ["javascript:alert(1)", "schemat javascript"],
    ["", "pusty"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg${"a".repeat(500)}`, "za długi"],
  ])("odrzuca %s (%s)", (url) => {
    expect(gallery(url)).toBe(false);
  });

  it("nie-string -> false", () => {
    expect(gallery(undefined)).toBe(false);
    expect(gallery(123)).toBe(false);
  });

  it("odrzuca wszystko z Bloba, gdy token nie ma storeId (i brak BLOB_STORE_ID)", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw");
    expect(gallery(`https://${BLOB_HOST}/gallery/${ID}.jpg`)).toBe(false);
    expect(gallery(`https://.public.blob.vercel-storage.com/gallery/${ID}.jpg`)).toBe(false);
  });
});

describe("vercel-blob przez BLOB_STORE_ID (Cloud Run przyjmuje stare adresy)", () => {
  it("przyjmuje stary adres Blob bez tokenu, przy sterowniku gcs", () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: BUCKET, BLOB_STORE_ID: "AbC123xyz" });
    expect(isOwnUploadUrl(`https://${BLOB_HOST}/gallery/${ID}.jpg`, GALLERY)).toEqual({
      ok: true,
      origin: "vercel-blob",
      objectName: `gallery/${ID}.jpg`,
    });
  });

  it("odrzuca BLOB_STORE_ID z niedozwolonymi znakami", () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: BUCKET, BLOB_STORE_ID: "abc.evil" });
    expect(gallery(`https://abc.evil.public.blob.vercel-storage.com/gallery/${ID}.jpg`)).toBe(false);
  });
});

describe("gcs", () => {
  beforeEach(() => useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: BUCKET }));

  it("przyjmuje adres naszego zasobnika i zwraca nazwę obiektu", () => {
    expect(isOwnUploadUrl(`${GCS}/gallery/${ID}.png`, GALLERY)).toEqual({
      ok: true,
      origin: "gcs",
      objectName: `gallery/${ID}.png`,
    });
  });

  it("także w produkcji", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(gallery(`${GCS}/gallery/${ID}.png`)).toBe(true);
  });

  it.each([
    [`https://storage.googleapis.com/mh-media-evil/gallery/${ID}.jpg`, "cudzy zasobnik o wspólnym prefiksie (-)"],
    [`https://storage.googleapis.com/mh-media.evil/gallery/${ID}.jpg`, "cudzy zasobnik o wspólnym prefiksie (.)"],
    [`https://storage.googleapis.com/other/gallery/${ID}.jpg`, "cudzy zasobnik"],
    [`https://${BUCKET}.storage.googleapis.com/gallery/${ID}.jpg`, "postać wirtualnego hosta"],
    [`http://storage.googleapis.com/${BUCKET}/gallery/${ID}.jpg`, "http"],
    [`https://storage.googleapis.com:443/${BUCKET}/gallery/${ID}.jpg`, "jawny port (niekanoniczny)"],
    [`https://storage.googleapis.com:8443/${BUCKET}/gallery/${ID}.jpg`, "port"],
    [`https://u:p@storage.googleapis.com/${BUCKET}/gallery/${ID}.jpg`, "userinfo"],
    [`${GCS}/gallery/${ID}.jpg?alt=media`, "query"],
    [`${GCS}/gallery/${ID}.jpg#f`, "fragment"],
    [`${GCS}/gallery/%2e%2e/${ID}.jpg`, "%2e%2e"],
    [`${GCS}/gallery/../gallery/${ID}.jpg`, "traversal (niekanoniczny)"],
    [`${GCS}/gallery/sub/${ID}.jpg`, "podfolder"],
    [`${GCS}/gallery/${ID}-Xy12.jpg`, "sufiks Bloba (GCS go nie dokleja)"],
    [`${GCS}/gallery/thumbs/${ID}.jpg`, "miniatura"],
    [`${GCS}/${ID}.jpg`, "bez folderu"],
    [`https://storage.googleapis.com/gallery/${ID}.jpg`, "bez zasobnika"],
    [`https://STORAGE.googleapis.com/${BUCKET}/gallery/${ID}.jpg`, "wielkie litery w hoście (niekanoniczny)"],
    [`/uploads/gallery/${ID}.jpg`, "ścieżka lokalna przy gcs"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg`, "adres Blob bez storeId"],
  ])("odrzuca %s (%s)", (url) => {
    expect(gallery(url)).toBe(false);
  });

  it("GCS_PUBLIC_BASE_URL: przyjmuje własny host z /<bucket>, odrzuca storage.googleapis.com", () => {
    vi.stubEnv("GCS_PUBLIC_BASE_URL", `https://media.example.pl/${BUCKET}/`);
    expect(gallery(`https://media.example.pl/${BUCKET}/gallery/${ID}.jpg`)).toBe(true);
    expect(gallery(`${GCS}/gallery/${ID}.jpg`)).toBe(false);
    expect(gallery(`https://media.example.pl.evil/${BUCKET}/gallery/${ID}.jpg`)).toBe(false);
  });

  it.each([
    ["http://media.example.pl/mh-media", "http"],
    ["https://media.example.pl:8443/mh-media", "port"],
    ["https://u:p@media.example.pl/mh-media", "userinfo"],
    ["https://media.example.pl/mh-media?x=1", "query"],
    ["https://media.example.pl/mh-media#x", "fragment"],
    ["https://media.example.pl", "bez segmentu zasobnika"],
    ["https://media.example.pl/other", "inny segment niż zasobnik"],
    ["https://media.example.pl/mh-media/sub", "dodatkowy segment"],
    ["https://mh-media.storage.googleapis.com/mh-media", "postać wirtualnego hosta"],
    ["not a url", "nie URL"],
  ])("niepoprawny GCS_PUBLIC_BASE_URL %s (%s) -> źródło GCS wyłączone", (base) => {
    vi.stubEnv("GCS_PUBLIC_BASE_URL", base);
    expect(ownUploadOrigins().some((o) => o.driver === "gcs")).toBe(false);
    expect(gallery(`${GCS}/gallery/${ID}.jpg`)).toBe(false);
  });

  it("niepoprawna nazwa zasobnika -> źródło GCS wyłączone", () => {
    vi.stubEnv("GCS_BUCKET", "Bad/Bucket");
    expect(ownUploadOrigins().some((o) => o.driver === "gcs")).toBe(false);
  });
});

describe("enhanced — wynik enhance własnego salonu", () => {
  const blobOk = `https://${BLOB_HOST}/enhanced/enhanced-${SALON}-1700000000000.jpg`;
  const gcsOk = `${GCS}/enhanced/enhanced-${SALON}-1700000000000.jpg`;

  it("Blob: przyjmuje enhanced/enhanced-<salonId>-<ms>.jpg naszego store'u", () => {
    useEnv({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(isOwnUploadUrl(blobOk, ENHANCED)).toEqual({
      ok: true,
      origin: "vercel-blob",
      objectName: `enhanced/enhanced-${SALON}-1700000000000.jpg`,
    });
  });

  it("gcs: przyjmuje enhanced/enhanced-<salonId>-<ms>.jpg naszego zasobnika", () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: BUCKET });
    expect(isOwnUploadUrl(gcsOk, ENHANCED).ok).toBe(true);
  });

  it.each([
    [`https://${BLOB_HOST}/enhanced/enhanced-${OTHER}-1700000000000.jpg`, SALON, "cudzy salon"],
    [`https://${BLOB_HOST}/enhanced/enhanced-${SALON}-1700000000000.png`, SALON, "nie jpg"],
    [`https://${BLOB_HOST}/gallery/enhanced-${SALON}-1700000000000.jpg`, SALON, "inny folder"],
    [`https://other123.public.blob.vercel-storage.com/enhanced/enhanced-${SALON}-1700000000000.jpg`, SALON, "cudzy store"],
    [`${blobOk}?x=1`, SALON, "query"],
    [blobOk, ".*", "salonId nie-uuid (regex injection)"],
  ])("odrzuca %s (%s / %s)", (url, salonId) => {
    useEnv({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(isOwnUploadUrl(url, { folder: "enhanced", salonId }).ok).toBe(false);
  });

  it("gcs: cudzy salon i cudzy zasobnik odrzucone", () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: BUCKET });
    expect(isOwnUploadUrl(gcsOk, { folder: "enhanced", salonId: OTHER }).ok).toBe(false);
    expect(
      isOwnUploadUrl(gcsOk.replace(`/${BUCKET}/`, `/${BUCKET}-evil/`), ENHANCED).ok,
    ).toBe(false);
  });

  it("adres galerii nie przechodzi jako enhanced i odwrotnie", () => {
    useEnv({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(isOwnUploadUrl(`https://${BLOB_HOST}/gallery/${ID}.jpg`, ENHANCED).ok).toBe(false);
    expect(isOwnUploadUrl(blobOk, GALLERY).ok).toBe(false);
  });

  it("lokalnie (enhance zwraca data URI) -> zawsze false", () => {
    useEnv({});
    expect(isOwnUploadUrl(blobOk, ENHANCED).ok).toBe(false);
  });
});

describe("ownUploadOrigins — wszystkie skonfigurowane źródła (okres przejściowy, krok D)", () => {
  it("Vercel z GCS_BUCKET: Blob (bieżący) + GCS, bez dysku", () => {
    useEnv({ BLOB_READ_WRITE_TOKEN: TOKEN, GCS_BUCKET: BUCKET });
    expect(ownUploadOrigins()).toEqual([
      { driver: "gcs", host: "storage.googleapis.com", bucket: BUCKET, prefix: `${GCS}/` },
      { driver: "vercel-blob", host: BLOB_HOST, prefix: `https://${BLOB_HOST}/` },
    ]);
  });

  it("Cloud Run z BLOB_STORE_ID: GCS (bieżący) + stary Blob", () => {
    useEnv({ STORAGE_DRIVER: "gcs", GCS_BUCKET: BUCKET, BLOB_STORE_ID: "AbC123xyz" });
    expect(ownUploadOrigins().map((o) => o.driver)).toEqual(["gcs", "vercel-blob"]);
  });

  it("dev bez konfiguracji: tylko dysk", () => {
    useEnv({});
    expect(ownUploadOrigins()).toEqual([{ driver: "local", prefix: "/uploads/" }]);
  });

  it("brak wildcardów w źródłach", () => {
    useEnv({ BLOB_READ_WRITE_TOKEN: TOKEN, GCS_BUCKET: BUCKET });
    for (const o of ownUploadOrigins()) expect(o.prefix).not.toContain("*");
  });
});
