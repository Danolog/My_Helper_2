import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, clients, employees, services } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/appointments/[id]/cancel-info - Get cancellation policy details for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const result = await db.select({
      appointment: appointments,
      client: clients,
      employee: employees,
      service: services,
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(employees, eq(appointments.employeeId, employees.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(eq(appointments.id, id))
    .limit(1);

    const row = result[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    const appointment = row.appointment;

    // Already cancelled?
    if (appointment.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Wizyta jest juz anulowana" },
        { status: 400 }
      );
    }

    // Calculate time difference for cancellation policy
    const now = new Date();
    const startTime = new Date(appointment.startTime);
    const hoursUntilAppointment = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isMoreThan24h = hoursUntilAppointment > 24;

    // Determine deposit handling
    const hasDeposit = appointment.depositAmount && parseFloat(appointment.depositAmount) > 0;
    const depositPaid = appointment.depositPaid;

    let depositAction: "refund" | "forfeit" | "none" = "none";
    if (hasDeposit && depositPaid) {
      depositAction = isMoreThan24h ? "refund" : "forfeit";
    }

    return NextResponse.json({
      success: true,
      data: {
        appointmentId: appointment.id,
        status: appointment.status,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
        isMoreThan24h,
        isPast: hoursUntilAppointment < 0,
        deposit: {
          amount: appointment.depositAmount ? parseFloat(appointment.depositAmount) : 0,
          paid: !!depositPaid,
          action: depositAction,
        },
        client: row.client ? {
          id: row.client.id,
          name: `${row.client.firstName} ${row.client.lastName}`,
          phone: row.client.phone,
          email: row.client.email,
        } : null,
        employee: row.employee ? {
          id: row.employee.id,
          name: `${row.employee.firstName} ${row.employee.lastName}`,
        } : null,
        service: row.service ? {
          id: row.service.id,
          name: row.service.name,
          price: row.service.basePrice,
        } : null,
      },
    });
  } catch (error) {
    console.error("[Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get cancellation info" },
      { status: 500 }
    );
  }
}
