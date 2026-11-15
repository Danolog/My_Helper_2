/**
 * Czy adres zdjęcia pochodzi z NASZEGO uploadu galerii?
 *
 * POST /api/gallery/upload zapisuje plik przez lib/storage.upload pod nazwą
 * `<randomUUID>.<ext>` (ext z formatu wykrytego przez sharp: jpg/png/webp/gif)
 * w folderze "gallery". Zwracany adres zależy od środowiska:
 *  - bez BLOB_READ_WRITE_TOKEN: `/uploads/gallery/<uuid>.<ext>` (dysk lokalny),
 *  - z tokenem: `https://<storeId>.public.blob.vercel-storage.com/gallery/<uuid>.<ext>`,
 *    gdzie storeId to 4. segment tokenu (`vercel_blob_rw_<storeId>_<secret>`,
 *    jak parseStoreIdFromReadWriteToken w @vercel/blob). Blob może dokleić
 *    losowy sufiks `-<alnum>` przed rozszerzeniem.
 *
 * Każdy inny adres jest odrzucany: obce hosty, cudzy store, http, porty,
 * userinfo, query/fragment, traversal. Ten sam walidator ma osłonić trasy,
 * które same pobierają obraz (SSRF) — dlatego allowlista, nie denylista.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EXT = "(?:jpg|png|webp|gif)";

const LOCAL_GALLERY_RE = new RegExp(`^/uploads/gallery/${UUID}\\.${EXT}$`, "i");
const BLOB_GALLERY_PATH_RE = new RegExp(`^/gallery/${UUID}(?:-[A-Za-z0-9]{1,64})?\\.${EXT}$`, "i");

const MAX_URL_LENGTH = 500;

function blobStoreId(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const storeId = token.split("_")[3] ?? "";
  return /^[A-Za-z0-9]+$/.test(storeId) ? storeId.toLowerCase() : null;
}

/**
 * Wspólny rdzeń: adres w naszym store Blob (https, dokładny host store'u,
 * bez portu/userinfo/query/fragmentu, w postaci kanonicznej) ze ścieżką
 * pasującą do wzorca.
 */
function isOwnBlobUrl(url: string, pathRe: RegExp): boolean {
  const storeId = blobStoreId();
  if (!storeId) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "https:" &&
    parsed.hostname === `${storeId}.public.blob.vercel-storage.com` &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    // porównanie z surowym wejściem: URL normalizuje "..", więc wymagamy,
    // by adres był już w postaci kanonicznej
    parsed.href === url &&
    pathRe.test(parsed.pathname)
  );
}

function isSaneInput(url: unknown): url is string {
  return typeof url === "string" && url.length > 0 && url.length <= MAX_URL_LENGTH;
}

export function isOwnGalleryUploadUrl(url: string): boolean {
  if (!isSaneInput(url)) return false;

  // Lokalny storage: tylko gdy upload faktycznie zapisuje na dysk.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return LOCAL_GALLERY_RE.test(url);
  }
  return isOwnBlobUrl(url, BLOB_GALLERY_PATH_RE);
}

/**
 * Czy adres to wynik NASZEGO POST /api/ai/image/enhance dla TEGO salonu?
 *
 * Enhance zapisuje `enhanced-<salonId>-<Date.now()>.jpg` w folderze
 * "enhanced" — ale tylko z tokenem Blob; bez tokenu zwraca data URI, którego
 * tu nie przyjmujemy. UI (photo-enhance-dialog) po akceptacji podmienia
 * afterPhotoUrl na ten adres, więc ponowny enhance tego samego zdjęcia
 * wysyła właśnie go. Wiązanie z salonId: salon nie wskaże wyniku innego.
 */
export function isOwnEnhancedUploadUrl(url: string, salonId: string): boolean {
  if (!isSaneInput(url) || !process.env.BLOB_READ_WRITE_TOKEN) return false;
  if (typeof salonId !== "string" || !new RegExp(`^${UUID}$`, "i").test(salonId)) return false;
  const pathRe = new RegExp(
    `^/enhanced/enhanced-${salonId}-\\d{13}(?:-[A-Za-z0-9]{1,64})?\\.jpg$`,
    "i",
  );
  return isOwnBlobUrl(url, pathRe);
}
