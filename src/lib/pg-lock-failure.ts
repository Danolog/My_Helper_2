/**
 * Rozpoznanie błędów blokad Postgresa, po których operację można ponowić.
 * Bez zależności od bazy i schematu, żeby trasy i ich testy mogły go użyć
 * bez atrap.
 */

/** `lock_timeout` przekroczony (55P03) i zakleszczenie (40P01). */
const RETRYABLE_LOCK_CODES: ReadonlySet<string> = new Set(["55P03", "40P01"]);

/** Ile poziomów `cause` sprawdzamy (Drizzle opakowuje błąd sterownika raz). */
const MAX_CAUSE_DEPTH = 3;

/**
 * Przekroczony `lock_timeout` (55P03) albo zakleszczenie (40P01), także
 * opakowane w `cause`. Transakcja się wycofała i nic nie zostało zapisane,
 * więc użytkownik może po prostu ponowić operację.
 */
export function isRetryableLockFailure(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < MAX_CAUSE_DEPTH; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_LOCK_CODES.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
