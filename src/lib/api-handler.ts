import { NextResponse } from "next/server";
import { validateBody } from "@/lib/api-validation";
import {
  requireAuth,
  isAuthError,
  requireCronSecret,
  type AuthResult,
} from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { getClientIp, type createRateLimit } from "@/lib/rate-limit";
import type { z } from "zod";

/**
 * withApiHandler — wspólny preambuł tras API (Faza 3 planu wydania).
 *
 * Zdejmuje z trasy powtarzany ~15-liniowy wstęp:
 *   rate limit → auth → parse+walidacja body → try/catch z logger i 500.
 * Kolejność kroków jest identyczna z dotychczasową konwencją tras, więc
 * migracja trasy nie zmienia statusów ani kształtów odpowiedzi.
 *
 * Trasa deklaruje politykę, a handler dostaje gotowy kontekst:
 *
 *   export const POST = withApiHandler(
 *     {
 *       auth: "user",
 *       rateLimit: apiRateLimit,
 *       schema: createServiceSchema,
 *       logLabel: "[Services API] POST",
 *       errorMessage: "Failed to create service",
 *     },
 *     async ({ body, auth }) => {
 *       ...
 *       return NextResponse.json({ success: true, data });
 *     }
 *   );
 *
 * Zakres świadomie minimalny: izolacja salonu pozostaje w trasie
 * (forSalon/getUserSalonId — patrz ADR-001), bo źródło salonId różni się
 * między trasami (sesja, params, ownership-check na wierszu).
 */

type RateLimiter = ReturnType<typeof createRateLimit>;

export interface ApiContext<TBody> {
  request: Request;
  /** Zwalidowane body (tylko gdy w opcjach podano `schema`). */
  body: TBody;
  /** Sesja zalogowanego użytkownika (tylko gdy auth: "user"). */
  auth: AuthResult | null;
  /** Rozwiązane parametry trasy dynamicznej (Next 16 podaje Promise). */
  params: Record<string, string>;
}

export interface ApiHandlerOptions<TBody> {
  /**
   * - "user": requireAuth() — 401 bez sesji (domyślne; jawnie deklaruj
   *   "none" dla tras publicznych, żeby brak auth był widoczną decyzją)
   * - "cron": requireCronSecret(request) — Bearer CRON_SECRET, fail-closed
   * - "none": trasa publiczna
   */
  auth: "user" | "cron" | "none";
  /** Limiter z @/lib/rate-limit (apiRateLimit/strictRateLimit/...), klucz = IP. */
  rateLimit?: RateLimiter;
  /** Schemat zod dla body żądania — błąd => 400 { error, details }. */
  schema?: z.ZodType<TBody>;
  /** Prefiks logów błędów, np. "[Services API] POST". */
  logLabel?: string;
  /** Treść pola error odpowiedzi 500 (domyślnie "Internal server error"). */
  errorMessage?: string;
}

type RouteContext = { params: Promise<Record<string, string>> };

export function withApiHandler<TBody = never>(
  options: ApiHandlerOptions<TBody>,
  handler: (ctx: ApiContext<TBody>) => Promise<NextResponse> | NextResponse
): (request: Request, routeCtx?: RouteContext) => Promise<NextResponse> {
  return async (request: Request, routeCtx?: RouteContext) => {
    try {
      // 1. Rate limit (jak dotąd: klucz = IP klienta)
      if (options.rateLimit) {
        const rateLimitResult = options.rateLimit.check(getClientIp(request));
        if (!rateLimitResult.success) {
          return NextResponse.json(
            { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
            {
              status: 429,
              headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) },
            }
          );
        }
      }

      // 2. Autoryzacja
      let auth: AuthResult | null = null;
      if (options.auth === "user") {
        const authResult = await requireAuth();
        if (isAuthError(authResult)) return authResult;
        auth = authResult;
      } else if (options.auth === "cron") {
        const cronError = await requireCronSecret(request);
        if (cronError) return cronError;
      }

      // 3. Body + walidacja (tylko gdy trasa deklaruje schemat)
      let body = undefined as TBody;
      if (options.schema) {
        const rawBody: unknown = await request.json();
        const validationError = validateBody(options.schema, rawBody);
        if (validationError) {
          return NextResponse.json(validationError, { status: 400 });
        }
        body = rawBody as TBody;
      }

      // 4. Parametry trasy dynamicznej
      const params = routeCtx?.params ? await routeCtx.params : {};

      return await handler({ request, body, auth, params });
    } catch (error) {
      logger.error(`${options.logLabel ?? "[API]"} unhandled error`, { error });
      return NextResponse.json(
        { success: false, error: options.errorMessage ?? "Internal server error" },
        { status: 500 }
      );
    }
  };
}
