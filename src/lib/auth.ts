import { betterAuth } from "better-auth"
// Adapter na puli systemowej, tylko 4 tabele auth (#193). Jedyny importer adaptera.
import { authAdapter } from "./server/system/auth-adapter"
import { logger } from "./logger"
import { betterAuthLoggerOptions } from "./auth-log"
import { isEmailConfigured, sendPasswordResetEmail, sendVerificationEmail } from "./email"
import { getAuthIpAddressOptions } from "./trusted-proxies"
import { getAuthRateLimitStore } from "./auth-rate-limit-mode"
import { buildAuthRateLimitOptions } from "./auth-rate-limit-options"
import { getGoogleAuthCredentials } from "./google-auth"

/**
 * Kontekst logu dla zdarzeń „wysłano link resetu hasła / weryfikacji e-mail".
 *
 * Link jest jednorazowym poświadczeniem — kto go ma, przejmuje konto. Na produkcji
 * do logów trafia więc wyłącznie identyfikator użytkownika: bez adresu URL, bez
 * tokenu i bez adresu e-mail. Poza produkcją link zostaje w logu, żeby dało się
 * pracować lokalnie bez dostawcy poczty (RESEND_API_KEY).
 */
function authLinkLogContext(
  user: { id: string; email: string },
  urlKey: "resetUrl" | "verificationUrl",
  url: string
): Record<string, string> {
  if (process.env.NODE_ENV === "production") {
    return { userId: user.id }
  }
  return { userId: user.id, email: user.email, [urlKey]: url }
}

/**
 * Źródło adresu IP dla limitu żądań Better Auth — te same nagłówki i te same
 * zaufane proxy (env TRUSTED_PROXIES) co getClientIp w src/lib/rate-limit.ts
 * (patrz src/lib/trusted-proxies.ts, getAuthIpAddressOptions):
 *
 * - `trustedProxies` tylko przy niepustej liście. Pusta → Better Auth przyjmuje
 *   tylko jednowartościowy nagłówek. Za LB (GCP) łańcuch `<klient>, <LB>` bez
 *   listy daje null, czyli JEDEN wspólny kubełek (3 próby logowania / 10 s).
 * - `ipAddressHeaders: ["x-real-ip", "x-forwarded-for"]` tylko na Vercelu
 *   (VERCEL=1): `x-real-ip` ustawia Vercel Proxy. Poza Vercelem domyślnie
 *   tylko X-Forwarded-For.
 *
 * `advanced.trustedProxyHeaders` zostaje celowo WYŁĄCZONE (przegląd CRCO
 * #17, b2): nie mamy dowodu, że LB nadpisuje X-Forwarded-Host od klienta.
 */
const ipAddressOptions = getAuthIpAddressOptions()

/**
 * Magazyn limitu prób logowania (AUTH_RATE_LIMIT_STORE): brak zmiennej →
 * konfiguracja biblioteki bez zmian; `database` → liczniki w bazie i limit na
 * konto (src/lib/auth-rate-limit-options.ts). Zła wartość albo `database` bez
 * BETTER_AUTH_SECRET → błąd przy ładowaniu tego modułu; start serwera zatrzymuje
 * wcześniej `enforceAuthRateLimitStore` w `register()` (src/instrumentation.ts).
 */
const rateLimitOptions = buildAuthRateLimitOptions(getAuthRateLimitStore(process.env))

/**
 * Dane dostawcy Google czytane przy ładowaniu modułu, czyli przy starcie
 * procesu — na Cloud Run zmienne środowiskowe są już wtedy ustawione.
 */
const googleCredentials = getGoogleAuthCredentials()

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  database: authAdapter,
  // Wpisy biblioteki przez nasz logger: pole severity, redakcja, anonimowe
  // błędy żądań jako warn (src/lib/auth-log.ts).
  logger: betterAuthLoggerOptions,
  trustedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.BETTER_AUTH_URL && !process.env.BETTER_AUTH_URL.includes("localhost")
      ? [process.env.BETTER_AUTH_URL]
      : []),
  ],
  advanced: {
    ipAddress: ipAddressOptions,
  },
  ...("rateLimit" in rateLimitOptions ? { rateLimit: rateLimitOptions.rateLimit } : {}),
  ...("hooks" in rateLimitOptions ? { hooks: rateLimitOptions.hooks } : {}),
  session: {
    /**
     * Session expires after 15 minutes of inactivity.
     * Per spec: "15 minut bezczynnosci" (15 minutes of inactivity).
     * updateAge: 0 means every request refreshes the session expiration,
     * so the 15-minute window resets on each authenticated request.
     */
    expiresIn: 15 * 60, // 15 minutes in seconds
    updateAge: 0, // Refresh session expiration on every request
  },
  // Google rejestrowany tylko przy komplecie danych. Bez nich dostawca nie
  // istnieje, a formularze logowania nie pokazują przycisku (isGoogleAuthConfigured).
  socialProviders: googleCredentials ? { google: googleCredentials } : {},
  user: {
    additionalFields: {
      phone: {
        type: "string",
        required: false,
      },
      role: {
        type: "string",
        required: false,
        defaultValue: "client",
        input: false, // Don't allow users to set their own role during signup
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8, // Minimum 8 characters per spec
    // Spec wymaga weryfikacji email po rejestracji. Wymóg jest aktywny tylko
    // gdy skonfigurowany jest provider email (RESEND_API_KEY) — inaczej
    // (dev/CI bez klucza) użytkownik nigdy nie dostałby linku i nie mógłby się zalogować.
    requireEmailVerification: isEmailConfigured(),
    sendResetPassword: async ({ user, url }) => {
      logger.info("Password reset requested", authLinkLogContext(user, "resetUrl", url))
      await sendPasswordResetEmail({ to: user.email, url })
    },
    ...("onPasswordReset" in rateLimitOptions ? { onPasswordReset: rateLimitOptions.onPasswordReset } : {}),
  },
  emailVerification: {
    sendOnSignUp: true,
    // Przy requireEmailVerification: niezweryfikowany sign-in ponawia wysyłkę linku
    sendVerificationEmail: async ({ user, url }) => {
      logger.info("Email verification sent", authLinkLogContext(user, "verificationUrl", url))
      await sendVerificationEmail({ to: user.email, url })
    },
  },
})