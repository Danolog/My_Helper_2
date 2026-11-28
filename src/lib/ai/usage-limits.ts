/**
 * Hard AI cost limits per salon (monthly budget + per-type unit limits).
 *
 * Cost accounting mirrors GET /api/ai/usage: every tracked AI call is a row
 * in `aiGeneratedMedia`, and the estimated cost is `count * COST_MAP[type:provider]`.
 * The budget window is the current calendar month (from the 1st, 00:00 local).
 *
 * Limits are configured via env vars (with safe defaults):
 * - AI_MONTHLY_BUDGET_USD   — total monthly budget in USD (default 20)
 * - AI_MONTHLY_IMAGE_LIMIT  — hard cap on generated images+banners/month (default 100)
 */

import { eq, and, gte, count } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { aiGeneratedMedia } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

// ────────────────────────────────────────────────────────────
// Cost-per-use map keyed by "type:provider"
// (single source of truth — also used by GET /api/ai/usage)
// ────────────────────────────────────────────────────────────

export const COST_MAP: Record<string, number> = {
  // Media generation costs
  "image:google_imagen": 0.01, // Social graphics (Imagen)
  "image:sharp": 0, // Photo enhancement — server-side, no API cost
  "banner:google_imagen": 0.01, // Banner generation
  "banner:sharp": 0, // Server-side banner compositing
  // Tylko dane historyczne: wideo (Veo) usunięte w B4, nowych wywołań nie ma
  // (strażnik G6, removed-features.test.ts). Wpis zostaje dla wierszy historycznych
  // (`ai_generated_media.type = 'video'`): bez niego budżet bieżącego miesiąca
  // i raport GET /api/ai/usage liczyłyby je po DEFAULT_COST_PER_USE.
  "video:google_veo": 0.15,
  // Text AI: Gemini 3.8 Flash na Vertex AI (`eu`). Szacunek celowo zawyżony:
  // cennik Vertex AI (cloud.google.com/vertex-ai/generative-ai/pricing, odczyt
  // 2026-11-28), stawka od 2027-01-01 (wyższa od obecnej promocyjnej):
  // 1,50 USD / 1M tokenów wejścia, 7,50 USD / 1M tokenów wyjścia (myślenie liczy
  // się jako wyjście). Wejście: ~8000 tokenów (prompt systemowy z danymi
  // `gatherSalonData` i kilka wiadomości rozmowy) × 1,50e-6 = 0,012 USD.
  // Wyjście: pełne `maxOutputTokens` czatu, 2000 × 7,50e-6 = 0,015 USD.
  // Razem 0,027 USD, w górę do 0,03. Do korekty po testach na żywo, przed
  // otwarciem AI dla salonów.
  "text:vertex": 0.03,
  // Tylko dane historyczne: wiersze z czasów OpenRoutera (Claude Sonnet).
  "text:openrouter": 0.002,
};

/** Fallback cost when the type:provider combination is not in the map. */
export const DEFAULT_COST_PER_USE = 0.002;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Operation type for per-type unit limits. */
export type AIOperation = "text" | "image" | "banner";

export type AIBudgetUsage = {
  /** Estimated total cost in USD for the current calendar month */
  totalCostUSD: number;
  /** Number of generated images + banners this month (API-cost-bearing only) */
  imageCount: number;
};

export type AIBudgetLimits = {
  monthlyBudgetUSD: number;
  monthlyImageLimit: number;
};

export type AIBudgetCheck = {
  allowed: boolean;
  /** Human-readable (PL) reason when not allowed */
  reason?: string;
  usage: AIBudgetUsage;
  budget: AIBudgetLimits;
};

// ────────────────────────────────────────────────────────────
// Env-configured limits (read at call time so tests can override)
// ────────────────────────────────────────────────────────────

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Current AI budget limits (env-configurable with defaults). */
export function getAIBudgetLimits(): AIBudgetLimits {
  return {
    monthlyBudgetUSD: envNumber("AI_MONTHLY_BUDGET_USD", 20),
    monthlyImageLimit: envNumber("AI_MONTHLY_IMAGE_LIMIT", 100),
  };
}

// ────────────────────────────────────────────────────────────
// Budget check
// ────────────────────────────────────────────────────────────

/**
 * Check whether the salon is within its monthly AI budget and unit limits.
 *
 * @param salonId - Salon to check
 * @param op      - Optional operation about to be performed; "image" / "banner"
 *                  additionally enforce the per-unit monthly cap.
 *
 * Fail-open: on a DB error (or an empty salonId) the check returns
 * `allowed: true` (with a warning logged) so transient DB issues never take
 * down all AI features.
 */
export async function checkAIBudget(
  salonId: string,
  op?: AIOperation,
): Promise<AIBudgetCheck> {
  const budget = getAIBudgetLimits();

  // Start of the current calendar month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let usage: AIBudgetUsage = { totalCostUSD: 0, imageCount: 0 };

  // `forSalon` w `try`: pusty salonId rzuca synchronicznie i ma dać ten sam
  // fail-open co błąd bazy, a nie wyjątek u wołającego.
  try {
    const stats = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          type: aiGeneratedMedia.type,
          provider: aiGeneratedMedia.provider,
          count: count(),
        })
        .from(aiGeneratedMedia)
        .where(
          and(
            eq(aiGeneratedMedia.salonId, salonId),
            gte(aiGeneratedMedia.createdAt, monthStart),
          ),
        )
        .groupBy(aiGeneratedMedia.type, aiGeneratedMedia.provider),
    );

    let totalCostUSD = 0;
    let imageCount = 0;

    for (const stat of stats) {
      const costPerUse =
        COST_MAP[`${stat.type}:${stat.provider}`] ?? DEFAULT_COST_PER_USE;
      totalCostUSD += stat.count * costPerUse;

      if (
        (stat.type === "image" || stat.type === "banner") &&
        stat.provider !== "sharp" // sharp is server-side, no API cost
      ) {
        imageCount += stat.count;
      }
    }

    usage = {
      totalCostUSD: Math.round(totalCostUSD * 100) / 100,
      imageCount,
    };
  } catch (error) {
    logger.warn("[AI Budget] Failed to compute usage — failing open", {
      error,
      salonId,
    });
    return { allowed: true, usage, budget };
  }

  // Total monthly budget (applies to every AI operation)
  if (usage.totalCostUSD >= budget.monthlyBudgetUSD) {
    return {
      allowed: false,
      reason: `Miesieczny budzet AI zostal wyczerpany (${usage.totalCostUSD.toFixed(2)} / ${budget.monthlyBudgetUSD} USD). Limit odnowi sie na poczatku nastepnego miesiaca.`,
      usage,
      budget,
    };
  }

  // Per-type unit limits
  if (
    (op === "image" || op === "banner") &&
    usage.imageCount >= budget.monthlyImageLimit
  ) {
    return {
      allowed: false,
      reason: `Miesieczny limit generowanych obrazow zostal osiagniety (${usage.imageCount} / ${budget.monthlyImageLimit}). Limit odnowi sie na poczatku nastepnego miesiaca.`,
      usage,
      budget,
    };
  }

  return { allowed: true, usage, budget };
}
