import { readFile } from "fs/promises";
import { join } from "path";
import { gcsFile } from "@/lib/storage";
import { isOwnUploadUrl, type OwnUploadMatch } from "@/lib/upload-url";

/**
 * Wczytuje obraz WYŁĄCZNIE z naszego storage (osłona SSRF).
 *
 * Adres musi przejść allowlistę lib/upload-url.isOwnUploadUrl (zdjęcie galerii
 * albo wynik enhance tego salonu). Wynik walidacji mówi, które źródło pasuje,
 * i dopiero wtedy:
 *  - `local`: plik z dysku `public/uploads/<objectName>` (nazwa zwalidowana
 *    wzorcem: uuid + rozszerzenie, bez traversal) — zero ruchu sieciowego;
 *  - `gcs`: przez SDK (ADC) — `getMetadata()` (limit rozmiaru, Content-Type
 *    z listy obrazów), potem `createReadStream()` z licznikiem bajtów
 *    i terminem: przekroczenie limitu albo terminu niszczy strumień, więc
 *    odczyt nie trwa w tle (#116 pkt 3). Obiekt wskazuje `objectName`
 *    z walidatora, nie adres od klienta: zero HTTP na adres podany przez klienta;
 *  - `vercel-blob`: fetch do `https://<nasz storeId>.public.blob.vercel-storage.com`
 *    bez podążania za przekierowaniem, z timeoutem, limitem rozmiaru
 *    (nagłówek + strumień) i wymaganym Content-Type obrazu. Host jest stały
 *    i należy do Vercela, więc rozwiązywanie DNS/denylista IP nie jest
 *    potrzebna: każdy inny host jest odrzucany przed połączeniem.
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
  let match: OwnUploadMatch = isOwnUploadUrl(url, { folder: "gallery" });
  if (!match.ok) match = isOwnUploadUrl(url, { folder: "enhanced", salonId });
  if (!match.ok) {
    return { ok: false, reason: "not_allowed" };
  }

  if (match.origin === "local") {
    // walidator przepuszcza lokalnie tylko gallery/<uuid>.<ext>
    let buffer: Buffer;
    try {
      buffer = await readFile(join(process.cwd(), "public", "uploads", match.objectName));
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }
    return buffer.length > maxBytes ? { ok: false, reason: "too_large" } : { ok: true, buffer };
  }

  if (match.origin === "gcs") {
    return loadFromGcs(match.objectName, maxBytes, timeoutMs);
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

/** Odrzuca obietnicę po `ms` (SDK nie ma jednego parametru timeoutu na wywołanie). */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("GCS read timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadFromGcs(
  objectName: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<OwnImageLoadResult> {
  let file: Awaited<ReturnType<typeof gcsFile>>;
  let metadata: { contentType?: string | undefined; size?: string | number | undefined };
  try {
    file = await gcsFile(objectName);
    [metadata] = await withTimeout(file.getMetadata(), timeoutMs);
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }

  const contentType = String(metadata.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return { ok: false, reason: "not_image" };
  }

  const size = Number(metadata.size);
  if (!Number.isFinite(size) || size < 0) {
    return { ok: false, reason: "fetch_failed" };
  }
  if (size > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  // obiekt mógł się zmienić między getMetadata() a odczytem — licznik bajtów
  return readGcsObject(file, maxBytes, timeoutMs);
}

/**
 * Czyta treść obiektu strumieniem. Kończy się dokładnie raz:
 *  - koniec strumienia w limicie -> bufor;
 *  - suma kawałków > `maxBytes` -> `too_large` i `destroy()` (reszta nieczytana);
 *  - brak końca w `timeoutMs` (liczone dla całej treści) -> `fetch_failed`
 *    i `destroy()`;
 *  - błąd strumienia albo SDK -> `fetch_failed`.
 */
function readGcsObject(
  file: Awaited<ReturnType<typeof gcsFile>>,
  maxBytes: number,
  timeoutMs: number,
): Promise<OwnImageLoadResult> {
  return new Promise((resolve) => {
    let stream: ReturnType<typeof file.createReadStream>;
    try {
      stream = file.createReadStream();
    } catch {
      resolve({ ok: false, reason: "fetch_failed" });
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: OwnImageLoadResult, abort: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chunks.length = 0;
      if (abort) stream.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "fetch_failed" }, true), timeoutMs);

    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        finish({ ok: false, reason: "too_large" }, true);
        return;
      }
      chunks.push(chunk);
    });
    // Listener błędu zostaje po zakończeniu: destroy() i późne błędy SDK nie
    // mogą wyjść jako nieobsłużony 'error'.
    stream.on("error", () => finish({ ok: false, reason: "fetch_failed" }, true));
    stream.on("end", () => {
      if (settled) return;
      const buffer = Buffer.concat(chunks, total);
      finish({ ok: true, buffer }, false);
    });
  });
}
