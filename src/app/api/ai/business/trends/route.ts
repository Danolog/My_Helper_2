import { NextResponse } from "next/server";
import {
  generateBusinessTrends,
  type BusinessTrendsResult,
} from "@/lib/ai/business/trends";
import { isProAIError, requireProPlan } from "@/lib/ai/gate";
import { logger } from "@/lib/logger";

export async function GET(_request: Request) {
  const gate = await requireProPlan();
  if (isProAIError(gate)) return gate;
  const { salonId } = gate;

  try {
    const result: BusinessTrendsResult = await generateBusinessTrends(salonId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[AI Business Trends] Error", { error: error });
    return NextResponse.json(
      { error: "Failed to compute business trends" },
      { status: 500 }
    );
  }
}
