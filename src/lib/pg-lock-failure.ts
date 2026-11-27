/**
 * Rozpoznanie błędów blokad Postgresa, po których operację można ponowić.
 * Bez zależności od bazy i schematu, żeby trasy i ich testy mogły go użyć
 * bez atrap.
 */

/** `lock_timeout` przekroczony (55P03) i zakleszczenie (40P01). */
const RETRYABLE_LOCK_CODES: ReadonlySet<string> = new Set(["55P03", "40P01"]);

/** Zakleszczenie (40P01) i konflikt serializacji (40001). */
const RETRYABLE_WRITE_CONFLICT_CODES: ReadonlySet<string> = new Set(["40P01", "40001"]);

/** Kod i komunikat 409 dla `isRetryableWriteConflict` — wspólne dla tras, które go zwracają. */
export const WRITE_CONFLICT_RETRY_CODE = "RETRY";
export const WRITE_CONFLICT_RETRY_MESSAGE = "Wystąpił konflikt zapisu. Spróbuj ponownie.";

/** Ile poziomów `cause` sprawdzamy (Drizzle opakowuje błąd sterownika raz). */
const MAX_CAUSE_DEPTH = 3;

/** Kod błędu z zestawu, na samym błędzie albo w `cause` (do MAX_CAUSE_DEPTH poziomów). */
function hasPgCode(error: unknown, codes: ReadonlySet<string>): boolean {
  for (let e: unknown = error, depth = 0; e && depth < MAX_CAUSE_DEPTH; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && codes.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Przekroczony `lock_timeout` (55P03) albo zakleszczenie (40P01), także
 * opakowane w `cause`. Transakcja się wycofała i nic nie zostało zapisane,
 * więc użytkownik może po prostu ponowić operację.
 */
export function isRetryableLockFailure(error: unknown): boolean {
  return hasPgCode(error, RETRYABLE_LOCK_CODES);
}

/**
 * Zakleszczenie (40P01) albo konflikt serializacji (40001), także opakowane
 * w `cause`: dwie transakcje blokujące te same wiersze w różnej kolejności.
 * Baza wycofała jedną z nich w całości, więc ponowienie jest bezpieczne.
 */
export function isRetryableWriteConflict(error: unknown): boolean {
  return hasPgCode(error, RETRYABLE_WRITE_CONFLICT_CODES);
}
