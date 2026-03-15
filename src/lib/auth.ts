import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "./db"
import { logger } from "./logger"

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
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      // Log password reset URL (no email integration yet)
      logger.info("Password reset requested", { email: user.email, resetUrl: url })
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Log verification URL (no email integration yet)
      logger.info("Email verification sent", { email: user.email, verificationUrl: url })
    },
  },
})