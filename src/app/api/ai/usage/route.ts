import { eq, and, gte, count } from "drizzle-orm";
import { requireProAI, isProAIError } from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { aiGeneratedMedia } from "@/lib/schema";

// ────────────────────────────────────────────────────────────
// Cost-per-use map keyed by "type:provider"
// ────────────────────────────────────────────────────────────

const COST_MAP: Record<string, number> = {
  // Media generation costs
  "image:google_imagen": 0.01, // Social graphics (Imagen)
  "image:sharp": 0, // Photo enhancement — server-side, no API cost
  "banner:google_imagen": 0.01, // Banner generation
  "banner:sharp": 0, // Server-side banner compositing
  "video:google_veo": 0.15, // Video clips (Veo)
  // Text AI costs (OpenRouter — Claude Sonnet)
  "text:openrouter": 0.002,
};

/** Fallback cost when the type:provider combination is not in the map. */
const DEFAULT_COST_PER_USE = 0.002;

// ────────────────────────────────────────────────────────────
// GET /api/ai/usage — AI usage statistics for the current salon
// ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "month";

  // Calculate date range based on period
  const now = new Date();
  const startDate = new Date(now);

  if (period === "week") {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === "month") {
    startDate.setMonth(startDate.getMonth() - 1);
  } else {
    // Default to year for any other value
    startDate.setFullYear(startDate.getFullYear() - 1);
  }

  try {
    // Count generated media grouped by type and provider
    const mediaStats = await db
      .select({
        type: aiGeneratedMedia.type,
        provider: aiGeneratedMedia.provider,
        count: count(),
      })
      .from(aiGeneratedMedia)
      .where(
        and(
          eq(aiGeneratedMedia.salonId, salonId),
          gte(aiGeneratedMedia.createdAt, startDate),
        ),
      )
      .groupBy(aiGeneratedMedia.type, aiGeneratedMedia.provider);

    // Build usage summary with estimated costs
    const usage = mediaStats.map((stat) => {
      const key = `${stat.type}:${stat.provider}`;
      const costPerUse = COST_MAP[key] ?? DEFAULT_COST_PER_USE;
      const estimatedCost = stat.count * costPerUse;

      return {
        type: stat.type,
        provider: stat.provider,
        count: stat.count,
        estimatedCost: estimatedCost.toFixed(2),
        costPerUse,
      };
    });

    const totalCost = usage.reduce(
      (sum, u) => sum + parseFloat(u.estimatedCost),
      0,
    );

    return Response.json({
      success: true,
      period,
      startDate: startDate.toISOString(),
      usage,
      totalMediaCost: totalCost.toFixed(2),
      note: "Koszty obejmuja media (obrazy, wideo, banery) oraz tekst AI (podsumowania, wyszukiwanie, kategoryzacja itp.). Szacunek tekstu: ~$0.002/zapytanie.",
    });
  } catch (error) {
    logger.error("[AI Usage] Error fetching usage stats", { error });
    return Response.json(
      { error: "Blad pobierania statystyk" },
      { status: 500 },
    );
  }
}
