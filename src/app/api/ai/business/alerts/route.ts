import { NextResponse } from "next/server";
import {
  generateBusinessAlerts,
  type BusinessAlertsResult,
} from "@/lib/ai/business/alerts";
import { isProAIError, requireProPlan } from "@/lib/ai/gate";
import { logger } from "@/lib/logger";

export async function GET(_request: Request) {
  const gate = await requireProPlan();
  if (isProAIError(gate)) return gate;
  const { salonId } = gate;

  try {
    const result: BusinessAlertsResult = await generateBusinessAlerts(salonId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("[AI Business Alerts] Error", { error: error });
    return NextResponse.json(
      { error: "Failed to generate business alerts" },
      { status: 500 }
    );
  }
}
