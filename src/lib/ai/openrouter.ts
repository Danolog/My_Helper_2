import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { eq, and, gte, sql, count, desc } from "drizzle-orm";
import { checkAIBudget, type AIOperation } from "@/lib/ai/usage-limits";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { aiRateLimit } from "@/lib/rate-limit";
import {
  aiGeneratedMedia,
  appointments,
  clients,
  employees,
  services,
  reviews,
  products,
  salons,
} from "@/lib/schema";
import { isProPlan } from "@/lib/subscription";

// ────────────────────────────────────────────────────────────
// Shared AI client factory
// ────────────────────────────────────────────────────────────

/**
 * Create an OpenRouter AI client. Throws if OPENROUTER_API_KEY is not set.
 */
export function createAIClient() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OpenRouter API key not configured");
  }
  return createOpenRouter({ apiKey });
}

/**
 * Get the AI model identifier from env or default.
 */
export function getAIModel() {
  return process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4";
}

// ────────────────────────────────────────────────────────────
// Industry labels — shared across all AI endpoints
// ────────────────────────────────────────────────────────────

export const INDUSTRY_LABELS: Record<string, string> = {
  hair_salon: "salon fryzjerski",
  beauty_salon: "salon kosmetyczny",
  medical: "gabinet medyczny / klinika",
  barber: "barber shop",
  spa: "salon SPA / wellness",
  nail_salon: "salon paznokci / manicure",
};

// ────────────────────────────────────────────────────────────
// Combined auth + Pro plan check for AI endpoints
// ────────────────────────────────────────────────────────────

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
 * Combined auth + salon + Pro plan + rate limit + AI budget check for
 * AI endpoints. Returns `{ salonId }` on success, or a Response (error)
 * on failure:
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
 * Type guard: returns true when requireProAI returned an error Response.
 */
export function isProAIError(
  result: ProAIContext | Response,
): result is Response {
  return result instanceof Response;
}

// ────────────────────────────────────────────────────────────
// Salon context gathering
// ────────────────────────────────────────────────────────────

export type SalonContext = {
  salonName: string;
  industryType: string | null;
  industryLabel: string;
};

/**
 * Fetch basic salon info (name + industry type) for AI prompts.
 */
export async function getSalonContext(salonId: string): Promise<SalonContext> {
  try {
    const salonInfo = await db
      .select({ name: salons.name, industryType: salons.industryType })
      .from(salons)
      .where(eq(salons.id, salonId))
      .then((r) => r[0]);

    const industryType = salonInfo?.industryType ?? null;
    const industryLabel =
      industryType && INDUSTRY_LABELS[industryType]
        ? INDUSTRY_LABELS[industryType]
        : "salon uslugowy";

    return {
      salonName: salonInfo?.name ?? "Salon",
      industryType,
      industryLabel,
    };
  } catch (error) {
    logger.error("[AI] Error fetching salon context", { error });
    return {
      salonName: "Salon",
      industryType: null,
      industryLabel: "salon uslugowy",
    };
  }
}

/**
 * Gather comprehensive salon business data for AI context (30-day window).
 * Used by the business chat assistant.
 */
export async function gatherSalonData(salonId: string): Promise<{
  data: string;
  industryType: string | null;
  salonName: string;
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const salonInfo = await db
      .select({
        name: salons.name,
        industryType: salons.industryType,
      })
      .from(salons)
      .where(eq(salons.id, salonId))
      .then((r) => r[0] ?? { name: "Salon", industryType: null });

    const [
      totalClients,
      totalEmployees,
      activeServices,
      recentAppointmentsCount,
      appointmentsByStatus,
      topServicesList,
      topEmployeesList,
      avgRatingResult,
      lowStockItems,
      revenueResult,
    ] = await Promise.all([
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, salonId))
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(employees)
        .where(
          and(eq(employees.salonId, salonId), eq(employees.isActive, true)),
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(services)
        .where(
          and(eq(services.salonId, salonId), eq(services.isActive, true)),
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({
          status: appointments.status,
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
        )
        .groupBy(appointments.status),

      db
        .select({
          serviceName: services.name,
          servicePrice: services.basePrice,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
        )
        .groupBy(services.name, services.basePrice)
        .orderBy(desc(count()))
        .limit(5),

      db
        .select({
          firstName: employees.firstName,
          lastName: employees.lastName,
          count: count(),
        })
        .from(appointments)
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
        )
        .groupBy(employees.firstName, employees.lastName)
        .orderBy(desc(count()))
        .limit(5),

      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, salonId),
            sql`${reviews.rating} IS NOT NULL`,
          ),
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0").toFixed(1),
          total: r[0]?.count ?? 0,
        })),

      db
        .select({
          name: products.name,
          quantity: products.quantity,
          minQuantity: products.minQuantity,
          unit: products.unit,
        })
        .from(products)
        .where(
          and(
            eq(products.salonId, salonId),
            sql`CAST(${products.quantity} AS numeric) <= COALESCE(CAST(${products.minQuantity} AS numeric), 5)`,
          ),
        )
        .limit(10),

      db
        .select({
          total:
            sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),
    ]);

    const statusMap: Record<string, number> = {};
    for (const s of appointmentsByStatus) {
      statusMap[s.status] = s.count;
    }
    const cancelledCount =
      (statusMap["cancelled"] ?? 0) + (statusMap["no_show"] ?? 0);
    const cancellationRate =
      recentAppointmentsCount > 0
        ? ((cancelledCount / recentAppointmentsCount) * 100).toFixed(1)
        : "0";

    const topServicesStr = topServicesList
      .map(
        (s, i) =>
          `  ${i + 1}. ${s.serviceName} - ${s.count} wizyt (${s.servicePrice} PLN)`,
      )
      .join("\n");

    const topEmployeesStr = topEmployeesList
      .map(
        (e, i) =>
          `  ${i + 1}. ${e.firstName} ${e.lastName} - ${e.count} wizyt`,
      )
      .join("\n");

    const lowStockStr =
      lowStockItems.length > 0
        ? lowStockItems
            .map(
              (p) =>
                `  - ${p.name}: ${p.quantity} ${p.unit || "szt."} (min: ${p.minQuantity || "5"})`,
            )
            .join("\n")
        : "  Brak produktow z niskim stanem magazynowym.";

    const statusBreakdown = Object.entries(statusMap)
      .map(([status, cnt]) => `  - ${status}: ${cnt}`)
      .join("\n");

    const dataStr = `
DANE SALONU "${salonInfo.name}" (aktualizacja: ${now.toLocaleDateString("pl-PL")}):
Typ dzialalnosci: ${salonInfo.industryType ? (INDUSTRY_LABELS[salonInfo.industryType] ?? salonInfo.industryType) : "Nie okreslono"}

PODSUMOWANIE:
- Liczba klientow: ${totalClients}
- Aktywni pracownicy: ${totalEmployees}
- Aktywne uslugi: ${activeServices}

WIZYTY (ostatnie 30 dni):
- Laczna liczba wizyt: ${recentAppointmentsCount}
- Przychod z ukonczonych wizyt: ${revenueResult.toFixed(2)} PLN
- Wskaznik anulacji: ${cancellationRate}%
- Status wizyt:
${statusBreakdown}

NAJPOPULARNIEJSZE USLUGI (ostatnie 30 dni):
${topServicesStr || "  Brak danych"}

NAJBARDZIEJ AKTYWNI PRACOWNICY (ostatnie 30 dni):
${topEmployeesStr || "  Brak danych"}

OPINIE KLIENTOW:
- Srednia ocena: ${avgRatingResult.average}/5.0 (${avgRatingResult.total} opinii)

MAGAZYN - NISKI STAN:
${lowStockStr}
`.trim();

    return {
      data: dataStr,
      industryType: salonInfo.industryType,
      salonName: salonInfo.name,
    };
  } catch (error) {
    logger.error("[AI Business] Error gathering salon data", { error });
    return {
      data: "Nie udalo sie pobrac danych salonu. Prosze sprobowac ponownie.",
      industryType: null,
      salonName: "Salon",
    };
  }
}

// ────────────────────────────────────────────────────────────
// JSON parse helper for AI endpoints
// ────────────────────────────────────────────────────────────

/**
 * Safely parse JSON from a Request. Returns the parsed body or an error Response.
 */
export async function parseJSON(
  req: Request,
): Promise<unknown | Response> {
  try {
    return await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

/**
 * Type guard for parseJSON error response.
 */
export function isParseError(result: unknown): result is Response {
  return result instanceof Response;
}

// ────────────────────────────────────────────────────────────
// AI usage tracking
// ────────────────────────────────────────────────────────────

/**
 * Typy i dostawcy, pod którymi wolno ZAPISAĆ nowe użycie AI. Celowo bez
 * `"video"` / `"google_veo"`: wideo usunięte w B4, a wiersze historyczne tylko
 * się odczytuje (`COST_MAP` w usage-limits.ts zostaje kluczem `string`).
 * Zawężenie typu łapie też wartości sklejane ze stringów i ze stałych
 * (recenzja Ryana #114, V1/V2) — tego nie zobaczy skaner tekstu G6.
 */
export type TrackedAIUsageType = "text" | "image" | "banner";
export type TrackedAIUsageProvider = "openrouter" | "google_imagen" | "sharp";

/**
 * Track an AI text generation call for cost monitoring.
 * Non-blocking — errors are logged but never propagated to the caller.
 *
 * @param salonId  - Salon that initiated the AI call
 * @param feature  - Feature identifier for grouping (e.g. "auto_summary", "search")
 * @param metadata - Optional extra context stored in the JSONB metadata column
 */
export async function trackAIUsage(
  salonId: string,
  feature: string,
  metadata?: Record<string, unknown>,
  options?: { type?: TrackedAIUsageType; provider?: TrackedAIUsageProvider },
): Promise<void> {
  try {
    await db.insert(aiGeneratedMedia).values({
      salonId,
      type: options?.type ?? "text",
      provider: options?.provider ?? "openrouter",
      prompt: feature,
      status: "completed",
      metadata: { feature, ...metadata },
    });
  } catch (error) {
    logger.warn("[AI] Failed to track usage", { error, feature });
  }
}
