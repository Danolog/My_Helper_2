/**
 * Konfiguracja logowania przez Google — jedno źródło prawdy dla serwera.
 *
 * Zmienne czytane są przy każdym wywołaniu z `process.env` (bez `NEXT_PUBLIC_*`),
 * bo na Cloud Run ustawia się je w runtime, a nie w czasie budowania. Moduł nie
 * może trafić do kodu klienta: tam `GOOGLE_CLIENT_SECRET` jest zawsze pusty.
 * Klient dostaje wyłącznie wynik `isGoogleAuthConfigured()` jako props.
 */

type GoogleAuthEnv = Readonly<Record<string, string | undefined>>

export interface GoogleAuthCredentials {
  clientId: string
  clientSecret: string
}

/**
 * Dane dostawcy Google albo `null`, gdy którakolwiek zmienna jest pusta lub
 * składa się z samych białych znaków. Zwracane wartości są przycięte.
 */
export function getGoogleAuthCredentials(env: GoogleAuthEnv = process.env): GoogleAuthCredentials | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? ""
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? ""
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

/** Czy logowanie przez Google jest skonfigurowane (obie zmienne niepuste). */
export function isGoogleAuthConfigured(env: GoogleAuthEnv = process.env): boolean {
  return getGoogleAuthCredentials(env) !== null
}
