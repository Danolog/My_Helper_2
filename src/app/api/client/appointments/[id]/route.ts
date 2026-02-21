import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appointments, employees, services, salons, treatmentHistory, depositPayments, serviceVariants } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isValidUuid } from "@/lib/validations";

// GET /api/client/appointments/[id] - Get appointment detail for the authenticated client user
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid appointment ID format" },
        { status: 400 }
      );
    }

    // Fetch appointment with joins, ensuring it belongs to this user
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
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.bookedByUserId, userId)
        )
      )
      .limit(1);

    const row = result[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Fetch treatment history if appointment is completed
    let treatment = null;
    if (row.appointment.status === "completed") {
      const treatmentResult = await db
        .select()
        .from(treatmentHistory)
        .where(eq(treatmentHistory.appointmentId, id))
        .limit(1);
      treatment = treatmentResult[0] || null;
    }

    // Fetch deposit payment info
    let depositPayment = null;
    if (row.appointment.depositAmount && parseFloat(row.appointment.depositAmount) > 0) {
      const depositResult = await db
        .select()
        .from(depositPayments)
        .where(eq(depositPayments.appointmentId, id))
        .limit(1);
      depositPayment = depositResult[0] || null;
    }

    // Fetch variant info if applicable
    let variant = null;
    if (row.appointment.variantId) {
      const variantResult = await db
        .select()
        .from(serviceVariants)
        .where(eq(serviceVariants.id, row.appointment.variantId))
        .limit(1);
      variant = variantResult[0] || null;
    }

    const formattedAppointment = {
      id: row.appointment.id,
      salonId: row.appointment.salonId,
      salonName: row.salon?.name || "Nieznany salon",
      salonAddress: row.salon?.address || null,
      salonPhone: row.salon?.phone || null,
      salonEmail: row.salon?.email || null,
      employeeName: row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : "Nieznany",
      employeeColor: row.employee?.color || null,
      serviceName: row.service?.name || "Nieznana usluga",
      serviceDescription: row.service?.description || null,
      servicePrice: row.service?.basePrice || null,
      serviceDuration: row.service?.baseDuration || null,
      variantName: variant?.name || null,
      variantPriceModifier: variant?.priceModifier || null,
      variantDurationModifier: variant?.durationModifier || null,
      startTime: row.appointment.startTime,
      endTime: row.appointment.endTime,
      status: row.appointment.status,
      notes: row.appointment.notes,
      depositAmount: row.appointment.depositAmount,
      depositPaid: row.appointment.depositPaid,
      createdAt: row.appointment.createdAt,
      treatment,
      depositPayment: depositPayment
        ? {
            amount: depositPayment.amount,
            currency: depositPayment.currency,
            paymentMethod: depositPayment.paymentMethod,
            blikPhoneNumber: depositPayment.blikPhoneNumber || null,
            status: depositPayment.status,
            paidAt: depositPayment.paidAt,
          }
        : null,
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
    });
  } catch (error) {
    console.error("[Client Appointment Detail API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment details" },
      { status: 500 }
    );
  }
}
