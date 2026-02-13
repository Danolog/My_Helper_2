import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients, appointments, notifications, salons } from "@/lib/schema";
import { eq, sql, and, lt, isNull, or } from "drizzle-orm";

interface WeMissYouSettings {
  enabled: boolean;
  inactiveDays: number;
  customMessage: string;
  includeBookingLink: boolean;
  autoSend: boolean;
}

const DEFAULT_INACTIVE_DAYS = 30;
const DEFAULT_MESSAGE =
  "Czesc {imie}! Dawno Cie u nas nie widzielismy w {salon}. Minelo juz {dni} dni od Twojej ostatniej wizyty. Tesknimy! Zarezerwuj wizyte i wroc do nas.";
const DEFAULT_INCLUDE_BOOKING_LINK = true;

/** Number of days to wait before sending another "we miss you" notification to the same client. */
const SPAM_GUARD_DAYS = 7;

/**
 * Find inactive clients for a salon based on "we miss you" settings.
 *
 * A client is considered inactive when:
 * - Their most recent appointment started before the cutoff date, OR
 * - They have no appointments at all and were created before the cutoff date.
 */
async function findInactiveClients(salonId: string, inactiveDays: number) {
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
  const cutoffISO = cutoffDate.toISOString();

  // Subquery: get the latest appointment start time per client
  const lastVisitSubquery = db
    .select({
      clientId: appointments.clientId,
      lastVisit: sql<string>`MAX(${appointments.startTime})`.as("last_visit"),
    })
    .from(appointments)
    .where(eq(appointments.salonId, salonId))
    .groupBy(appointments.clientId)
    .as("last_visit_sq");

  // Left join clients with the last-visit subquery, then filter for inactive ones
  const inactiveClients = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      phone: clients.phone,
      email: clients.email,
      createdAt: clients.createdAt,
      lastVisit: lastVisitSubquery.lastVisit,
    })
    .from(clients)
    .leftJoin(lastVisitSubquery, eq(clients.id, lastVisitSubquery.clientId))
    .where(
      and(
        eq(clients.salonId, salonId),
        or(
          // Has appointments but the latest one is before the cutoff
          and(
            sql`${lastVisitSubquery.lastVisit} IS NOT NULL`,
            sql`${lastVisitSubquery.lastVisit} < ${cutoffISO}::timestamp`
          ),
          // Has no appointments at all and was created before the cutoff
          and(
            isNull(lastVisitSubquery.lastVisit),
            lt(clients.createdAt, cutoffDate)
          )
        )
      )
    );

  // Calculate daysSinceVisit using JavaScript Date math
  const enriched = inactiveClients.map((client) => {
    let lastVisitDate: string | null = null;
    let daysSinceVisit: number;

    if (client.lastVisit) {
      const lastVisitParsed = new Date(client.lastVisit);
      lastVisitDate = lastVisitParsed.toISOString().split("T")[0] ?? null;
      daysSinceVisit = Math.floor(
        (now.getTime() - lastVisitParsed.getTime()) / (1000 * 60 * 60 * 24)
      );
    } else {
      // No appointments: use the client creation date as reference
      const createdAtDate = new Date(client.createdAt);
      lastVisitDate = null;
      daysSinceVisit = Math.floor(
        (now.getTime() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      email: client.email,
      lastVisitDate,
      daysSinceVisit,
    };
  });

  return { clients: enriched, cutoffDate: cutoffDate.toISOString().split("T")[0] };
}

/**
 * GET /api/notifications/we-miss-you?salonId=...
 *
 * Check for inactive clients and return the list.
 * Also returns the saved "we miss you" settings for the salon.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Get salon with settings
    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    // Extract "we miss you" settings
    const salonSettings = salon?.settingsJson as Record<string, unknown> | null;
    const weMissYouSettings = (salonSettings?.weMissYou || null) as WeMissYouSettings | null;

    const inactiveDays = weMissYouSettings?.inactiveDays || DEFAULT_INACTIVE_DAYS;

    const { clients: inactiveClients, cutoffDate } = await findInactiveClients(
      salonId,
      inactiveDays
    );

    return NextResponse.json({
      success: true,
      data: {
        clients: inactiveClients,
        count: inactiveClients.length,
        inactiveDays,
        cutoffDate,
        weMissYouSettings,
      },
    });
  } catch (error) {
    console.error("[We Miss You Notifications API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to check we-miss-you notifications" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications/we-miss-you
 *
 * Send "we miss you" re-engagement notifications to inactive clients.
 * Creates notification records in the database.
 *
 * Body params:
 *   - salonId: string (required)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId } = body;

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    // Get salon name and settings
    const [salon] = await db
      .select({ name: salons.name, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const salonName = salon?.name || "Nasz salon";

    // Get saved "we miss you" settings
    const salonSettings = salon?.settingsJson as Record<string, unknown> | null;
    const savedSettings = (salonSettings?.weMissYou || {}) as Partial<WeMissYouSettings>;

    const inactiveDays = savedSettings.inactiveDays || DEFAULT_INACTIVE_DAYS;
    const customMessage = savedSettings.customMessage || DEFAULT_MESSAGE;
    const includeBookingLink =
      savedSettings.includeBookingLink !== undefined
        ? savedSettings.includeBookingLink
        : DEFAULT_INCLUDE_BOOKING_LINK;

    // Find inactive clients
    const { clients: inactiveClients } = await findInactiveClients(salonId, inactiveDays);

    if (inactiveClients.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          notificationsSent: 0,
          message: "Brak nieaktywnych klientow do powiadomienia",
        },
      });
    }

    // Spam guard: calculate the date threshold (7 days ago)
    const spamGuardDate = new Date();
    spamGuardDate.setDate(spamGuardDate.getDate() - SPAM_GUARD_DAYS);
    const spamGuardISO = spamGuardDate.toISOString();

    const createdNotifications = [];

    for (const client of inactiveClients) {
      // Check if we already sent a "we miss you" notification to this client recently
      const [existing] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.salonId, salonId),
            eq(notifications.clientId, client.id),
            or(
              sql`${notifications.message} ILIKE '%tesknimy%'`,
              sql`${notifications.message} ILIKE '%tęsknimy%'`,
              sql`${notifications.message} ILIKE '%nie widzieli%'`,
              sql`${notifications.message} ILIKE '%miss you%'`
            ),
            sql`${notifications.createdAt} >= ${spamGuardISO}::timestamp`
          )
        )
        .limit(1);

      if (existing) {
        console.log(
          `[We Miss You Notifications] Already sent notification to ${client.firstName} ${client.lastName} in the last ${SPAM_GUARD_DAYS} days, skipping`
        );
        continue;
      }

      // Build the "we miss you" message from the template
      let message = customMessage
        .replace("{imie}", client.firstName)
        .replace("{nazwisko}", client.lastName)
        .replace("{salon}", salonName)
        .replace("{dni}", String(client.daysSinceVisit));

      // Append booking link if enabled
      if (includeBookingLink) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        message += ` Zarezerwuj teraz: ${appUrl}/salons/${salonId}/book`;
      }

      // Create notification - send via SMS if phone is available, otherwise email, fallback to push
      const notificationType = client.phone
        ? "sms"
        : client.email
          ? "email"
          : "push";

      const [notification] = await db
        .insert(notifications)
        .values({
          salonId,
          clientId: client.id,
          type: notificationType,
          message,
          status: "sent",
          sentAt: new Date(),
        })
        .returning();

      console.log(
        `[We Miss You Notifications] Sent notification to ${client.firstName} ${client.lastName} (${notificationType}): ${message}`
      );

      createdNotifications.push({
        ...notification,
        clientName: `${client.firstName} ${client.lastName}`,
        clientPhone: client.phone,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        notificationsSent: createdNotifications.length,
        notifications: createdNotifications,
        message: `Wyslano ${createdNotifications.length} powiadomien "tesknimy"`,
      },
    });
  } catch (error) {
    console.error("[We Miss You Notifications API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to send we-miss-you notifications" },
      { status: 500 }
    );
  }
}
