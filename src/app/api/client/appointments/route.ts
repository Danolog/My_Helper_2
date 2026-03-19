import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, employees, services, salons } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/client/appointments - List appointments for the authenticated client user
export async function GET() {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;
    logger.info(`[Client Appointments API] Fetching appointments for user: ${userId}`);

    const result = await db
      .select({
        appointment: appointments,
        employee: employees,
        service: services,
        salon: salons,
      })
      .from(appointments)
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(salons, eq(appointments.salonId, salons.id))
      .where(eq(appointments.bookedByUserId, userId))
      .orderBy(desc(appointments.startTime));

    const formattedAppointments = result.map((row) => ({
      id: row.appointment.id,
      salonId: row.appointment.salonId,
      salonName: row.salon?.name || "Nieznany salon",
      salonAddress: row.salon?.address || null,
      employeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : "Nieznany",
      employeeColor: row.employee?.color || null,
      serviceName: row.service?.name || "Nieznana usluga",
      servicePrice: row.service?.basePrice || null,
      serviceDuration: row.service?.baseDuration || null,
      startTime: row.appointment.startTime,
      endTime: row.appointment.endTime,
      status: row.appointment.status,
      notes: row.appointment.notes,
      depositAmount: row.appointment.depositAmount,
      depositPaid: row.appointment.depositPaid,
      createdAt: row.appointment.createdAt,
    }));

    logger.info(`[Client Appointments API] Found ${formattedAppointments.length} appointments for user ${userId}`);

    return NextResponse.json({
      success: true,
      data: formattedAppointments,
      count: formattedAppointments.length,
    });
  } catch (error) {
    logger.error("[Client Appointments API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch client appointments" },
      { status: 500 }
    );
  }
}
