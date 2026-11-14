import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "./db"
import { logger } from "./logger"
import { isEmailConfigured, sendPasswordResetEmail, sendVerificationEmail } from "./email"

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

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  trustedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    ...(process.env.BETTER_AUTH_URL && !process.env.BETTER_AUTH_URL.includes("localhost")
      ? [process.env.BETTER_AUTH_URL]
      : []),
  ],
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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },
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