import { unlink } from "fs/promises";
import path from "path";
import { del } from "@vercel/blob";
import { logger } from "@/lib/logger";
import { isOwnGalleryUploadUrl } from "@/lib/upload-url";

/**
 * Kasowanie plików zdjęcia galerii (DELETE /api/gallery/[id]).
 *
 * Adres zdjęcia pochodzi z wiersza w bazie, a do #32/PATCH-fix dało się tam
 * zapisać dowolny napis. Dlatego niczego nie kasujemy „bo zaczyna się od
 * /uploads/": plik lokalny musi leżeć BEZPOŚREDNIO w public/uploads/gallery/
 * (miniatura: public/uploads/gallery/thumbs/ pod tą samą nazwą), a Blob
 * kasujemy tylko dla adresów z naszego store'u (isOwnGalleryUploadUrl).
 * Wszystko inne jest pomijane — bez unlink, bez del().
 */

const LOCAL_PREFIX = "/uploads/gallery/";
// Nazwa z uploadu to `<uuid>.<ext>`; dopuszczamy szerszy, ale bezpieczny
// zestaw znaków (starsze wpisy). Bez separatorów, %, \, bajtów sterujących.
const SAFE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/;

function galleryDir(): string {
  return path.resolve(process.cwd(), "public", "uploads", "gallery");
}

/**
 * Ścieżki pliku i miniatury dla lokalnego adresu galerii albo null, gdy adres
 * wychodzi poza public/uploads/gallery/ (traversal, zakodowane `..`, `\`,
 * podfoldery, inne foldery uploads).
 */
export function localGalleryFilePaths(url: string): { file: string; thumb: string } | null {
  if (typeof url !== "string" || !url.startsWith(LOCAL_PREFIX)) return null;
  const name = url.slice(LOCAL_PREFIX.length);
  if (!SAFE_NAME_RE.test(name) || name.includes("..")) return null;

  // Druga, niezależna bramka: po rozwiązaniu ścieżki plik musi leżeć
  // dokładnie w katalogu galerii (a miniatura w gallery/thumbs).
  const dir = galleryDir();
  const thumbsDir = path.join(dir, "thumbs");
  const file = path.resolve(dir, name);
  const thumb = path.resolve(thumbsDir, name);
  if (path.dirname(file) !== dir || path.dirname(thumb) !== thumbsDir) return null;

  return { file, thumb };
}

/**
 * Adresy Blob do skasowania (zdjęcie + miniatura) albo [], gdy adres nie jest
 * z naszego store'u. Miniatura: upload zapisuje ją pod `gallery/thumbs/<ta
 * sama nazwa>` (@vercel/blob 2.x domyślnie bez losowego sufiksu).
 */
export function ownBlobGalleryUrls(url: string): string[] {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !isOwnGalleryUploadUrl(url)) return [];
  const thumb = new URL(url);
  thumb.pathname = thumb.pathname.replace(/^\/gallery\//, "/gallery/thumbs/");
  return [url, thumb.href];
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

/**
 * Kasuje pliki zdjęcia. Nigdy nie rzuca: wiersz jest już usunięty, a błąd
 * storage'u ma trafić do logu (do ręcznego sprzątnięcia), nie do 500.
 */
export async function deleteGalleryFiles(
  photoId: string,
  urls: Array<string | null | undefined>
): Promise<void> {
  const blobUrls: string[] = [];

  for (const url of urls) {
    if (!url) continue;

    const local = localGalleryFilePaths(url);
    if (local) {
      try {
        await unlink(local.file);
      } catch (error) {
        if (!isNotFound(error)) {
          logger.warn("[Gallery files] Local unlink failed", { photoId, error: String(error) });
        }
      }
      await unlink(local.thumb).catch(() => {});
      continue;
    }

    const blob = ownBlobGalleryUrls(url);
    if (blob.length > 0) {
      blobUrls.push(...blob);
      continue;
    }

    // Adres spoza naszego uploadu (np. zapisany przed allowlistą) — nie
    // kasujemy niczego, czego nie stworzyliśmy.
    logger.warn("[Gallery files] Skipped file outside gallery storage", { photoId });
  }

  if (blobUrls.length === 0) return;

  try {
    await del(blobUrls);
  } catch (error) {
    // Pathname (bez hosta) wystarcza do sprzątnięcia; token nie trafia do logu.
    logger.error("[Gallery files] Blob delete failed — orphaned files", {
      photoId,
      pathnames: blobUrls.map((u) => new URL(u).pathname),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
