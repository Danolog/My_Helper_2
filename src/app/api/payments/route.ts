import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { depositPayments, subscriptionPayments, appointments, clients, services, salonSubscriptions, subscriptionPlans } from "@/lib/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

/**
 * GET /api/payments
 *
 * Returns a unified list of all payment transactions (deposits + subscriptions).
 * Supports filtering by:
 *  - salonId (required)
 *  - type: 'deposit' | 'subscription' | 'all' (default: 'all')
 *  - status: payment status filter
 *  - dateFrom: ISO date string for start date filter
 *  - dateTo: ISO date string for end date filter
 *  - page: pagination page number (default: 1)
 *  - limit: items per page (default: 20)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const salonId = searchParams.get("salonId");
    const type = searchParams.get("type") || "all";
    const status = searchParams.get("status");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    const offset = (page - 1) * limit;
    const transactions: Array<{
      id: string;
      type: "deposit" | "subscription";
      amount: string;
      currency: string;
      status: string;
      paymentMethod: string;
      description: string;
      clientName: string | null;
      date: Date;
      createdAt: Date;
      appointmentId: string | null;
      subscriptionId: string | null;
    }> = [];

    // Fetch deposit payments if type is 'all' or 'deposit'
    if (type === "all" || type === "deposit") {
      const depositConditions = [eq(depositPayments.salonId, salonId)];

      if (status) {
        depositConditions.push(eq(depositPayments.status, status));
      }
      if (dateFrom) {
        depositConditions.push(gte(depositPayments.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        // Add 1 day to include the end date fully
        const endDate = new Date(dateTo);
        endDate.setDate(endDate.getDate() + 1);
        depositConditions.push(lte(depositPayments.createdAt, endDate));
      }

      const depositRows = await db
        .select({
          id: depositPayments.id,
          amount: depositPayments.amount,
          currency: depositPayments.currency,
          status: depositPayments.status,
          paymentMethod: depositPayments.paymentMethod,
          paidAt: depositPayments.paidAt,
          createdAt: depositPayments.createdAt,
          appointmentId: depositPayments.appointmentId,
          refundedAt: depositPayments.refundedAt,
          refundReason: depositPayments.refundReason,
          clientFirstName: clients.firstName,
          clientLastName: clients.lastName,
          serviceName: services.name,
        })
        .from(depositPayments)
        .leftJoin(appointments, eq(depositPayments.appointmentId, appointments.id))
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(and(...depositConditions))
        .orderBy(desc(depositPayments.createdAt));

      for (const row of depositRows) {
        const clientName = row.clientFirstName && row.clientLastName
          ? `${row.clientFirstName} ${row.clientLastName}`
          : null;

        const description = row.serviceName
          ? `Zadatek - ${row.serviceName}`
          : "Zadatek za wizyte";

        transactions.push({
          id: row.id,
          type: "deposit",
          amount: row.amount,
          currency: row.currency,
          status: row.status,
          paymentMethod: row.paymentMethod,
          description,
          clientName,
          date: row.paidAt || row.createdAt,
          createdAt: row.createdAt,
          appointmentId: row.appointmentId,
          subscriptionId: null,
        });
      }
    }

    // Fetch subscription payments if type is 'all' or 'subscription'
    if (type === "all" || type === "subscription") {
      const subConditions = [eq(subscriptionPayments.salonId, salonId)];

      if (status) {
        subConditions.push(eq(subscriptionPayments.status, status));
      }
      if (dateFrom) {
        subConditions.push(gte(subscriptionPayments.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setDate(endDate.getDate() + 1);
        subConditions.push(lte(subscriptionPayments.createdAt, endDate));
      }

      const subRows = await db
        .select({
          id: subscriptionPayments.id,
          amount: subscriptionPayments.amount,
          currency: subscriptionPayments.currency,
          status: subscriptionPayments.status,
          paidAt: subscriptionPayments.paidAt,
          createdAt: subscriptionPayments.createdAt,
          subscriptionId: subscriptionPayments.subscriptionId,
          planName: subscriptionPlans.name,
        })
        .from(subscriptionPayments)
        .leftJoin(salonSubscriptions, eq(subscriptionPayments.subscriptionId, salonSubscriptions.id))
        .leftJoin(subscriptionPlans, eq(salonSubscriptions.planId, subscriptionPlans.id))
        .where(and(...subConditions))
        .orderBy(desc(subscriptionPayments.createdAt));

      for (const row of subRows) {
        transactions.push({
          id: row.id,
          type: "subscription",
          amount: row.amount,
          currency: row.currency,
          status: row.status,
          paymentMethod: "stripe",
          description: row.planName
            ? `Subskrypcja - ${row.planName}`
            : "Platnosc subskrypcji",
          clientName: null,
          date: row.paidAt || row.createdAt,
          createdAt: row.createdAt,
          appointmentId: null,
          subscriptionId: row.subscriptionId,
        });
      }
    }

    // Sort all transactions by date descending
    transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Pagination
    const total = transactions.length;
    const paginated = transactions.slice(offset, offset + limit);

    // Calculate summary stats
    const totalAmount = transactions
      .filter(t => t.status === "succeeded")
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const pendingAmount = transactions
      .filter(t => t.status === "pending")
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    const refundedAmount = transactions
      .filter(t => t.status === "refunded")
      .reduce((sum, t) => sum + parseFloat(t.amount), 0);

    return NextResponse.json({
      success: true,
      data: {
        transactions: paginated,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        summary: {
          totalSucceeded: totalAmount.toFixed(2),
          totalPending: pendingAmount.toFixed(2),
          totalRefunded: refundedAmount.toFixed(2),
          transactionCount: total,
        },
      },
    });
  } catch (error) {
    console.error("[Payments API] Error fetching payments:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch payments" },
      { status: 500 }
    );
  }
}
