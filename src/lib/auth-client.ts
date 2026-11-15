import { inferAdditionalFields } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"
import type { auth } from "./auth"
import { createSessionRateLimitRetryFetch } from "./session-rate-limit-retry"

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  // 429 na GET /get-session: czekaj X-Retry-After i ponów zamiast pokazywać
  // „brak sesji" (przekierowanie na /login, pusty panel). Patrz moduł.
  fetchOptions: {
    customFetchImpl: createSessionRateLimitRetryFetch(),
  },
  plugins: [
    inferAdditionalFields<typeof auth>(),
  ],
})

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
} = authClient