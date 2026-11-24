import { unlink } from "fs/promises";
import path from "path";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { galleryPhotos } from "@/lib/schema";
import type { forSalon } from "@/lib/server/repository";
import { isOwnUploadUrl } from "@/lib/upload-url";

/**
 * Kasowanie plików zdjęcia galerii (DELETE /api/gallery/[id]).
 *
 * Adres zdjęcia pochodzi z wiersza w bazie, a do #32/PATCH-fix dało się tam
 * zapisać dowolny napis. Dlatego niczego nie kasujemy „bo zaczyna się od
 * /uploads/": plik lokalny musi leżeć BEZPOŚREDNIO w public/uploads/gallery/
 * (miniatura: public/uploads/gallery/thumbs/ pod tą samą nazwą). Wszystko
 * inne jest pomijane — bez unlink.
 *
 * Vercel Blob ani GCS NIE są kasowane (jak na main). Ścieżka `gallery/<uuid>.<ext>`
 * nie wiąże pliku z salonem, a adresy są publiczne (/api/salons/[id]/gallery),
 * więc del() pozwalałby salonowi A skasować plik salonu B przypięty do
 * własnego wpisu (blokada z audytu bezpieczeństwa i recenzji na #45, B1). Kasowanie Blob wraca razem
 * z powiązaniem pliku z salonem (`gallery/<salonId>/<uuid>`) — osobny PR.
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

    const own = isOwnUploadUrl(url, { folder: "gallery" });
    if (own.ok && own.origin !== "local") {
      // Plik zostaje w Blob/GCS (osierocony) — nazwa obiektu do późniejszego
      // sprzątnięcia (RODO art. 17), bez hosta i tokenu. Bez deleteFile:
      // `gallery/<uuid>` nie wiąże pliku z salonem (salon A skasowałby plik B).
      logger.warn("[Gallery files] Remote file kept — orphaned until tenant-bound delete", {
        photoId,
        storage: own.origin,
        objectName: own.objectName,
      });
      continue;
    }

    // Adres spoza naszego uploadu (np. zapisany przed allowlistą) — nie
    // kasujemy niczego, czego nie stworzyliśmy.
    logger.warn("[Gallery files] Skipped file outside gallery storage", { photoId });
  }
}

type SalonTx = Parameters<Parameters<ReturnType<typeof forSalon>["raw"]>[0]>[0];

/**
 * Czy któryś z adresów jest już przypięty do INNEGO wpisu galerii tego salonu.
 * Bez tego dwa wpisy dzieliłyby plik, a DELETE jednego kasowałby (unlink)
 * zdjęcie drugiego. Zapytanie idzie w kontekście salonu (RLS) — duplikatu
 * w innym salonie stąd nie widać; to domyka powiązanie pliku z salonem
 * (osobny PR, decyzja z recenzji), nie obejście RLS.
 */
export async function hasGalleryUrlConflict(
  tx: SalonTx,
  salonId: string,
  urls: Array<string | null | undefined>,
  excludePhotoId?: string
): Promise<boolean> {
  const wanted = urls.filter((u): u is string => typeof u === "string" && u.length > 0);
  if (wanted.length === 0) return false;

  const conditions = [
    eq(galleryPhotos.salonId, salonId),
    or(inArray(galleryPhotos.beforePhotoUrl, wanted), inArray(galleryPhotos.afterPhotoUrl, wanted)),
  ];
  if (excludePhotoId) conditions.push(ne(galleryPhotos.id, excludePhotoId));

  const [hit] = await tx
    .select({ id: galleryPhotos.id })
    .from(galleryPhotos)
    .where(and(...conditions))
    .limit(1);
  return Boolean(hit);
}
