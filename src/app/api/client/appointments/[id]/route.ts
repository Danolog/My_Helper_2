import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// ADR-001: ścieżka user-scoped (nie salon-scoped) — świadomie surowe db
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appointments, employees, services, salons, depositPayments, serviceVariants } from "@/lib/schema";
import { isValidUuid } from "@/lib/validations";
// GET /api/client/appointments/[id] - Get appointment detail for the authenticated client user
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;
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

    // Fetch deposit payment info
    let depositPayment = null;
    if (row.appointment.depositAmount && parseFloat(row.appointment.depositAmount) > 0) {
      // Jawne pola (ADR-002 §2.5): bez identyfikatorów Stripe i powodu zwrotu.
      const depositResult = await db
        .select({
          amount: depositPayments.amount,
          currency: depositPayments.currency,
          paymentMethod: depositPayments.paymentMethod,
          blikPhoneNumber: depositPayments.blikPhoneNumber,
          status: depositPayments.status,
          paidAt: depositPayments.paidAt,
        })
        .from(depositPayments)
        .where(eq(depositPayments.appointmentId, id))
        .limit(1);
      depositPayment = depositResult[0] || null;
    }

    // Fetch variant info if applicable
    let variant = null;
    if (row.appointment.variantId) {
      const variantResult = await db
        .select({
          name: serviceVariants.name,
          priceModifier: serviceVariants.priceModifier,
          durationModifier: serviceVariants.durationModifier,
        })
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
      depositAmount: row.appointment.depositAmount,
      depositPaid: row.appointment.depositPaid,
      createdAt: row.appointment.createdAt,
      // appointments.notes i treatment_history (notes, materials_json, recipe,
      // techniques) to dane personelu — poza portalem klienta (ADR-002 §2.5).
      // Bez zapytania o treatment_history: nie czytamy danych, których nie zwracamy.
      treatment: null,
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
    logger.error("[Client Appointment Detail API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment details" },
      { status: 500 }
    );
  }
}
