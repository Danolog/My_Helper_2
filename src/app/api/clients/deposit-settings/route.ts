import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { clients, salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";
/**
 * GET /api/clients/deposit-settings?salonId=...
 *
 * Returns the deposit settings of the LOGGED-IN user's own client record in a
 * salon. Used by the booking page to determine if the client has custom
 * deposit requirements.
 *
 * P1 (IDOR): the email is taken ONLY from the session — an `email` query
 * parameter is ignored — and the response carries only what booking needs
 * (no clientId, no name). Previously any logged-in account could read another
 * person's name, clientId and deposit settings in any salon.
 */
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId || !isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Valid salonId is required" },
        { status: 400 }
      );
    }

    const notFound = {
      found: false,
      requireDeposit: false,
      depositType: null,
      depositValue: null,
    };
    const sessionEmail = authResult.user.email;

    const settings = await forSalon(salonId).raw(async (tx) => {
      const [salon] = await tx
        .select({ id: salons.id })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1);
      if (!salon) return null;
      if (!sessionEmail) return notFound;

      // Own client record only: lookup by the session email, never the query
      const [client] = await tx
        .select({
          requireDeposit: clients.requireDeposit,
          depositType: clients.depositType,
          depositValue: clients.depositValue,
        })
        .from(clients)
        .where(and(eq(clients.salonId, salonId), eq(clients.email, sessionEmail)))
        .limit(1);
      if (!client) return notFound;

      return {
        found: true,
        requireDeposit: client.requireDeposit ?? false,
        depositType: client.depositType || "percentage",
        depositValue: client.depositValue,
      };
    });

    if (!settings) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: settings });
  } catch (error) {
    logger.error("[Client Deposit Settings API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch client deposit settings" },
      { status: 500 }
    );
  }
}
