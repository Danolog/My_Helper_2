import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiConversations } from "@/lib/schema";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";

interface MessageRequestBody {
  callerPhone: string;
  callerName?: string;
  message: string;
  conversationId?: string;
}

/**
 * POST /api/ai/voice/message
 * Takes a message from a caller when human transfer is not available.
 * Stores the message in the aiConversations table for later follow-up.
 */
export async function POST(req: Request) {
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

  let body: MessageRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.callerPhone || typeof body.callerPhone !== "string") {
    return NextResponse.json(
      { error: "callerPhone is required" },
      { status: 400 }
    );
  }

  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 }
    );
  }

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
    console.error("[Voice AI Message] Error:", error);
    return NextResponse.json(
      { error: "Blad podczas zapisywania wiadomosci" },
      { status: 500 }
    );
  }
}
