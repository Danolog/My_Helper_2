/**
 * Fragment opcji Better Auth dla limitu prób logowania — wspólny dla
 * `src/lib/auth.ts` i harnessu testu dwóch procesów.
 *
 * - `memory`: pusty fragment. Konfiguracja biblioteki bez zmian (magazyn
 *   w pamięci procesu, `rateLimit.enabled` domyślne = tylko produkcja).
 * - `database`:
 *   - `rateLimit.enabled: true` niezależnie od NODE_ENV — start poza produkcją
 *     (np. inny hosting) nie może po cichu wyłączyć limitu przy włączonym
 *     przełączniku. Flaga jest ustawiana WYŁĄCZNIE tutaj;
 *   - `rateLimit.customStorage` = licznik adresu w bazie (wyjście systemowe);
 *   - hooki limitu na konto dla `/sign-in/email` (działają niezależnie od flagi):
 *     `before` rezerwuje próbę przed sprawdzeniem hasła, `after` zeruje licznik
 *     po sukcesie 2xx i po odmowie „e-mail niezweryfikowany" (hasło było poprawne).
 *     Każda inna odpowiedź (401, 400) zostaje w liczniku — nigdy nie zerować
 *     po 400, bo źle sformatowane żądanie kasowałoby własne porażki;
 *   - `onPasswordReset` zeruje licznik konta po udanym resecie hasła.
 *   Brak `BETTER_AUTH_SECRET` → błąd przy starcie (klucze liczników to HMAC z sekretu).
 *
 * Odmowa per konto ma odpowiedź identyczną z odpowiedzią limitu biblioteki
 * (429, ta sama treść i nagłówki) — nie zdradza, czy konto istnieje.
 */
import { createAuthMiddleware } from "better-auth/api";
import type { AuthRateLimitStore } from "./auth-rate-limit-mode";
import { normalizeSignInEmail } from "./auth-throttle-keys";
import {
  clearSignInFailures,
  consumeAuthRateLimit,
  reserveAccountSignInAttempt,
} from "./server/system/auth-throttle";

const SIGN_IN_EMAIL_PATH = "/sign-in/email";

/** Odpowiedź bajt w bajt jak `rateLimitResponse` Better Auth 1.7.x. */
function rateLimitResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ message: "Too many requests. Please try again later." }), {
    status: 429,
    statusText: "Too Many Requests",
    headers: {
      "Content-Type": "application/json",
      "X-Retry-After": retryAfter.toString(),
    },
  });
}

/** E-mail z ciała żądania; brak, nie-napis albo pusty po normalizacji → null. */
function signInEmailOf(body: unknown): string | null {
  const email = (body as { email?: unknown } | null | undefined)?.email;
  if (typeof email !== "string") return null;
  return normalizeSignInEmail(email) === "" ? null : email;
}

/** Czy wynik logowania zeruje licznik konta: sukces albo 403 EMAIL_NOT_VERIFIED. */
export function resetsAccountCounter(returned: unknown): boolean {
  if (returned instanceof Response) return returned.status >= 200 && returned.status < 300;
  if (returned && typeof returned === "object" && "statusCode" in returned) {
    const err = returned as { statusCode?: unknown; body?: { code?: unknown } };
    return err.statusCode === 403 && err.body?.code === "EMAIL_NOT_VERIFIED";
  }
  return returned !== undefined;
}

type DatabaseRateLimitOptions = ReturnType<typeof buildDatabaseOptions>;

export function buildAuthRateLimitOptions(mode: "memory"): Record<string, never>;
export function buildAuthRateLimitOptions(mode: "database"): DatabaseRateLimitOptions;
export function buildAuthRateLimitOptions(
  mode: AuthRateLimitStore,
): Record<string, never> | DatabaseRateLimitOptions;
export function buildAuthRateLimitOptions(
  mode: AuthRateLimitStore,
): Record<string, never> | DatabaseRateLimitOptions {
  if (mode === "memory") return {};
  if (!process.env.BETTER_AUTH_SECRET) {
    throw new Error("AUTH_RATE_LIMIT_STORE=database wymaga BETTER_AUTH_SECRET");
  }
  return buildDatabaseOptions();
}

function buildDatabaseOptions() {
  return {
    rateLimit: {
      enabled: true,
      customStorage: { consume: consumeAuthRateLimit },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx): Promise<Response | undefined> => {
        if (ctx.path !== SIGN_IN_EMAIL_PATH) return undefined;
        const email = signInEmailOf(ctx.body);
        if (email === null) return undefined;
        const { allowed, retryAfter } = await reserveAccountSignInAttempt(email);
        return allowed ? undefined : rateLimitResponse(retryAfter ?? 1);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== SIGN_IN_EMAIL_PATH) return;
        const email = signInEmailOf(ctx.body);
        if (email === null) return;
        if (resetsAccountCounter(ctx.context.returned)) await clearSignInFailures(email);
      }),
    },
    onPasswordReset: async ({ user }: { user: { email: string } }) => {
      await clearSignInFailures(user.email);
    },
  };
}
