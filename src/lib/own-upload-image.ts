import { readFile } from "fs/promises";
import { join } from "path";
import { isOwnEnhancedUploadUrl, isOwnGalleryUploadUrl } from "@/lib/upload-url";

/**
 * Wczytuje obraz WYŁĄCZNIE z naszego storage (osłona SSRF).
 *
 * Adres musi przejść allowlistę z lib/upload-url (zdjęcie galerii albo wynik
 * enhance tego salonu). Dopiero wtedy:
 *  - bez BLOB_READ_WRITE_TOKEN: plik z dysku `public/uploads/gallery/...`
 *    (ścieżka już zwalidowana regexem: uuid + rozszerzenie, bez traversal) —
 *    zero ruchu sieciowego;
 *  - z tokenem: fetch do `https://<nasz storeId>.public.blob.vercel-storage.com`
 *    bez podążania za przekierowaniem, z timeoutem, limitem rozmiaru
 *    (nagłówek + strumień) i wymaganym Content-Type obrazu.
 *
 * Host jest stały i należy do Vercela, więc rozwiązywanie DNS/denylista IP
 * nie jest potrzebna: napastnik nie kontroluje DNS vercel-storage.com, a
 * każdy inny host jest odrzucany przed jakimkolwiek połączeniem.
 */

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type OwnImageLoadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; reason: "not_allowed" | "fetch_failed" | "too_large" | "not_image" };

export interface OwnImageLoadOptions {
  maxBytes: number;
  timeoutMs?: number;
}

export async function loadOwnUploadImage(
  url: string,
  salonId: string,
  { maxBytes, timeoutMs = 10_000 }: OwnImageLoadOptions,
): Promise<OwnImageLoadResult> {
  if (!isOwnGalleryUploadUrl(url) && !isOwnEnhancedUploadUrl(url, salonId)) {
    return { ok: false, reason: "not_allowed" };
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // isOwnGalleryUploadUrl bez tokenu przepuszcza tylko /uploads/gallery/<uuid>.<ext>
    let buffer: Buffer;
    try {
      buffer = await readFile(join(process.cwd(), "public", url));
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }
    return buffer.length > maxBytes ? { ok: false, reason: "too_large" } : { ok: true, buffer };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "image/*" },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }

  // redirect: "manual" -> 3xx wraca jako odpowiedź; nie podążamy (status !== 200)
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: "fetch_failed" };
  }

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: "not_image" };
  }

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, reason: "too_large" };
  }

  if (!res.body) return { ok: false, reason: "fetch_failed" };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }

  return { ok: true, buffer: Buffer.concat(chunks) };
}
