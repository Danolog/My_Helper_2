import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, clients, employees, services, notifications, depositPayments, salons } from "@/lib/schema";
import { eq, and, not, or, lte, gte } from "drizzle-orm";
import { processAutomaticRefund, createRefundNotification } from "@/lib/refund";
import { notifyWaitingList } from "@/lib/waiting-list";
import { validateBody, updateAppointmentSchema } from "@/lib/api-validation";
import { isValidUuid } from "@/lib/validations";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
// GET /api/appointments/[id] - Get a single appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid appointment ID format" },
        { status: 400 }
      );
    }

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

    const formattedAppointment = {
      ...row.appointment,
      client: row.client,
      employee: row.employee,
      service: row.service,
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
    });
  } catch (error) {
    logger.error("[Appointments API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment" },
      { status: 500 }
    );
  }
}

// PUT /api/appointments/[id] - Update an appointment (reschedule)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid appointment ID format" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Server-side validation with Zod schema
    const validationError = validateBody(updateAppointmentSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { startTime, endTime, employeeId, clientId, serviceId, notes, status, depositAmount, depositPaid } = body;

    // Check if appointment exists (need times and employeeId for conflict checks)
    const [existing] = await db.select({
      id: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      employeeId: appointments.employeeId,
      status: appointments.status,
    })
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // If times or employee changed, check for conflicts
    const newStartTime = startTime ? new Date(startTime) : existing.startTime;
    const newEndTime = endTime ? new Date(endTime) : existing.endTime;
    const newEmployeeId = employeeId || existing.employeeId;

    // Check for overlapping appointments (excluding current one, only need id for existence check)
    const overlapping = await db.select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, newEmployeeId),
          not(eq(appointments.id, id)),
          not(eq(appointments.status, "cancelled")),
          or(
            and(
              lte(appointments.startTime, newStartTime),
              gte(appointments.endTime, newStartTime)
            ),
            and(
              lte(appointments.startTime, newEndTime),
              gte(appointments.endTime, newEndTime)
            ),
            and(
              gte(appointments.startTime, newStartTime),
              lte(appointments.endTime, newEndTime)
            )
          )
        )
      );

    if (overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: "Time slot conflicts with existing appointment", conflictingAppointment: overlapping[0] },
        { status: 409 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (startTime) updateData.startTime = newStartTime;
    if (endTime) updateData.endTime = newEndTime;
    if (employeeId) updateData.employeeId = employeeId;
    if (clientId !== undefined) updateData.clientId = clientId;
    if (serviceId !== undefined) updateData.serviceId = serviceId;
    if (notes !== undefined) updateData.notes = notes;
    if (status) updateData.status = status;
    if (depositAmount !== undefined) updateData.depositAmount = depositAmount;
    if (depositPaid !== undefined) updateData.depositPaid = depositPaid;

    logger.info(`[Appointments API] Updating appointment ${id}`, { updateData });

    const [updatedAppointment] = await db
      .update(appointments)
      .set(updateData)
      .where(eq(appointments.id, id))
      .returning();

    logger.info(`[Appointments API] Updated appointment ${id} successfully`);

    return NextResponse.json({
      success: true,
      data: updatedAppointment,
      message: "Appointment rescheduled successfully",
    });
  } catch (error) {
    logger.error("[Appointments API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to update appointment" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointments/[id] - Cancel an appointment with deposit rules
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const url = new URL(request.url);
    const notifyClient = url.searchParams.get("notifyClient") === "true";

    // Fetch the appointment with client info
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

    // Check if already cancelled
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
    let depositRefunded = false;
    let depositForfeited = false;

    if (hasDeposit && depositPaid) {
      if (isMoreThan24h) {
        // More than 24h before - eligible for refund
        depositRefunded = true;
      } else {
        // Less than 24h before - deposit is forfeited
        depositForfeited = true;
      }
    }

    // Soft delete by setting status to cancelled
    const [cancelledAppointment] = await db
      .update(appointments)
      .set({ status: "cancelled" })
      .where(eq(appointments.id, id))
      .returning();

    logger.info(`[Appointments API] Cancelled appointment ${id}`, {
      hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
      isMoreThan24h,
      hasDeposit,
      depositPaid,
      depositRefunded,
      depositForfeited,
      notifyClient,
    });

    // Process automatic refund if eligible (24h+ before appointment, deposit paid)
    let refundResult = null;
    if (depositRefunded) {
      refundResult = await processAutomaticRefund(
        id,
        "Anulacja wizyty przez personel - wiecej niz 24h przed terminem"
      );
      logger.info(`[Appointments API] Refund result for appointment ${id}`, { refundResult: refundResult as unknown as Record<string, unknown> });

      // Create refund notification for client
      if (refundResult.refunded && row.client) {
        const clientName = `${row.client.firstName} ${row.client.lastName}`;
        const serviceName = row.service?.name || "Wizyta";
        await createRefundNotification(
          appointment.salonId,
          row.client.id,
          refundResult.amount || 0,
          clientName,
          serviceName,
          startTime
        );
      }
    }

    // Mark deposit as forfeited if late cancellation (<24h)
    if (depositForfeited) {
      try {
        await db
          .update(depositPayments)
          .set({
            status: "forfeited",
            refundReason: "Anulacja wizyty mniej niz 24h przed terminem - zadatek zatrzymany przez salon",
          })
          .where(eq(depositPayments.appointmentId, id));
        logger.info(`[Appointments API] Deposit marked as forfeited for appointment ${id}`);
      } catch (forfeitError) {
        logger.error("[Appointments API] Failed to mark deposit as forfeited", { error: forfeitError });
        // Don't fail the cancellation if deposit status update fails
      }
    }

    // Create notification record if client exists and notification requested
    if (notifyClient && row.client) {
      const clientName = `${row.client.firstName} ${row.client.lastName}`;
      const serviceName = row.service?.name || "Wizyta";
      const formattedDate = startTime.toLocaleDateString("pl-PL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      let notificationMessage = `Szanowny/a ${clientName}, Twoja wizyta "${serviceName}" zaplanowana na ${formattedDate} zostala anulowana.`;

      if (depositRefunded && refundResult?.refunded) {
        notificationMessage += ` Zadatek w kwocie ${parseFloat(appointment.depositAmount!).toFixed(2)} PLN zostanie zwrocony.`;
      } else if (depositForfeited) {
        notificationMessage += ` Zadatek w kwocie ${parseFloat(appointment.depositAmount!).toFixed(2)} PLN nie podlega zwrotowi (anulacja mniej niz 24h przed wizyta).`;
      }

      try {
        await db.insert(notifications).values({
          salonId: appointment.salonId,
          clientId: row.client.id,
          type: "sms",
          message: notificationMessage,
          status: "pending",
        });
        logger.info(`[Appointments API] Created cancellation notification for client ${row.client.id}`);
      } catch (notifError) {
        logger.error("[Appointments API] Failed to create notification", { error: notifError });
        // Don't fail the cancellation if notification creation fails
      }
    }

    // Notify waiting list entries about the freed slot
    try {
      // Get salon name for notification (only need name)
      const [salon] = await db
        .select({ name: salons.name })
        .from(salons)
        .where(eq(salons.id, appointment.salonId))
        .limit(1);

      const salonName = salon?.name || "Salon";
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

      logger.info(`[Appointments API] Waiting list notification result`, { waitingListResult });
    } catch (waitingListError) {
      logger.error("[Appointments API] Failed to notify waiting list", { error: waitingListError });
      // Don't fail the cancellation if waiting list notification fails
    }

    return NextResponse.json({
      success: true,
      data: cancelledAppointment,
      message: "Appointment cancelled successfully",
      cancellationDetails: {
        hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
        isMoreThan24h,
        hasDeposit: !!hasDeposit,
        depositPaid: !!depositPaid,
        depositAmount: appointment.depositAmount ? parseFloat(appointment.depositAmount) : 0,
        depositRefunded,
        depositForfeited,
        clientNotified: notifyClient && !!row.client,
        refund: refundResult ? {
          processed: refundResult.refunded,
          refundId: refundResult.refundId,
          amount: refundResult.amount,
          message: refundResult.message,
        } : null,
      },
    });
  } catch (error) {
    logger.error("[Appointments API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to cancel appointment" },
      { status: 500 }
    );
  }
}
