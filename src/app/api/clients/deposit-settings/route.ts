import { NextResponse } from "next/server";
import { clients } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

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

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json(
        { success: false, error: "email is required" },
        { status: 400 }
      );
    }

    // Look up the client in the salon by email (jawny eq(salonId) + RLS przez forSalon)
    const [client] = await forSalon(salonId).raw((tx) =>
      tx
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
        .limit(1)
    );

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
