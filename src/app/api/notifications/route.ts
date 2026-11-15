import { NextResponse } from "next/server";
import { desc, eq, and, sql } from "drizzle-orm";
import { withApiHandler } from "@/lib/api-handler";
import { requireSalonStaff } from "@/lib/salon-context";
import { notifications, clients } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
/**
 * GET /api/notifications
 *
 * Returns the notification log for a salon.
 * Supports filtering by type (sms, email, push) and status (pending, sent, failed).
 * Includes client name if the notification is linked to a client.
 *
 * Query params:
 *   - salonId: optional - musi byc salonem z sesji (inny => 403); salon
 *     zawsze pochodzi z sesji (requireSalonStaff), nie z query
 *   - type: optional - filter by notification type ('sms', 'email', 'push')
 *   - status: optional - filter by status ('pending', 'sent', 'failed')
 *   - limit: optional - max number of results (default 50)
 *   - offset: optional - pagination offset (default 0)
 */
export const GET = withApiHandler(
  {
    auth: "user",
    logLabel: "[Notifications API] GET",
    errorMessage: "Failed to fetch notifications",
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    // P0 (przeglad Ryana): salon z sesji, query salonId tylko porownywany.
    // Dostep: kazdy personel wlasnego salonu (zachowanie sprzed naprawy w
    // obrebie salonu; zawezenie roli = decyzja produktowa, opis PR).
    const guard = await requireSalonStaff({
      requestedSalonId: searchParams.get("salonId"),
    });
    if (guard.error) return guard.error;
    const salonId = guard.ctx.salonId;
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build conditions
    const conditions = [eq(notifications.salonId, salonId)];
    if (type) {
      conditions.push(eq(notifications.type, type));
    }
    if (status) {
      conditions.push(eq(notifications.status, status));
    }

    // Query notifications with client info
    const results = await forSalon(salonId).raw((tx) =>
      tx
      .select({
        id: notifications.id,
        salonId: notifications.salonId,
        clientId: notifications.clientId,
        type: notifications.type,
        message: notifications.message,
        sentAt: notifications.sentAt,
        status: notifications.status,
        createdAt: notifications.createdAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        clientPhone: clients.phone,
      })
      .from(notifications)
      .leftJoin(clients, eq(notifications.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset)
    );

    // Get total count for pagination
    const [countResult] = await forSalon(salonId).raw((tx) =>
      tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(...conditions))
    );

    const total = countResult?.count || 0;

    return NextResponse.json({
      success: true,
      data: {
        notifications: results.map((n) => ({
          id: n.id,
          salonId: n.salonId,
          clientId: n.clientId,
          type: n.type,
          message: n.message,
          sentAt: n.sentAt,
          status: n.status,
          createdAt: n.createdAt,
          clientName: n.clientFirstName
            ? `${n.clientFirstName} ${n.clientLastName}`
            : null,
          clientPhone: n.clientPhone,
        })),
        total,
        limit,
        offset,
      },
    });
  }
);
