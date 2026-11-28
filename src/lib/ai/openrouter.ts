import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { aiGeneratedMedia, salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

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
// Bramka planu i AI — niezależna od dostawcy, w @/lib/ai/gate.
// Re-eksport zachowuje dotychczasowe importy z tego modułu.
// ────────────────────────────────────────────────────────────

export {
  isProAIError,
  requireProAI,
  requireProPlan,
  type ProAIContext,
  type ProAIOptions,
} from "@/lib/ai/gate";

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
 * Odczyt przez `forSalon` (kontekst RLS salonu); `forSalon` rzuca synchronicznie
 * przy pustym salonId, dlatego wywołanie jest w `try` — wtedy wartości domyślne.
 */
export async function getSalonContext(salonId: string): Promise<SalonContext> {
  try {
    const salonInfo = await forSalon(salonId).raw((tx) =>
      tx
        .select({ name: salons.name, industryType: salons.industryType })
        .from(salons)
        .where(eq(salons.id, salonId))
        .then((r) => r[0]),
    );

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
 * Zawężenie typu łapie wartości sklejane ze stringów i ze stałych
 * (recenzja z audytu bezpieczeństwa #114, V1/V2) — tego nie zobaczy skaner tekstu G6.
 * Rzutowania (`as any`, `as never`, `// @ts-ignore`) i pliki JS omijają typ,
 * dlatego `trackAIUsage` sprawdza te same listy także w czasie wykonania
 * (recenzja z audytu bezpieczeństwa #117, T1–T3, J2).
 */
export const TRACKED_AI_USAGE_TYPES = ["text", "image", "banner"] as const;
export const TRACKED_AI_USAGE_PROVIDERS = [
  "openrouter",
  "google_imagen",
  "sharp",
] as const;
export type TrackedAIUsageType = (typeof TRACKED_AI_USAGE_TYPES)[number];
export type TrackedAIUsageProvider = (typeof TRACKED_AI_USAGE_PROVIDERS)[number];

/**
 * Track an AI text generation call for cost monitoring.
 * Non-blocking — database errors are logged but never propagated to the caller.
 * A `type`/`provider` outside the allowlists above is a programming error:
 * nothing is written, one `logger.error` is emitted and the promise still
 * resolves. Callers use `void trackAIUsage(...)`, so a rejection would be
 * unhandled — Node ends the process on those by default, and we do not rely
 * on the Next.js handler to catch it (decyzja produktowa, #117).
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
  const type: unknown = options?.type ?? "text";
  const provider: unknown = options?.provider ?? "openrouter";
  if (
    !(TRACKED_AI_USAGE_TYPES as readonly unknown[]).includes(type) ||
    !(TRACKED_AI_USAGE_PROVIDERS as readonly unknown[]).includes(provider)
  ) {
    // Tylko odrzucone wartości i salon — bez feature/metadata (treść żądania).
    logger.error("[AI] Rejected usage record outside the allowlist", {
      salonId,
      type: String(type).slice(0, 64),
      provider: String(provider).slice(0, 64),
    });
    return;
  }
  // `forSalon` w `try`: pusty salonId rzuca synchronicznie, a ta funkcja nigdy
  // nie rzuca (wołający używają `void trackAIUsage(...)`).
  try {
    await forSalon(salonId).raw((tx) =>
      tx.insert(aiGeneratedMedia).values({
        salonId,
        type: type as TrackedAIUsageType,
        provider: provider as TrackedAIUsageProvider,
        prompt: feature,
        status: "completed",
        metadata: { feature, ...metadata },
      }),
    );
  } catch (error) {
    logger.warn("[AI] Failed to track usage", { error, feature });
  }
}
