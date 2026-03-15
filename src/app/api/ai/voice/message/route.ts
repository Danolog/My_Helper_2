import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/schema";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { voiceMessageSchema, validateBody } from "@/lib/api-validation";

import { logger } from "@/lib/logger";

/**
 * POST /api/ai/voice/message
 * Takes a message from a caller when human transfer is not available.
 * Stores the message in the aiConversations table for later follow-up.
 */
export async function POST(req: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      {
        error: "Funkcje AI sa dostepne tylko w Planie Pro.",
        code: "PLAN_UPGRADE_REQUIRED",
      },
      { status: 403 }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validateBody(voiceMessageSchema, rawBody);
  if (validationError) {
    return NextResponse.json(validationError, { status: 400 });
  }

  const body = rawBody as { callerPhone: string; callerName?: string; message: string; conversationId?: string };

  try {
    // Generate a human-readable reference number: MSG-YYYYMMDD-XXXX
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const randomPart = Math.floor(1000 + Math.random() * 9000).toString();
    const referenceNumber = `MSG-${datePart}-${randomPart}`;

    const conversationRows = await db
      .insert(aiConversations)
      .values({
        salonId: salonId,
        channel: "voice",
        transcript: JSON.stringify({
          type: "message_taken",
          callerPhone: body.callerPhone,
          callerName: body.callerName || null,
          message: body.message,
          referenceNumber,
          linkedConversationId: body.conversationId || null,
          timestamp: now.toISOString(),
        }),
      })
      .returning();

    const conversation = conversationRows[0];

    return NextResponse.json({
      success: true,
      referenceNumber,
      conversationId: conversation?.id ?? null,
      message: `Wiadomosc zostala zapisana. Numer referencyjny: ${referenceNumber}. Skontaktujemy sie z Panem/Pania najszybciej jak to mozliwe.`,
    });
  } catch (error) {
    logger.error("[Voice AI Message] Error", { error: error });
    return NextResponse.json(
      { error: "Blad podczas zapisywania wiadomosci" },
      { status: 500 }
    );
  }
}
