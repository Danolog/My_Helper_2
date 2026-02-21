import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  clients,
  marketingConsents,
  newsletters,
  notifications,
} from "@/lib/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

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
  // Verify authentication
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
          eq(newsletters.salonId, DEMO_SALON_ID)
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
          eq(marketingConsents.salonId, DEMO_SALON_ID),
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

    // Send emails (dev mode: log to console, save to notifications)
    let sentCount = 0;
    let failedCount = 0;
    const sentDetails: {
      clientId: string;
      email: string;
      name: string;
      status: string;
    }[] = [];

    for (const recipient of recipients) {
      try {
        const fullName = `${recipient.firstName} ${recipient.lastName}`;
        const email = recipient.email!;

        // Log email to console (dev mode)
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║               📧  NEWSLETTER EMAIL SENT                     ║
╠══════════════════════════════════════════════════════════════╣
║  To:      ${email}
║  Name:    ${fullName}
║  Subject: ${newsletter.subject}
╠══════════════════════════════════════════════════════════════╣
║  Content preview:
║  ${newsletter.content.substring(0, 200).replace(/\n/g, "\n║  ")}...
╚══════════════════════════════════════════════════════════════╝
`);

        // Save to notifications table
        await db.insert(notifications).values({
          salonId: DEMO_SALON_ID,
          clientId: recipient.clientId,
          type: "email",
          message: `Newsletter: ${newsletter.subject}`,
          status: "sent",
          sentAt: new Date(),
        });

        sentCount++;
        sentDetails.push({
          clientId: recipient.clientId,
          email,
          name: fullName,
          status: "sent",
        });
      } catch (err) {
        console.error(
          `[Newsletter Send] Failed for client ${recipient.clientId}:`,
          err
        );
        failedCount++;
        sentDetails.push({
          clientId: recipient.clientId,
          email: recipient.email || "",
          name: `${recipient.firstName} ${recipient.lastName}`,
          status: "failed",
        });

        // Save failed notification
        try {
          await db.insert(notifications).values({
            salonId: DEMO_SALON_ID,
            clientId: recipient.clientId,
            type: "email",
            message: `Newsletter (failed): ${newsletter.subject}`,
            status: "failed",
          });
        } catch {
          // Ignore save failure
        }
      }
    }

    // Update newsletter with sent info
    await db
      .update(newsletters)
      .set({
        sentAt: new Date(),
        recipientsCount: sentCount,
      })
      .where(eq(newsletters.id, newsletterId));

    return Response.json({
      success: true,
      message: `Newsletter wyslany do ${sentCount} odbiorcow`,
      sentCount,
      failedCount,
      totalRecipients: recipients.length,
      details: sentDetails,
    });
  } catch (error) {
    console.error("[Newsletter Send] Error:", error);
    return Response.json(
      { error: "Blad podczas wysylania newslettera" },
      { status: 500 }
    );
  }
}
