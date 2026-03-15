import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  clients,
  marketingConsents,
  newsletters,
  notifications,
} from "@/lib/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";

const sendSchema = z.object({
  // Optional: send only to specific client IDs. If not provided, send to all consented.
  recipientIds: z.array(z.string().uuid()).optional(),
  // Optional: schedule for later (not yet implemented, just store timestamp)
  scheduleAt: z.string().datetime().optional(),
});

/**
 * POST /api/newsletters/[id]/send
 *
 * Send a saved newsletter to all consenting clients (or a subset).
 * In development mode, emails are logged to the console.
 * Each send attempt is recorded in the notifications table.
 * The newsletter is updated with sentAt and recipientsCount.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: mass email sending is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  const { id: newsletterId } = await params;

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Nieprawidlowe dane",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { recipientIds } = parsed.data;

  try {
    // Fetch newsletter
    const [newsletter] = await db
      .select()
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

    // Get consented clients with email
    let consentedClientsQuery = db
      .select({
        clientId: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        email: clients.email,
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

    const allConsented = await consentedClientsQuery;

    // Filter to valid emails
    let recipients = allConsented.filter(
      (c) => c.email && c.email.trim().length > 0
    );

    // If specific recipientIds provided, filter further
    if (recipientIds && recipientIds.length > 0) {
      const idSet = new Set(recipientIds);
      recipients = recipients.filter((r) => idSet.has(r.clientId));
    }

    if (recipients.length === 0) {
      return Response.json(
        {
          error:
            "Brak odbiorcow z aktywna zgoda na email. Dodaj zgody marketingowe dla klientow.",
        },
        { status: 400 }
      );
    }

    // Process email sends first (external side-effects stay outside the transaction)
    let sentCount = 0;
    let failedCount = 0;
    const sentDetails: {
      clientId: string;
      email: string;
      name: string;
      status: string;
    }[] = [];

    for (const recipient of recipients) {
      const fullName = `${recipient.firstName} ${recipient.lastName}`;
      const email = recipient.email || "";

      try {
        // Log email send (dev mode — replace with real email service in production)
        logger.info("Newsletter email sent", {
          to: email,
          recipientName: fullName,
          subject: newsletter.subject,
          contentPreview: newsletter.content.substring(0, 200),
        });

        sentCount++;
        sentDetails.push({
          clientId: recipient.clientId,
          email,
          name: fullName,
          status: "sent",
        });
      } catch (err) {
        logger.error("Newsletter send failed for client", {
          clientId: recipient.clientId,
          error: err,
        });
        failedCount++;
        sentDetails.push({
          clientId: recipient.clientId,
          email,
          name: fullName,
          status: "failed",
        });
      }
    }

    // Wrap all database writes in a transaction for atomicity:
    // - batch insert notification records for each recipient
    // - update the newsletter with sent timestamp and recipient count
    await db.transaction(async (tx) => {
      const notificationRows = sentDetails.map((detail) => ({
        salonId: salonId,
        clientId: detail.clientId,
        type: "email" as const,
        message:
          detail.status === "sent"
            ? `Newsletter: ${newsletter.subject}`
            : `Newsletter (failed): ${newsletter.subject}`,
        status: detail.status === "sent" ? ("sent" as const) : ("failed" as const),
        sentAt: detail.status === "sent" ? new Date() : undefined,
      }));

      if (notificationRows.length > 0) {
        await tx.insert(notifications).values(notificationRows);
      }

      await tx
        .update(newsletters)
        .set({
          sentAt: new Date(),
          recipientsCount: sentCount,
        })
        .where(eq(newsletters.id, newsletterId));
    });

    return Response.json({
      success: true,
      message: `Newsletter wyslany do ${sentCount} odbiorcow`,
      sentCount,
      failedCount,
      totalRecipients: recipients.length,
      details: sentDetails,
    });
  } catch (error) {
    logger.error("Newsletter send error", { error });
    return Response.json(
      { error: "Blad podczas wysylania newslettera" },
      { status: 500 }
    );
  }
}
