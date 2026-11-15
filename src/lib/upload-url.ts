import { gcsPublicTarget } from "@/lib/gcs-config";
import { resolveStorageDriver, type StorageDriver } from "@/lib/storage";

/**
 * Czy adres pliku pochodzi z NASZEGO uploadu? (C2b — jedno źródło prawdy)
 *
 * lib/storage.upload zapisuje plik w folderze i zwraca adres zależny od
 * sterownika (STORAGE_DRIVER, lib/storage.resolveStorageDriver):
 *  - `local`:       `/uploads/<folder>/<nazwa>`,
 *  - `gcs`:         `https://storage.googleapis.com/<bucket>/<folder>/<nazwa>`
 *                   (albo `GCS_PUBLIC_BASE_URL`, zasady w lib/gcs-config),
 *  - `vercel-blob`: `https://<storeId>.public.blob.vercel-storage.com/<folder>/<nazwa>`,
 *                   storeId to 4. segment tokenu Blob (`vercel_blob_rw_<storeId>_<secret>`,
 *                   jak parseStoreIdFromReadWriteToken w @vercel/blob) albo
 *                   niesekretne `BLOB_STORE_ID`. Blob może dokleić losowy
 *                   sufiks `-<alnum>` przed rozszerzeniem; GCS nie dokleja.
 *
 * `ownUploadOrigins()` zwraca WSZYSTKIE skonfigurowane źródła, nie tylko
 * bieżący sterownik: w okresie przejściowym (krok D) Vercel z `GCS_BUCKET`
 * przyjmuje adresy GCS, a Cloud Run z `BLOB_STORE_ID` przyjmuje stare adresy
 * Blob. Wyjątek: `local` tylko wtedy, gdy upload faktycznie pisze na dysk.
 * Źródło `vercel-blob` i `BLOB_STORE_ID` znikają w C4 (po migracji adresów).
 *
 * Każdy inny adres jest odrzucany: obce hosty, cudzy store/zasobnik, http,
 * porty, userinfo, query/fragment, `%`, traversal, podfoldery. Ten sam
 * walidator osłania trasy, które same czytają obraz (SSRF) — allowlista,
 * nie denylista. Wynik mówi, które źródło pasuje, żeby wywołujący nie
 * zgadywał drugi raz.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
const EXT = "(?:jpg|png|webp|gif)";
const BLOB_SUFFIX = "(?:-[A-Za-z0-9]{1,64})?";

const MAX_URL_LENGTH = 500;
const LOCAL_PREFIX = "/uploads/";

export type OwnUploadOrigin =
  | { driver: "local"; prefix: string }
  | { driver: "gcs"; host: string; bucket: string; prefix: string }
  | { driver: "vercel-blob"; host: string; prefix: string };

export type OwnUploadKind = { folder: "gallery" } | { folder: "enhanced"; salonId: string };

export type OwnUploadMatch =
  | { ok: true; origin: StorageDriver; objectName: string }
  | { ok: false };

const NO_MATCH: OwnUploadMatch = { ok: false };

function blobStoreId(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const fromToken = token ? (token.split("_")[3] ?? "") : "";
  const storeId = fromToken || process.env.BLOB_STORE_ID?.trim() || "";
  return /^[A-Za-z0-9]+$/.test(storeId) ? storeId.toLowerCase() : null;
}

/** Dokładne źródła adresów naszego uploadu z bieżącej konfiguracji (bez wildcardów). */
export function ownUploadOrigins(): OwnUploadOrigin[] {
  const origins: OwnUploadOrigin[] = [];

  let driver: StorageDriver | null;
  try {
    driver = resolveStorageDriver();
  } catch {
    // literówka / local w produkcji: upload i tak rzuca — dysku nie przyjmujemy
    driver = null;
  }
  if (driver === "local") origins.push({ driver: "local", prefix: LOCAL_PREFIX });

  let gcs: ReturnType<typeof gcsPublicTarget>;
  try {
    gcs = gcsPublicTarget();
  } catch {
    gcs = null; // niepoprawna konfiguracja GCS: fail-closed
  }
  if (gcs) {
    origins.push({ driver: "gcs", host: gcs.host, bucket: gcs.bucket, prefix: `${gcs.publicBase}/` });
  }

  const storeId = blobStoreId();
  if (storeId) {
    const host = `${storeId}.public.blob.vercel-storage.com`;
    origins.push({ driver: "vercel-blob", host, prefix: `https://${host}/` });
  }

  return origins;
}

/** Wzorzec nazwy obiektu (bez źródła) dla danego folderu. */
function objectNameRe(kind: OwnUploadKind, driver: StorageDriver): RegExp {
  const suffix = driver === "vercel-blob" ? BLOB_SUFFIX : "";
  if (kind.folder === "gallery") {
    return new RegExp(`^gallery/${UUID}${suffix}\\.${EXT}$`, "i");
  }
  // salonId zwalidowany jako UUID przed złożeniem wzorca (bez regex injection)
  return new RegExp(`^enhanced/enhanced-${kind.salonId}-\\d{13}${suffix}\\.jpg$`, "i");
}

function isSaneInput(url: unknown): url is string {
  return typeof url === "string" && url.length > 0 && url.length <= MAX_URL_LENGTH;
}

/**
 * Sprawdza adres względem `ownUploadOrigins()` i wzorca folderu:
 *  - `{ folder: "gallery" }`: `gallery/<uuid>.<jpg|png|webp|gif>` (POST /api/gallery/upload),
 *  - `{ folder: "enhanced", salonId }`: `enhanced/enhanced-<salonId>-<13 cyfr>.jpg`
 *    (POST /api/ai/image/enhance TEGO salonu; lokalnie enhance zwraca data URI,
 *    więc źródło `local` nie jest tu przyjmowane).
 */
export function isOwnUploadUrl(url: unknown, kind: OwnUploadKind): OwnUploadMatch {
  if (!isSaneInput(url)) return NO_MATCH;
  if (kind.folder === "enhanced" && (typeof kind.salonId !== "string" || !UUID_RE.test(kind.salonId))) {
    return NO_MATCH;
  }

  const origins = ownUploadOrigins();

  // Ścieżka względna: tylko dysk lokalny (bez `//host`, `%`, query — wzorzec jest zakotwiczony).
  if (url.startsWith("/")) {
    if (kind.folder !== "gallery" || url.startsWith("//") || url.includes("%")) return NO_MATCH;
    if (!origins.some((o) => o.driver === "local") || !url.startsWith(LOCAL_PREFIX)) return NO_MATCH;
    const objectName = url.slice(LOCAL_PREFIX.length);
    return objectNameRe(kind, "local").test(objectName)
      ? { ok: true, origin: "local", objectName }
      : NO_MATCH;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NO_MATCH;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    // URL normalizuje "..", host i kodowanie — wymagamy postaci kanonicznej
    parsed.href !== url ||
    parsed.pathname.includes("%")
  ) {
    return NO_MATCH;
  }

  for (const origin of origins) {
    if (origin.driver === "local" || parsed.hostname !== origin.host) continue;
    // GCS: pierwszy segment ścieżki to dokładnie nasz zasobnik (nie `bucket-evil`, nie `bucket.evil`)
    const pathPrefix = origin.driver === "gcs" ? `/${origin.bucket}/` : "/";
    if (!parsed.pathname.startsWith(pathPrefix)) continue;
    const objectName = parsed.pathname.slice(pathPrefix.length);
    if (objectNameRe(kind, origin.driver).test(objectName)) {
      return { ok: true, origin: origin.driver, objectName };
    }
  }
  return NO_MATCH;
}
