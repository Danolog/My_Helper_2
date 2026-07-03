import { NextResponse } from "next/server";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import {
  employeeCommissions,
  employees,
  appointments,
  services,
  clients,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// GET /api/finance/commissions - List commissions with employee totals
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Tenant isolation (ADR-001): commissions have no salonId column, so the
    // salon scope rides on the employees join (employeeId is NOT NULL).
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

    // Build conditions (salon scope always applied via the employees join)
    const conditions = [eq(employees.salonId, salonId)];
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

    // Both reads share one RLS-scoped transaction (forSalon.raw)
    const { commissions, employeeTotals } = await forSalon(salonId).raw(
      async (tx) => {
        // Get individual commission records with details
        const commissions = await tx
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
          .where(and(...conditions))
          .orderBy(desc(employeeCommissions.createdAt));

        // Calculate employee totals
        const employeeTotals = await tx
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
          .where(and(...conditions))
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

        return { commissions, employeeTotals };
      }
    );

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
