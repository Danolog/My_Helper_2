/**
 * Klucze liczników limitu prób logowania.
 *
 * W tabeli licznika nie ma adresu IP ani adresu e-mail jawnym tekstem: klucz to
 * HMAC-SHA256 z kluczem wyprowadzonym HKDF z sekretu auth. Osobne etykiety dla
 * licznika adresu i licznika konta — ta sama wartość wejściowa nigdy nie daje
 * tego samego klucza w obu licznikach. Zmiana sekretu zeruje liczniki.
 *
 * Czyste funkcje, synchroniczne, bez bazy i bez env (poza `system/`, bo tam
 * wolno eksportować wyłącznie funkcje async zwracające dane).
 */
import { createHmac, hkdfSync } from "node:crypto";

const IP_LABEL = "myhelper/auth-throttle/ip/v1";
const ACCOUNT_LABEL = "myhelper/auth-throttle/account/v1";

const derivedKeys = new Map<string, Buffer>();

function deriveKey(secret: string, label: string): Buffer {
  const cacheKey = `${label}\u0000${secret}`;
  let key = derivedKeys.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "", label, 32));
    derivedKeys.set(cacheKey, key);
  }
  return key;
}

/** Obcięcie białych znaków i małe litery — nic więcej (kropki i plusy zostają). */
export function normalizeSignInEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Klucz licznika adresu z klucza biblioteki (`<ip>|<ścieżka>`). */
export function ipThrottleKey(libraryKey: string, secret: string): Buffer {
  return createHmac("sha256", deriveKey(secret, IP_LABEL)).update(libraryKey).digest();
}

/** Klucz licznika konta; normalizuje adres sam. */
export function accountThrottleKey(email: string, secret: string): Buffer {
  return createHmac("sha256", deriveKey(secret, ACCOUNT_LABEL)).update(normalizeSignInEmail(email)).digest();
}
