import { existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { put, del } from "@vercel/blob";
import { gcsPublicTarget, type GcsPublicTarget } from "@/lib/gcs-config";
import type { File as GcsFile } from "@google-cloud/storage";

/**
 * Sterownik magazynu plików (brief C, sekcja 2 — zadanie 0.8).
 *
 * `STORAGE_DRIVER` = `gcs` | `vercel-blob` | `local`.
 * - Brak zmiennej → zachowanie sprzed C2: `BLOB_READ_WRITE_TOKEN` → `vercel-blob`,
 *   inaczej `local`. Produkcja na Vercelu nie wymaga więc żadnej zmiany
 *   (strażnik G-C3 — drugi nośnik do progu C4, gdy znika `vercel-blob`).
 * - `gcs` → Google Cloud Storage przez ADC (tożsamość konta serwisowego usługi
 *   Cloud Run). Żadnych kluczy JSON ani zmiennej z poświadczeniem. Wymaga
 *   `GCS_BUCKET`; opcjonalnie `GCS_PUBLIC_BASE_URL` (domyślnie
 *   `https://storage.googleapis.com/<bucket>`; zasady w lib/gcs-config).
 * - `local` przy `NODE_ENV=production` → błąd (fail-closed): system plików
 *   Cloud Run jest ulotny, a użytkownik `node` nie pisze do `/app/public`.
 *   Ciche „udane" wgranie pliku, który znika, jest gorsze niż błąd.
 * - Nieznana wartość (literówka) → błąd, nie cichy powrót do innego sterownika.
 */
export type StorageDriver = "gcs" | "vercel-blob" | "local";

/** Podzbiór środowiska czytany przez sterownik (w testach — zwykły obiekt). */
type StorageEnv = Readonly<Record<string, string | undefined>>;

const STORAGE_DRIVERS: readonly StorageDriver[] = ["gcs", "vercel-blob", "local"];

export function resolveStorageDriver(env: StorageEnv = process.env): StorageDriver {
  const raw = env.STORAGE_DRIVER?.trim();
  let driver: StorageDriver;
  if (!raw) {
    driver = env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
  } else if ((STORAGE_DRIVERS as readonly string[]).includes(raw)) {
    driver = raw as StorageDriver;
  } else {
    throw new Error(
      `Unknown STORAGE_DRIVER "${raw}". Allowed: ${STORAGE_DRIVERS.join(", ")}`,
    );
  }

  if (driver === "local" && env.NODE_ENV === "production") {
    throw new Error(
      "Local file storage is disabled in production. Set STORAGE_DRIVER=gcs (with GCS_BUCKET) or BLOB_READ_WRITE_TOKEN.",
    );
  }
  return driver;
}

/**
 * Zasobnik i publiczny prefiks adresów — z lib/gcs-config, tego samego źródła,
 * z którego korzysta walidator „czy to nasz upload" (C2b, G-C2b).
 * Niepoprawny `GCS_BUCKET`/`GCS_PUBLIC_BASE_URL` rzuca przed wywołaniem SDK.
 */
function gcsTarget(env: StorageEnv = process.env): GcsPublicTarget {
  const target = gcsPublicTarget(env);
  if (!target) {
    throw new Error("STORAGE_DRIVER=gcs requires GCS_BUCKET");
  }
  return target;
}

/** Koduje każdy segment ścieżki osobno (spacje, polskie znaki), zachowując `/`. */
function encodeObjectPath(pathname: string): string {
  return pathname.split("/").map(encodeURIComponent).join("/");
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
};

async function gcsBucket(bucket: string) {
  // Import leniwy: Vercel (vercel-blob/local) nie ładuje SDK Google w ogóle.
  const { Storage } = await import("@google-cloud/storage");
  return new Storage().bucket(bucket);
}

/**
 * Uchwyt obiektu w skonfigurowanym zasobniku (odczyt przez SDK, bez HTTP po
 * adresie od klienta — lib/own-upload-image). `objectName` musi pochodzić
 * z walidatora isOwnUploadUrl.
 */
export async function gcsFile(objectName: string): Promise<GcsFile> {
  const { bucket } = gcsTarget();
  return (await gcsBucket(bucket)).file(objectName);
}

/**
 * Result from uploading a file to storage
 */
export interface StorageResult {
  url: string; // Public URL to access the file
  pathname: string; // Path/key of the stored file
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Maximum file size in bytes (default: 5MB) */
  maxSize?: number;
  /** Allowed MIME types (default: images and documents) */
  allowedTypes?: string[];
}

/**
 * Default storage configuration
 */
const DEFAULT_CONFIG: Required<StorageConfig> = {
  maxSize: 5 * 1024 * 1024, // 5MB
  allowedTypes: [
    // Images
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    // Documents
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
  ],
};

/**
 * Allowed file extensions mapped from MIME types
 */
const ALLOWED_EXTENSIONS = new Set([
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
]);

/**
 * Sanitize a filename by removing dangerous characters and path traversal attempts
 */
export function sanitizeFilename(filename: string): string {
  // Remove path components (prevent directory traversal)
  const basename = filename.split(/[/\\]/).pop() || filename;

  // Remove or replace dangerous characters
  const sanitized = basename
    .replace(/[<>:"|?*\x00-\x1f]/g, "") // Remove dangerous chars
    .replace(/\.{2,}/g, ".") // Collapse multiple dots
    .replace(/^\.+/, "") // Remove leading dots
    .trim();

  // Ensure filename is not empty
  if (!sanitized || sanitized.length === 0) {
    throw new Error("Invalid filename");
  }

  // Limit filename length
  if (sanitized.length > 255) {
    const ext = sanitized.slice(sanitized.lastIndexOf("."));
    const name = sanitized.slice(0, 255 - ext.length);
    return name + ext;
  }

  return sanitized;
}

/**
 * Validate file for upload
 */
export function validateFile(
  buffer: Buffer,
  filename: string,
  config: StorageConfig = {}
): { valid: true } | { valid: false; error: string } {
  const { maxSize } = { ...DEFAULT_CONFIG, ...config };

  // Check file size
  if (buffer.length > maxSize) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`,
    };
  }

  // Check file extension
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File type not allowed. Allowed extensions: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
    };
  }

  // Optionally check MIME type if provided
  // Note: For full MIME type validation, consider using a library like 'file-type'

  return { valid: true };
}

/**
 * Uploads a file to storage (GCS, Vercel Blob or local filesystem — see resolveStorageDriver)
 *
 * @param buffer - File contents as a Buffer
 * @param filename - Name of the file (e.g., "image.png")
 * @param folder - Optional folder/prefix (e.g., "avatars")
 * @param config - Optional storage configuration
 * @returns StorageResult with url and pathname
 *
 * @example
 * ```ts
 * const result = await upload(fileBuffer, "avatar.png", "avatars");
 * logger.info("[Storage] File uploaded", { url: result.url }); // https://blob.vercel.io/... or /uploads/avatars/avatar.png
 * ```
 */
export async function upload(
  buffer: Buffer,
  filename: string,
  folder?: string,
  config?: StorageConfig
): Promise<StorageResult> {
  // Sanitize filename
  const sanitizedFilename = sanitizeFilename(filename);

  // Validate file
  const validation = validateFile(buffer, sanitizedFilename, config);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const driver = resolveStorageDriver();

  if (driver === "gcs") {
    const { bucket, publicBase } = gcsTarget();
    const pathname = folder ? `${folder}/${sanitizedFilename}` : sanitizedFilename;
    const ext = sanitizedFilename.slice(sanitizedFilename.lastIndexOf(".")).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    await (await gcsBucket(bucket)).file(pathname).save(buffer, {
      resumable: false,
      contentType,
    });

    return {
      url: `${publicBase}/${encodeObjectPath(pathname)}`,
      pathname,
    };
  }

  if (driver === "vercel-blob") {
    // Use Vercel Blob storage
    const pathname = folder ? `${folder}/${sanitizedFilename}` : sanitizedFilename;
    const blob = await put(pathname, buffer, {
      access: "public",
    });

    return {
      url: blob.url,
      pathname: blob.pathname,
    };
  } else {
    // Use local filesystem storage
    const uploadsDir = join(process.cwd(), "public", "uploads");
    const targetDir = folder ? join(uploadsDir, folder) : uploadsDir;

    // Ensure the directory exists
    if (!existsSync(targetDir)) {
      await mkdir(targetDir, { recursive: true });
    }

    // Write the file
    const filepath = join(targetDir, sanitizedFilename);
    await writeFile(filepath, buffer);

    // Return local URL
    const pathname = folder ? `${folder}/${sanitizedFilename}` : sanitizedFilename;
    const url = `/uploads/${pathname}`;

    return {
      url,
      pathname,
    };
  }
}

/**
 * Deletes a file from storage
 * 
 * @param url - The URL of the file to delete
 * 
 * @example
 * ```ts
 * await deleteFile("https://blob.vercel.io/...");
 * // or
 * await deleteFile("/uploads/avatars/avatar.png");
 * ```
 */
export async function deleteFile(url: string): Promise<void> {
  const driver = resolveStorageDriver();

  if (driver === "gcs") {
    const { bucket, publicBase } = gcsTarget();
    const prefix = `${publicBase}/`;
    if (!url.startsWith(prefix)) {
      // Nie kasujemy niczego spoza naszego zasobnika.
      throw new Error("File URL is outside the configured GCS bucket");
    }
    const pathname = url.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    await (await gcsBucket(bucket)).file(pathname).delete({ ignoreNotFound: true });
    return;
  }

  if (driver === "vercel-blob") {
    // Delete from Vercel Blob
    await del(url);
  } else {
    // Delete from local filesystem
    // Extract pathname from URL (e.g., /uploads/avatars/avatar.png -> avatars/avatar.png)
    const pathname = url.replace(/^\/uploads\//, "");
    const filepath = join(process.cwd(), "public", "uploads", pathname);

    // Only attempt to delete if file exists
    if (existsSync(filepath)) {
      const { unlink } = await import("fs/promises");
      await unlink(filepath);
    }
  }
}





