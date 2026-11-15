import { NextResponse } from "next/server";
import {
  generateWeeklyRecommendations,
  type WeeklyRecommendationsResult,
} from "@/lib/ai/business/weekly-recommendations";
import { isProAIError, requireProPlan } from "@/lib/ai/gate";
import { logger } from "@/lib/logger";

export async function GET(_request: Request) {
  const gate = await requireProPlan();
  if (isProAIError(gate)) return gate;
  const { salonId } = gate;

  try {
    const result: WeeklyRecommendationsResult =
      await generateWeeklyRecommendations(salonId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[AI Weekly Recommendations] Error", { error: error });
    return NextResponse.json(
      { error: "Failed to generate weekly recommendations" },
      { status: 500 }
    );
  }
}
