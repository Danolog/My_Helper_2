import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
/**
 * GET /api/clients/deposit-settings?salonId=...&email=...
 *
 * Looks up a client in a salon by email and returns their deposit settings.
 * Used by the booking page to determine if a client has custom deposit requirements.
 */
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");
    const email = searchParams.get("email");

    if (!salonId || !email) {
      return NextResponse.json(
        { success: false, error: "salonId and email are required" },
        { status: 400 }
      );
    }

    // Look up the client in the salon by email
    const [client] = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        requireDeposit: clients.requireDeposit,
        depositType: clients.depositType,
        depositValue: clients.depositValue,
      })
      .from(clients)
      .where(and(eq(clients.salonId, salonId), eq(clients.email, email)))
      .limit(1);

    if (!client) {
      return NextResponse.json({
        success: true,
        data: {
          found: false,
          requireDeposit: false,
          depositType: null,
          depositValue: null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        found: true,
        clientId: client.id,
        clientName: `${client.firstName} ${client.lastName}`,
        requireDeposit: client.requireDeposit ?? false,
        depositType: client.depositType || "percentage",
        depositValue: client.depositValue,
      },
    });
  } catch (error) {
    logger.error("[Client Deposit Settings API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch client deposit settings" },
      { status: 500 }
    );
  }
}
