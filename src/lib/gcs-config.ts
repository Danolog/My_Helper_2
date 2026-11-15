/**
 * Konfiguracja publicznego adresu zasobnika GCS (C2b).
 *
 * Jedno miejsce, z którego korzystają: zapis (lib/storage.upload), walidacja
 * „czy to nasz upload" (lib/upload-url.ownUploadOrigins) i CSP (proxy.ts).
 * Dzięki temu adres, który zwraca upload, jest dokładnie tym, który przyjmuje
 * walidator (inwariant okrężny, strażnik G-C2b).
 *
 * Moduł jest czysty (bez SDK, fs, sieci) — można go importować w proxy.
 *
 * Zasady:
 * - brak `GCS_BUCKET` (lub pusta/biała wartość) → `null`: GCS nie jest skonfigurowany;
 * - nazwa zasobnika według reguł GCS: małe litery, cyfry, `-`, `_`, `.`,
 *   3–222 znaki, bez `..`, zaczyna i kończy się literą lub cyfrą;
 * - `GCS_PUBLIC_BASE_URL` (opcjonalny, domyślnie
 *   `https://storage.googleapis.com/<bucket>`): tylko `https:`, bez portu,
 *   userinfo, query i fragmentu, w postaci kanonicznej; ścieżka to dokładnie
 *   `/<bucket>`. Postać wirtualnego hosta `<bucket>.storage.googleapis.com`
 *   jest odrzucana;
 * - konfiguracja niepoprawna → wyjątek. Zapis wtedy nie startuje, a walidator
 *   i CSP traktują GCS jako nieskonfigurowany (fail-closed).
 */

export interface GcsPublicTarget {
  bucket: string;
  /** Host publicznych adresów (dokładny, małymi literami). */
  host: string;
  /** Publiczny prefiks adresu, bez ukośnika na końcu: `https://<host>/<bucket>`. */
  publicBase: string;
}

type GcsEnv = Readonly<Record<string, string | undefined>>;

const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

export function gcsPublicTarget(env: GcsEnv = process.env): GcsPublicTarget | null {
  const bucket = env.GCS_BUCKET?.trim();
  if (!bucket) return null;
  if (!BUCKET_RE.test(bucket) || bucket.includes("..")) {
    throw new Error("GCS_BUCKET is not a valid bucket name");
  }

  const rawBase = env.GCS_PUBLIC_BASE_URL?.trim();
  if (!rawBase) {
    return {
      bucket,
      host: "storage.googleapis.com",
      publicBase: `https://storage.googleapis.com/${bucket}`,
    };
  }

  const withSlash = `${rawBase.replace(/\/+$/, "")}/`;
  let parsed: URL;
  try {
    parsed = new URL(withSlash);
  } catch {
    throw new Error("GCS_PUBLIC_BASE_URL is not a valid URL");
  }

  const valid =
    parsed.protocol === "https:" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    // postać kanoniczna: bez wielkich liter w hoście, `?`, `#`, `..`, `%`
    parsed.href === withSlash &&
    parsed.pathname === `/${bucket}/` &&
    !parsed.hostname.endsWith(".storage.googleapis.com");
  if (!valid) {
    throw new Error(
      "GCS_PUBLIC_BASE_URL must be https://<host>/<GCS_BUCKET> (no port, credentials, query or fragment)",
    );
  }

  return { bucket, host: parsed.hostname, publicBase: `https://${parsed.hostname}/${bucket}` };
}
