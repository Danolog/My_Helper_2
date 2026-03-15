import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appointments, employees, services, salons, depositPayments } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isValidUuid } from "@/lib/api-validation";
import { processAutomaticRefund } from "@/lib/refund";
import { notifyWaitingList } from "@/lib/waiting-list";

import { logger } from "@/lib/logger";
// GET /api/client/appointments/[id]/cancel - Get cancellation policy info for client
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
        { success: false, error: "Nieprawidłowy ID" },
        { status: 400 }
      );
    }

    // Fetch appointment ensuring it belongs to this user
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

    const appointment = row.appointment;

    // Already cancelled?
    if (appointment.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Wizyta jest juz anulowana" },
        { status: 400 }
      );
    }

    // Already completed?
    if (appointment.status === "completed") {
      return NextResponse.json(
        { success: false, error: "Nie mozna anulowac zakonczonej wizyty" },
        { status: 400 }
      );
    }

    // Calculate time difference for cancellation policy
    const now = new Date();
    const startTime = new Date(appointment.startTime);
    const hoursUntilAppointment = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isMoreThan24h = hoursUntilAppointment > 24;
    const isPast = hoursUntilAppointment < 0;

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
        isPast,
        canCancel: !isPast,
        deposit: {
          amount: appointment.depositAmount ? parseFloat(appointment.depositAmount) : 0,
          paid: !!depositPaid,
          action: depositAction,
        },
        employee: row.employee
          ? { name: `${row.employee.firstName} ${row.employee.lastName}` }
          : null,
        service: row.service
          ? { name: row.service.name, price: row.service.basePrice }
          : null,
        salon: row.salon
          ? { name: row.salon.name }
          : null,
      },
    });
  } catch (error) {
    logger.error("[Client Cancel API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to get cancellation info" },
      { status: 500 }
    );
  }
}

// POST /api/client/appointments/[id]/cancel - Cancel an appointment as a client
export async function POST(
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
        { success: false, error: "Nieprawidłowy ID" },
        { status: 400 }
      );
    }

    // Fetch appointment ensuring it belongs to this user
    const result = await db
      .select({
        appointment: appointments,
        service: services,
        employee: employees,
        salon: salons,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
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

    const appointment = row.appointment;

    // Already cancelled?
    if (appointment.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Wizyta jest juz anulowana" },
        { status: 400 }
      );
    }

    // Already completed?
    if (appointment.status === "completed") {
      return NextResponse.json(
        { success: false, error: "Nie mozna anulowac zakonczonej wizyty" },
        { status: 400 }
      );
    }

    // Check if appointment is in the past
    const now = new Date();
    const startTime = new Date(appointment.startTime);
    const hoursUntilAppointment = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilAppointment < 0) {
      return NextResponse.json(
        { success: false, error: "Nie mozna anulowac wizyty, ktora juz sie rozpoczela" },
        { status: 400 }
      );
    }

    const isMoreThan24h = hoursUntilAppointment > 24;

    // Determine deposit handling
    const hasDeposit = appointment.depositAmount && parseFloat(appointment.depositAmount) > 0;
    const depositPaid = appointment.depositPaid;
    let depositRefunded = false;
    let depositForfeited = false;

    if (hasDeposit && depositPaid) {
      if (isMoreThan24h) {
        depositRefunded = true;
      } else {
        depositForfeited = true;
      }
    }

    // Cancel the appointment
    const [cancelledAppointment] = await db
      .update(appointments)
      .set({ status: "cancelled" })
      .where(eq(appointments.id, id))
      .returning();

    logger.info(`[Client Cancel API] Client ${userId} cancelled appointment ${id}`, {
      hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
      isMoreThan24h,
      hasDeposit,
      depositPaid,
      depositRefunded,
      depositForfeited,
    });

    // Process automatic refund if eligible (24h+ before appointment, deposit paid)
    let refundResult = null;
    if (depositRefunded) {
      refundResult = await processAutomaticRefund(
        id,
        "Anulacja wizyty przez klienta - wiecej niz 24h przed terminem"
      );
      logger.info(`[Client Cancel API] Refund result for appointment ${id}`, { refundResult: refundResult as unknown as Record<string, unknown> });
    }

    // Mark deposit as forfeited if late cancellation (<24h)
    if (depositForfeited) {
      try {
        await db
          .update(depositPayments)
          .set({
            status: "forfeited",
            refundReason: "Anulacja wizyty przez klienta mniej niz 24h przed terminem - zadatek zatrzymany przez salon",
          })
          .where(eq(depositPayments.appointmentId, id));
        logger.info(`[Client Cancel API] Deposit marked as forfeited for appointment ${id}`);
      } catch (forfeitError) {
        logger.error("[Client Cancel API] Failed to mark deposit as forfeited", { error: forfeitError });
      }
    }

    // Notify waiting list entries about the freed slot
    try {
      const salonName = row.salon?.name || "Salon";
      const serviceName = row.service?.name || "Wizyta";
      const employeeName = row.employee
        ? `${row.employee.firstName} ${row.employee.lastName}`
        : "Pracownik";

      const waitingListResult = await notifyWaitingList({
        salonId: appointment.salonId,
        serviceId: appointment.serviceId,
        employeeId: appointment.employeeId,
        startTime,
        endTime: new Date(appointment.endTime),
        serviceName,
        employeeName,
        salonName,
      });

      logger.info(`[Client Cancel API] Waiting list notification result`, { waitingListResult });
    } catch (waitingListError) {
      logger.error("[Client Cancel API] Failed to notify waiting list", { error: waitingListError });
      // Don't fail the cancellation if waiting list notification fails
    }

    return NextResponse.json({
      success: true,
      data: cancelledAppointment,
      message: "Wizyta zostala anulowana",
      cancellationDetails: {
        hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
        isMoreThan24h,
        hasDeposit: !!hasDeposit,
        depositPaid: !!depositPaid,
        depositAmount: appointment.depositAmount ? parseFloat(appointment.depositAmount) : 0,
        depositRefunded,
        depositForfeited,
        refund: refundResult ? {
          processed: refundResult.refunded,
          refundId: refundResult.refundId,
          amount: refundResult.amount,
          message: refundResult.message,
        } : null,
      },
    });
  } catch (error) {
    logger.error("[Client Cancel API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to cancel appointment" },
      { status: 500 }
    );
  }
}
