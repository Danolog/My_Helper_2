import { NextResponse } from "next/server";
import { generateBusinessSuggestions } from "@/lib/ai/business/suggestions";
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
