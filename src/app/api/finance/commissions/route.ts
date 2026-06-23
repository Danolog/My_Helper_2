import { NextResponse } from "next/server";
import {
  employeeCommissions,
  employees,
  appointments,
  services,
  clients,
} from "@/lib/schema";
import { eq, and, gte, lte, sql, desc, type SQL } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { forSalon } from "@/lib/server/repository";

import { logger } from "@/lib/logger";
// GET /api/finance/commissions - List commissions with employee totals
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
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const employeeId = searchParams.get("employeeId");

    // Build conditions
    const conditions: SQL[] = [];
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

    // employee_commissions bez kolumny salon_id — izolacja przez RLS pośrednią
    // (EXISTS na employees.salon_id). Oba zapytania (rekordy + sumy) w jednym
    // kontekście forSalon, więc baza odcina prowizje pracowników cudzych salonów.
    const { commissions, employeeTotals } = await forSalon(salonId).raw(async (tx) => {
    // Get individual commission records with details
    const commissionsQuery = tx
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

    const commissionsResult =
      conditions.length > 0
        ? await commissionsQuery.where(and(...conditions))
        : await commissionsQuery;

    // Calculate employee totals
    const employeeTotalsQuery = tx
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

    const employeeTotalsResult =
      conditions.length > 0
        ? await employeeTotalsQuery.where(and(...conditions))
        : await employeeTotalsQuery;

      return { commissions: commissionsResult, employeeTotals: employeeTotalsResult };
    });

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
    logger.error("[Finance Commissions API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch commissions" },
      { status: 500 }
    );
  }
}
