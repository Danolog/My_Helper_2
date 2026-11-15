/**
 * isOwnGalleryUploadUrl — przyjmuje wyłącznie adresy, które zwraca nasz
 * upload galerii (POST /api/gallery/upload -> lib/storage.upload):
 *  - bez BLOB_READ_WRITE_TOKEN: /uploads/gallery/<uuid>.<ext>
 *  - z tokenem: https://<storeId>.public.blob.vercel-storage.com/gallery/<uuid>.<ext>
 *    (storeId = 4. segment tokenu, jak w @vercel/blob)
 * Wszystko inne (obce hosty, http, adresy metadanych, traversal) -> false.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { isOwnEnhancedUploadUrl, isOwnGalleryUploadUrl } from "@/lib/upload-url";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const TOKEN = "vercel_blob_rw_AbC123xyz_secretpart";
const BLOB_HOST = "abc123xyz.public.blob.vercel-storage.com";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isOwnGalleryUploadUrl — lokalny storage (bez tokenu Blob)", () => {
  it.each(["jpg", "png", "webp", "gif"])("przyjmuje /uploads/gallery/<uuid>.%s", (ext) => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(isOwnGalleryUploadUrl(`/uploads/gallery/${ID}.${ext}`)).toBe(true);
  });

  it.each([
    [`/uploads/gallery/${ID}.svg`, "rozszerzenie spoza uploadu"],
    [`/uploads/gallery/${ID}.jpeg`, "upload zapisuje jpg, nie jpeg"],
    [`/uploads/gallery/thumbs/${ID}.jpg`, "miniatura to nie zdjęcie galerii"],
    [`/uploads/avatars/${ID}.jpg`, "inny folder"],
    [`/uploads/gallery/../../.env`, "traversal"],
    [`/uploads/gallery/${ID}.jpg?x=1`, "query"],
    [`//evil.example/uploads/gallery/${ID}.jpg`, "protocol-relative"],
    [`/uploads/gallery/not-a-uuid.jpg`, "nazwa nie z uploadu"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg`, "Blob bez skonfigurowanego tokenu"],
  ])("odrzuca %s (%s)", (url) => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(isOwnGalleryUploadUrl(url)).toBe(false);
  });
});

describe("isOwnGalleryUploadUrl — Vercel Blob (token ustawiony)", () => {
  it("przyjmuje adres naszego store'u", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    expect(isOwnGalleryUploadUrl(`https://${BLOB_HOST}/gallery/${ID}.webp`)).toBe(true);
  });

  it("przyjmuje adres z losowym sufiksem Bloba", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    expect(
      isOwnGalleryUploadUrl(`https://${BLOB_HOST}/gallery/${ID}-Xy12AbCdEf34GhIj56KlMn78OpQr90.jpg`)
    ).toBe(true);
  });

  it.each([
    [`https://other123.public.blob.vercel-storage.com/gallery/${ID}.jpg`, "cudzy store"],
    [`http://${BLOB_HOST}/gallery/${ID}.jpg`, "http zamiast https"],
    [`https://${BLOB_HOST}:8443/gallery/${ID}.jpg`, "port"],
    [`https://user:pw@${BLOB_HOST}/gallery/${ID}.jpg`, "userinfo"],
    [`https://${BLOB_HOST}/avatars/${ID}.jpg`, "inny folder"],
    [`https://${BLOB_HOST}/gallery/${ID}.jpg#x`, "fragment"],
    [`https://${BLOB_HOST}.evil.example/gallery/${ID}.jpg`, "host doklejony jako subdomena"],
    [`http://169.254.169.254/latest/meta-data/`, "metadane chmury"],
    [`https://evil.example/gallery/${ID}.jpg`, "obcy host"],
    [`/uploads/gallery/${ID}.jpg`, "ścieżka lokalna, gdy upload idzie do Bloba"],
    ["javascript:alert(1)", "schemat javascript"],
    ["", "pusty"],
  ])("odrzuca %s (%s)", (url) => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    expect(isOwnGalleryUploadUrl(url)).toBe(false);
  });

  it("odrzuca wszystko z Bloba, gdy token nie ma storeId", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw");
    expect(isOwnGalleryUploadUrl(`https://${BLOB_HOST}/gallery/${ID}.jpg`)).toBe(false);
    expect(isOwnGalleryUploadUrl(`https://.public.blob.vercel-storage.com/gallery/${ID}.jpg`)).toBe(false);
  });
});

describe("isOwnEnhancedUploadUrl — wynik enhance własnego salonu (tylko Blob)", () => {
  const SALON = "7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f";
  const OTHER = "0a0b0c0d-1e1f-4a2b-9c3d-4e5f6a7b8c9d";
  const ok = `https://${BLOB_HOST}/enhanced/enhanced-${SALON}-1700000000000.jpg`;

  it("przyjmuje enhanced/enhanced-<salonId>-<ms>.jpg naszego store'u", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    expect(isOwnEnhancedUploadUrl(ok, SALON)).toBe(true);
  });

  it.each([
    [`https://${BLOB_HOST}/enhanced/enhanced-${OTHER}-1700000000000.jpg`, SALON, "cudzy salon"],
    [`https://${BLOB_HOST}/enhanced/enhanced-${SALON}-1700000000000.png`, SALON, "nie jpg"],
    [`https://${BLOB_HOST}/gallery/enhanced-${SALON}-1700000000000.jpg`, SALON, "inny folder"],
    [`https://other123.public.blob.vercel-storage.com/enhanced/enhanced-${SALON}-1700000000000.jpg`, SALON, "cudzy store"],
    [`${ok}?x=1`, SALON, "query"],
    [ok, ".*", "salonId nie-uuid (regex injection)"],
  ])("odrzuca %s (%s / %s)", (url, salonId) => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", TOKEN);
    expect(isOwnEnhancedUploadUrl(url, salonId)).toBe(false);
  });

  it("bez tokenu Blob (lokalnie enhance zwraca data URI) -> zawsze false", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(isOwnEnhancedUploadUrl(ok, SALON)).toBe(false);
  });
});
