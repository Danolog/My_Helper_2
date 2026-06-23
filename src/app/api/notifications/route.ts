import { NextResponse } from "next/server";
import { notifications, clients } from "@/lib/schema";
import { desc, eq, and, sql } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
/**
 * GET /api/notifications
 *
 * Returns the notification log for a salon.
 * Supports filtering by type (sms, email, push) and status (pending, sent, failed).
 * Includes client name if the notification is linked to a client.
 *
 * Query params:
 *   - salonId: required - the salon to fetch notifications for
 *   - type: optional - filter by notification type ('sms', 'email', 'push')
 *   - status: optional - filter by status ('pending', 'sent', 'failed')
 *   - limit: optional - max number of results (default 50)
 *   - offset: optional - pagination offset (default 0)
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

    // Join + count — przez raw(tx) z jawnym eq(salonId) w `conditions`
    // (defense in depth: filtr aplikacyjny widoczny, kontekst RLS ustawiony).
    const { results, countResult } = await forSalon(salonId).raw(async (tx) => {
      const rows = await tx
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
        .offset(offset);

      const [count] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(...conditions));

      return { results: rows, countResult: count };
    });

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
  } catch (error) {
    logger.error("[Notifications API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}
