import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  employeeCommissions,
  employees,
  appointments,
  services,
  clients,
} from "@/lib/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/finance/commissions - List commissions with employee totals
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const employeeId = searchParams.get("employeeId");

    // Build conditions
    const conditions = [];
    if (dateFrom) {
      conditions.push(gte(employeeCommissions.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      conditions.push(lte(employeeCommissions.createdAt, toDate));
    }
    if (employeeId) {
      conditions.push(eq(employeeCommissions.employeeId, employeeId));
    }

    // Get individual commission records with details
    const commissionsQuery = db
      .select({
        id: employeeCommissions.id,
        employeeId: employeeCommissions.employeeId,
        appointmentId: employeeCommissions.appointmentId,
        amount: employeeCommissions.amount,
        percentage: employeeCommissions.percentage,
        paidAt: employeeCommissions.paidAt,
        createdAt: employeeCommissions.createdAt,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        employeeColor: employees.color,
        serviceName: services.name,
        servicePrice: services.basePrice,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        appointmentDate: appointments.startTime,
      })
      .from(employeeCommissions)
      .leftJoin(employees, eq(employeeCommissions.employeeId, employees.id))
      .leftJoin(
        appointments,
        eq(employeeCommissions.appointmentId, appointments.id)
      )
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .orderBy(desc(employeeCommissions.createdAt));

    const commissions =
      conditions.length > 0
        ? await commissionsQuery.where(and(...conditions))
        : await commissionsQuery;

    // Calculate employee totals
    const employeeTotalsQuery = db
      .select({
        employeeId: employeeCommissions.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        color: employees.color,
        commissionRate: employees.commissionRate,
        totalAmount: sql<string>`COALESCE(SUM(${employeeCommissions.amount}), 0)`,
        commissionCount: sql<number>`COUNT(${employeeCommissions.id})::int`,
        avgPercentage:
          sql<string>`COALESCE(ROUND(AVG(${employeeCommissions.percentage}), 2), 0)`,
      })
      .from(employeeCommissions)
      .leftJoin(employees, eq(employeeCommissions.employeeId, employees.id))
      .groupBy(
        employeeCommissions.employeeId,
        employees.firstName,
        employees.lastName,
        employees.color,
        employees.commissionRate
      )
      .orderBy(
        sql`COALESCE(SUM(${employeeCommissions.amount}), 0) DESC`
      );

    const employeeTotals =
      conditions.length > 0
        ? await employeeTotalsQuery.where(and(...conditions))
        : await employeeTotalsQuery;

    // Calculate grand totals
    const grandTotal = commissions.reduce(
      (sum, c) => sum + parseFloat(c.amount),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        commissions,
        employeeTotals,
        summary: {
          totalCommissions: grandTotal,
          commissionCount: commissions.length,
          employeeCount: employeeTotals.length,
        },
      },
    });
  } catch (error) {
    console.error("[Finance Commissions API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch commissions" },
      { status: 500 }
    );
  }
}
