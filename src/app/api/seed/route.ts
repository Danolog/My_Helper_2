import { NextResponse } from "next/server";
import { requirePlatformAdmin, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
// ADR-001: seed deweloperski (cross-salon, poza produkcją) — wyjście systemowe #193 z blokadą celu
import { seedDemoData } from "@/lib/server/system";

// POST /api/seed - Seed test data for development
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seed route is disabled in production" }, { status: 403 });
  }

  // Tylko admini platformy z ADMIN_EMAILS (nie user.role).
  const authResult = await requirePlatformAdmin();
  if (isAuthError(authResult)) return authResult;

  try {
    const result = await seedDemoData();
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: "Seed is disabled for this database target" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Seed completed successfully",
      data: result.data,
    });
  } catch (error) {
    logger.error("[Seed API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to seed data", details: String(error) },
      { status: 500 }
    );
  }
}
