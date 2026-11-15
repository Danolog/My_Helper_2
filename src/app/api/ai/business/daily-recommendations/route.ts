import { NextResponse } from "next/server";
import {
  generateDailyRecommendations,
  type DailyRecommendationsResult,
} from "@/lib/ai/business/daily-recommendations";
import { isProAIError, requireProPlan } from "@/lib/ai/gate";
import { logger } from "@/lib/logger";

export async function GET(_request: Request) {
  const gate = await requireProPlan();
  if (isProAIError(gate)) return gate;
  const { salonId } = gate;

  try {
    const result: DailyRecommendationsResult =
      await generateDailyRecommendations(salonId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[AI Daily Recommendations] Error", { error: error });
    return NextResponse.json(
      { error: "Failed to generate daily recommendations" },
      { status: 500 }
    );
  }
}
