import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  subscriptionPayments,
  salonSubscriptions,
  subscriptionPlans,
} from "@/lib/schema";
import { eq, and, desc, gte, lte } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/subscriptions/payments
 *
 * Returns subscription payment history for the salon.
 *
 * Query params:
 *  - dateFrom: ISO date string (filter paidAt >= dateFrom)
 *  - dateTo: ISO date string (filter paidAt <= dateTo)
 *  - status: payment status filter ('succeeded' | 'pending' | 'failed')
 *  - page: pagination page number (default: 1)
 *  - limit: items per page (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    // Build conditions
    const conditions = [eq(subscriptionPayments.salonId, DEMO_SALON_ID)];

    if (status) {
      conditions.push(eq(subscriptionPayments.status, status));
    }
    if (dateFrom) {
      conditions.push(
        gte(subscriptionPayments.createdAt, new Date(dateFrom)),
      );
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      conditions.push(lte(subscriptionPayments.createdAt, endDate));
    }

    // Query subscription payments with plan info
    const rows = await db
      .select({
        id: subscriptionPayments.id,
        subscriptionId: subscriptionPayments.subscriptionId,
        amount: subscriptionPayments.amount,
        currency: subscriptionPayments.currency,
        status: subscriptionPayments.status,
        stripePaymentIntentId: subscriptionPayments.stripePaymentIntentId,
        paidAt: subscriptionPayments.paidAt,
        createdAt: subscriptionPayments.createdAt,
        // Subscription info
        subscriptionStatus: salonSubscriptions.status,
        currentPeriodStart: salonSubscriptions.currentPeriodStart,
        currentPeriodEnd: salonSubscriptions.currentPeriodEnd,
        // Plan info
        planName: subscriptionPlans.name,
        planSlug: subscriptionPlans.slug,
        planPrice: subscriptionPlans.priceMonthly,
      })
      .from(subscriptionPayments)
      .leftJoin(
        salonSubscriptions,
        eq(subscriptionPayments.subscriptionId, salonSubscriptions.id),
      )
      .leftJoin(
        subscriptionPlans,
        eq(salonSubscriptions.planId, subscriptionPlans.id),
      )
      .where(and(...conditions))
      .orderBy(desc(subscriptionPayments.createdAt));

    // Pagination
    const total = rows.length;
    const offset = (page - 1) * limit;
    const paginated = rows.slice(offset, offset + limit);

    // Summary stats
    const totalSucceeded = rows
      .filter((r) => r.status === "succeeded")
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    const totalPending = rows
      .filter((r) => r.status === "pending")
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    const totalFailed = rows
      .filter((r) => r.status === "failed")
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);

    return NextResponse.json({
      success: true,
      data: {
        payments: paginated.map((row) => ({
          id: row.id,
          subscriptionId: row.subscriptionId,
          amount: row.amount,
          currency: row.currency,
          status: row.status,
          stripePaymentIntentId: row.stripePaymentIntentId,
          paidAt: row.paidAt,
          createdAt: row.createdAt,
          planName: row.planName || "Nieznany plan",
          planSlug: row.planSlug || "unknown",
          planPrice: row.planPrice,
          subscriptionStatus: row.subscriptionStatus,
          periodStart: row.currentPeriodStart,
          periodEnd: row.currentPeriodEnd,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        summary: {
          totalSucceeded: totalSucceeded.toFixed(2),
          totalPending: totalPending.toFixed(2),
          totalFailed: totalFailed.toFixed(2),
          paymentCount: total,
          succeededCount: rows.filter((r) => r.status === "succeeded").length,
          pendingCount: rows.filter((r) => r.status === "pending").length,
          failedCount: rows.filter((r) => r.status === "failed").length,
        },
      },
    });
  } catch (error) {
    console.error(
      "[Subscription Payments API] Error fetching payments:",
      error,
    );
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac historii platnosci" },
      { status: 500 },
    );
  }
}
