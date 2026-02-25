import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, marketingConsents, newsletters } from "@/lib/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";

/**
 * GET /api/newsletters/[id]/recipients
 *
 * Returns a list of clients who have consented to email marketing
 * and have a valid email address. These are the eligible recipients
 * for the specified newsletter.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Verify authentication
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  const { id: newsletterId } = await params;

  try {
    // Verify newsletter exists and belongs to salon
    const [newsletter] = await db
      .select({
        id: newsletters.id,
        subject: newsletters.subject,
        sentAt: newsletters.sentAt,
      })
      .from(newsletters)
      .where(
        and(
          eq(newsletters.id, newsletterId),
          eq(newsletters.salonId, salonId)
        )
      )
      .limit(1);

    if (!newsletter) {
      return Response.json(
        { error: "Newsletter nie zostal znaleziony" },
        { status: 404 }
      );
    }

    // Get clients with email consent who have a valid email
    // A consent is active if grantedAt is set and revokedAt is null
    const consentedClients = await db
      .select({
        clientId: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        email: clients.email,
        consentGrantedAt: marketingConsents.grantedAt,
      })
      .from(marketingConsents)
      .innerJoin(clients, eq(marketingConsents.clientId, clients.id))
      .where(
        and(
          eq(marketingConsents.salonId, salonId),
          eq(marketingConsents.consentType, "email"),
          isNull(marketingConsents.revokedAt),
          isNotNull(clients.email)
        )
      );

    // Filter out clients with empty emails
    const recipients = consentedClients.filter(
      (c) => c.email && c.email.trim().length > 0
    );

    // Also get total client count with email (for context)
    const allClientsWithEmail = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        email: clients.email,
      })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, salonId),
          isNotNull(clients.email)
        )
      );

    const clientsWithEmail = allClientsWithEmail.filter(
      (c) => c.email && c.email.trim().length > 0
    );

    return Response.json({
      newsletterId: newsletter.id,
      newsletterSubject: newsletter.subject,
      alreadySent: !!newsletter.sentAt,
      recipients: recipients.map((r) => ({
        clientId: r.clientId,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        consentGrantedAt: r.consentGrantedAt,
      })),
      consentedCount: recipients.length,
      totalClientsWithEmail: clientsWithEmail.length,
    });
  } catch (error) {
    console.error("[Newsletter Recipients] Error:", error);
    return Response.json(
      { error: "Blad podczas pobierania odbiorcow" },
      { status: 500 }
    );
  }
}
