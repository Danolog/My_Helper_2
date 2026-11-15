/**
 * Telefony PL — czyste funkcje bez zależności serwerowych (importuje je
 * i schemat Zod, i wysyłka SMS). Jedno źródło formatu zapisu: E.164.
 */

/**
 * Normalize a Polish phone number to E.164 format (+48XXXXXXXXX).
 *
 * Accepted inputs (spaces and dashes are ignored):
 * - 9 digits            -> "+48" is prepended
 * - "+48" + 9 digits    -> returned as-is
 *
 * Any other format is rejected and `null` is returned.
 */
export function normalizePolishPhoneNumber(raw: string): string | null {
  const cleaned = raw.replace(/[\s-]/g, "");

  if (/^\d{9}$/.test(cleaned)) {
    return `+48${cleaned}`;
  }
  if (/^\+48\d{9}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Numer do logów i komunikatów błędów: widać tylko 3 ostatnie cyfry
 * ("***789"). Krótsze lub puste wejście -> "***".
 */
export function maskPhoneNumber(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? `***${digits.slice(-3)}` : "***";
}
