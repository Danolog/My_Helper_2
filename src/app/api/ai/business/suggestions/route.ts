import { NextResponse } from "next/server";
import { isProAIError, requireProPlan } from "@/lib/ai/gate";
import { generateBusinessSuggestions } from "@/lib/ai/business/suggestions";
import { logger } from "@/lib/logger";

export async function GET(_request: Request) {
  const gate = await requireProPlan();
  if (isProAIError(gate)) return gate;
  const { salonId } = gate;

  try {
    const { suggestions, generatedAt, dataRange } =
      await generateBusinessSuggestions(salonId);

    return NextResponse.json({
      success: true,
      suggestions,
      generatedAt,
      dataRange,
    });
  } catch (error) {
    logger.error("[AI Business Suggestions] Error", { error: error });
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 }
    );
  }
}
