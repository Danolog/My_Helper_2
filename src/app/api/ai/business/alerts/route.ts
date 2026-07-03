import { NextResponse } from "next/server";
import {
  generateBusinessAlerts,
  type BusinessAlertsResult,
} from "@/lib/ai/business/alerts";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { isProPlan } from "@/lib/subscription";

export async function GET(_request: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  // Auth check and resolve salon
  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Pro plan check
  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro." },
      { status: 403 }
    );
  }

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
