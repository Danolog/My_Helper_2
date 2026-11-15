/**
 * Bramka tras AI — jedno miejsce decyzji o dostępie, niezależne od dostawcy
 * modelu (nie importuje żadnego SDK AI).
 *
 * - `requireProPlan()` — sesja + salon + plan Pro. Dla tras, które czytają
 *   tylko bazę (analityka, rekomendacje regułowe) i nie wołają modelu.
 * - `requireProAI()` — `requireProPlan()` + limit zapytań na salon + budżet
 *   AI. Dla każdej trasy, która woła model.
 *
 * Strażnik: `__tests__/api/ai-gate-guard.test.ts`.
 */
import { checkAIBudget, type AIOperation } from "@/lib/ai/usage-limits";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { aiRateLimit } from "@/lib/rate-limit";
import { isProPlan } from "@/lib/subscription";

export type ProAIContext = {
  salonId: string;
};

export type ProAIOptions = {
  /**
   * Operation about to be performed. "image" / "banner" additionally
   * enforce the per-unit monthly cap (AI_MONTHLY_IMAGE_LIMIT).
   * Omit for plain text AI calls.
   */
  op?: AIOperation;
};

/**
 * Auth + salon + Pro plan. Returns `{ salonId }` on success, or a Response:
 * - 401/404 — auth / salon missing
 * - 403 `PLAN_UPGRADE_REQUIRED` — not on Pro plan
 */
export async function requireProPlan(): Promise<ProAIContext | Response> {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return Response.json(
      {
        error: "Funkcje AI sa dostepne tylko w Planie Pro.",
        code: "PLAN_UPGRADE_REQUIRED",
      },
      { status: 403 },
    );
  }

  return { salonId };
}

/**
 * `requireProPlan()` + rate limit + AI budget, for every route that calls
 * a model. Returns `{ salonId }` on success, or a Response (error):
 * - 401/404 — auth / salon missing
 * - 403 `PLAN_UPGRADE_REQUIRED` — not on Pro plan
 * - 429 `RATE_LIMITED` (with Retry-After) — too many AI requests per minute
 * - 429 `AI_BUDGET_EXCEEDED` — monthly budget or unit limit exhausted
 *
 * Backwards compatible: existing zero-argument call sites keep working.
 */
export async function requireProAI(
  options: ProAIOptions = {},
): Promise<ProAIContext | Response> {
  const plan = await requireProPlan();
  if (isProAIError(plan)) return plan;
  const { salonId } = plan;

  // Rate limit per salon (distributed via Upstash when configured)
  const rate = await aiRateLimit.checkAsync(`salon:${salonId}`);
  if (!rate.success) {
    const retryAfterSec = Math.max(1, Math.ceil(rate.reset / 1000));
    return Response.json(
      {
        error:
          "Zbyt wiele zapytan AI. Prosze odczekac chwile i sprobowac ponownie.",
        code: "RATE_LIMITED",
        retryAfter: retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSec) },
      },
    );
  }

  // Hard monthly budget + per-type unit limits
  const budgetCheck = await checkAIBudget(salonId, options.op);
  if (!budgetCheck.allowed) {
    return Response.json(
      {
        error:
          budgetCheck.reason ??
          "Miesieczny budzet AI zostal wyczerpany. Limit odnowi sie na poczatku nastepnego miesiaca.",
        code: "AI_BUDGET_EXCEEDED",
        usage: budgetCheck.usage,
        budget: budgetCheck.budget,
      },
      { status: 429 },
    );
  }

  return { salonId };
}

/**
 * Type guard: returns true when a gate returned an error Response.
 */
export function isProAIError(
  result: ProAIContext | Response,
): result is Response {
  return result instanceof Response;
}
