import { NextResponse } from "next/server";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
/**
 * GET /api/ai/voice/call-log
 * Returns recent voice AI call logs for the salon.
 */
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  try {
    const logs = await db
      .select({
        id: aiConversations.id,
        transcript: aiConversations.transcript,
        createdAt: aiConversations.createdAt,
      })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.salonId, salonId),
          eq(aiConversations.channel, "voice")
        )
      )
      .orderBy(desc(aiConversations.createdAt))
      .limit(20);

    const formattedLogs = logs.map((log) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = typeof log.transcript === "string" ? JSON.parse(log.transcript) : (log.transcript as unknown as Record<string, unknown>) || {};
      } catch {
        parsed = {};
      }

      return {
        id: log.id,
        callerPhone: parsed.callerPhone || "Nieznany",
        callerMessage: parsed.callerMessage || "",
        aiResponse: parsed.aiResponse || "",
        intent: parsed.intent || "unknown",
        timestamp: log.createdAt,
      };
    });

    return NextResponse.json({ logs: formattedLogs });
  } catch (error) {
    logger.error("[Voice AI Call Log] Error", { error: error });
    return NextResponse.json({ error: "Blad serwera" }, { status: 500 });
  }
}
