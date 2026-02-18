import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/ai/voice/call-log
 * Returns recent voice AI call logs for the salon.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
          eq(aiConversations.salonId, DEMO_SALON_ID),
          eq(aiConversations.channel, "voice")
        )
      )
      .orderBy(desc(aiConversations.createdAt))
      .limit(20);

    const formattedLogs = logs.map((log) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = typeof log.transcript === "string" ? JSON.parse(log.transcript) : (log.transcript as Record<string, unknown>) || {};
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
    console.error("[Voice AI Call Log] Error:", error);
    return NextResponse.json({ error: "Blad serwera" }, { status: 500 });
  }
}
