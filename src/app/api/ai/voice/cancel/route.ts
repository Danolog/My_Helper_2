import { NextResponse } from "next/server";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  aiConversations,
  salons,
  notifications,
  depositPayments,
} from "@/lib/schema";
import { eq, and, gte, not } from "drizzle-orm";
import { sendSms } from "@/lib/sms";
import { processAutomaticRefund, createRefundNotification } from "@/lib/refund";
import { notifyWaitingList } from "@/lib/waiting-list";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
interface CancelRequestBody {
  appointmentId?: string; // Direct appointment ID if known
  callerPhone: string; // Phone to look up client
  callerName?: string;
  notes?: string;
}

/**
 * POST /api/ai/voice/cancel
 *
 * Handles the voice AI cancellation flow:
 * 1. Find the client's upcoming appointment (by phone or appointment ID).
 * 2. Check deposit policy (24h rule).
 * 3. Cancel the appointment in the database.
 * 4. Handle deposit (refund if >24h, forfeit if <24h).
 * 5. Send SMS confirmation.
 * 6. Log the conversation.
 */
export async function POST(req: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  // --- Authentication & salon resolution ---
  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // --- Pro plan gate ---
  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  // --- Parse request body ---
  let body: CancelRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.callerPhone || typeof body.callerPhone !== "string") {
    return NextResponse.json({ error: "callerPhone is required" }, { status: 400 });
  }

  try {
    // ------------------------------------------------------------------
    // Step A: Find the client's upcoming appointment
    // ------------------------------------------------------------------
    let appointmentRow: {
      id: string;
      salonId: string;
      clientId: string | null;
      employeeId: string;
      serviceId: string | null;
      startTime: Date;
      endTime: Date;
      status: string;
      notes: string | null;
      depositAmount: string | null;
      depositPaid: boolean | null;
    } | undefined;

    let clientRecord: { id: string; firstName: string; lastName: string; phone: string | null } | undefined;
    let employeeRecord: { id: string; firstName: string; lastName: string } | undefined;
    let serviceRecord: { id: string; name: string; basePrice: string; baseDuration: number } | undefined;

    if (body.appointmentId) {
      // Direct lookup by appointment ID
      const rows = await db
        .select({
          appointment: appointments,
          client: clients,
          employee: employees,
          service: services,
        })
        .from(appointments)
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.id, body.appointmentId),
            eq(appointments.salonId, salonId),
            not(eq(appointments.status, "cancelled")),
            not(eq(appointments.status, "completed"))
          )
        )
        .limit(1);

      if (rows.length > 0) {
        const row = rows[0]!;
        appointmentRow = row.appointment;
        if (row.client) clientRecord = row.client;
        if (row.employee) employeeRecord = row.employee;
        if (row.service) serviceRecord = row.service;
      }
    } else {
      // Look up client by phone first
      const clientRows = await db
        .select({
          id: clients.id,
          firstName: clients.firstName,
          lastName: clients.lastName,
          phone: clients.phone,
        })
        .from(clients)
        .where(
          and(
            eq(clients.salonId, salonId),
            eq(clients.phone, body.callerPhone)
          )
        )
        .limit(1);

      if (clientRows.length === 0) {
        return NextResponse.json(
          {
            error: "Nie znaleziono klienta z tym numerem telefonu.",
            code: "CLIENT_NOT_FOUND",
          },
          { status: 404 }
        );
      }

      clientRecord = clientRows[0]!;

      // Find their next upcoming appointment
      const now = new Date();
      const apptRows = await db
        .select({
          appointment: appointments,
          employee: employees,
          service: services,
        })
        .from(appointments)
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.clientId, clientRecord.id),
            eq(appointments.salonId, salonId),
            not(eq(appointments.status, "cancelled")),
            not(eq(appointments.status, "completed")),
            gte(appointments.startTime, now)
          )
        )
        .orderBy(appointments.startTime)
        .limit(1);

      if (apptRows.length === 0) {
        return NextResponse.json(
          {
            error: "Nie znaleziono nadchodzacej wizyty dla tego klienta.",
            code: "NO_UPCOMING_APPOINTMENT",
          },
          { status: 404 }
        );
      }

      const row = apptRows[0]!;
      appointmentRow = row.appointment;
      if (row.employee) employeeRecord = row.employee;
      if (row.service) serviceRecord = row.service;
    }

    if (!appointmentRow) {
      return NextResponse.json(
        { error: "Nie znaleziono wizyty." },
        { status: 404 }
      );
    }

    // ------------------------------------------------------------------
    // Step B: Calculate cancellation policy (deposit handling)
    // ------------------------------------------------------------------
    const now = new Date();
    const startTime = new Date(appointmentRow.startTime);
    const hoursUntilAppointment = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isMoreThan24h = hoursUntilAppointment > 24;

    const hasDeposit = appointmentRow.depositAmount && parseFloat(appointmentRow.depositAmount) > 0;
    const depositPaid = appointmentRow.depositPaid;
    let depositRefunded = false;
    let depositForfeited = false;

    const depositAmount = hasDeposit ? parseFloat(appointmentRow.depositAmount!) : 0;

    let depositPolicy = "none";
    if (hasDeposit && depositPaid) {
      if (isMoreThan24h) {
        depositPolicy = "refund";
        depositRefunded = true;
      } else {
        depositPolicy = "forfeit";
        depositForfeited = true;
      }
    }

    // ------------------------------------------------------------------
    // Step C: Cancel the appointment
    // ------------------------------------------------------------------
    const [cancelledAppointment] = await db
      .update(appointments)
      .set({ status: "cancelled" })
      .where(eq(appointments.id, appointmentRow.id))
      .returning();

    logger.info(`[Voice AI Cancel] Cancelled appointment ${appointmentRow.id}`, {
      hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
      isMoreThan24h,
      hasDeposit,
      depositPaid,
      depositRefunded,
      depositForfeited,
    });

    // ------------------------------------------------------------------
    // Step D: Process deposit refund or forfeiture
    // ------------------------------------------------------------------
    let refundResult = null;
    if (depositRefunded) {
      refundResult = await processAutomaticRefund(
        appointmentRow.id,
        "Anulacja wizyty przez asystenta glosowego AI - wiecej niz 24h przed terminem"
      );
      logger.info(`[Voice AI Cancel] Refund result for appointment ${appointmentRow.id}`, { refundResult: refundResult as unknown as Record<string, unknown> });

      // Create refund notification for client
      if (refundResult.refunded && clientRecord) {
        const clientName = `${clientRecord.firstName} ${clientRecord.lastName}`;
        const serviceName = serviceRecord?.name || "Wizyta";
        await createRefundNotification(
          appointmentRow.salonId,
          clientRecord.id,
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
            refundReason: "Anulacja wizyty przez AI mniej niz 24h przed terminem - zadatek zatrzymany przez salon",
          })
          .where(eq(depositPayments.appointmentId, appointmentRow.id));
        logger.info(`[Voice AI Cancel] Deposit marked as forfeited for appointment ${appointmentRow.id}`);
      } catch (forfeitError) {
        logger.error("[Voice AI Cancel] Failed to mark deposit as forfeited", { error: forfeitError });
      }
    }

    // ------------------------------------------------------------------
    // Step E: Create cancellation notification
    // ------------------------------------------------------------------
    if (clientRecord) {
      const clientName = `${clientRecord.firstName} ${clientRecord.lastName}`;
      const serviceName = serviceRecord?.name || "Wizyta";
      const formattedDate = startTime.toLocaleDateString("pl-PL", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      let notificationMessage = `Szanowny/a ${clientName}, Twoja wizyta "${serviceName}" zaplanowana na ${formattedDate} zostala anulowana przez asystenta glosowego.`;

      if (depositRefunded && refundResult?.refunded) {
        notificationMessage += ` Zadatek w kwocie ${depositAmount.toFixed(2)} PLN zostanie zwrocony.`;
      } else if (depositForfeited) {
        notificationMessage += ` Zadatek w kwocie ${depositAmount.toFixed(2)} PLN nie podlega zwrotowi (anulacja mniej niz 24h przed wizyta).`;
      }

      try {
        await db.insert(notifications).values({
          salonId: appointmentRow.salonId,
          clientId: clientRecord.id,
          type: "sms",
          message: notificationMessage,
          status: "pending",
        });
      } catch (notifError) {
        logger.error("[Voice AI Cancel] Failed to create notification", { error: notifError });
      }
    }

    // ------------------------------------------------------------------
    // Step F: Notify waiting list about the freed slot
    // ------------------------------------------------------------------
    try {
      const [salon] = await db
        .select()
        .from(salons)
        .where(eq(salons.id, appointmentRow.salonId))
        .limit(1);

      const salonName = salon?.name || "Salon";
      const serviceName = serviceRecord?.name || "Wizyta";
      const employeeName = employeeRecord
        ? `${employeeRecord.firstName} ${employeeRecord.lastName}`
        : "Pracownik";

      await notifyWaitingList({
        salonId: appointmentRow.salonId,
        serviceId: appointmentRow.serviceId,
        employeeId: appointmentRow.employeeId,
        startTime,
        endTime: new Date(appointmentRow.endTime),
        serviceName,
        employeeName,
        salonName,
      });
    } catch (waitingListError) {
      logger.error("[Voice AI Cancel] Failed to notify waiting list", { error: waitingListError });
    }

    // ------------------------------------------------------------------
    // Step G: Send SMS confirmation
    // ------------------------------------------------------------------
    const salonRows = await db
      .select({ name: salons.name })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const salonName = salonRows[0]?.name || "Nasz salon";
    const employeeName = employeeRecord
      ? `${employeeRecord.firstName} ${employeeRecord.lastName}`
      : "pracownik";

    const dateStr = startTime.toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
    });
    const timeStr = startTime.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });

    let smsMessage = `Wizyta anulowana: ${serviceRecord?.name || "wizyta"} u ${employeeName} dnia ${dateStr} o ${timeStr} w ${salonName} zostala odwolana.`;
    if (depositRefunded) {
      smsMessage += ` Zadatek ${depositAmount.toFixed(2)} PLN zostanie zwrocony.`;
    } else if (depositForfeited) {
      smsMessage += ` Zadatek ${depositAmount.toFixed(2)} PLN nie podlega zwrotowi (anulacja mniej niz 24h przed wizyta).`;
    }

    let smsSent = false;
    try {
      const smsResult = await sendSms({
        to: body.callerPhone,
        message: smsMessage,
        salonId: salonId,
        clientId: clientRecord?.id,
      });
      smsSent = smsResult.success;
    } catch (smsError) {
      logger.error("[Voice AI Cancel] SMS send failed", { error: smsError });
    }

    // ------------------------------------------------------------------
    // Step H: Log the conversation
    // ------------------------------------------------------------------
    const [conversation] = await db
      .insert(aiConversations)
      .values({
        salonId: salonId,
        clientId: clientRecord?.id || null,
        channel: "voice",
        transcript: JSON.stringify({
          type: "cancellation_completed",
          callerPhone: body.callerPhone,
          callerName: body.callerName || null,
          appointmentId: appointmentRow.id,
          serviceName: serviceRecord?.name || null,
          employeeName,
          date: startTime.toISOString().split("T")[0],
          time: timeStr,
          depositPolicy,
          depositAmount,
          depositRefunded,
          depositForfeited,
          hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
          smsSent,
          timestamp: new Date().toISOString(),
        }),
      })
      .returning();

    // ------------------------------------------------------------------
    // Return the cancellation result
    // ------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      appointment: cancelledAppointment,
      details: {
        appointmentId: appointmentRow.id,
        serviceName: serviceRecord?.name || "Wizyta",
        employeeName,
        date: startTime.toISOString().split("T")[0],
        time: timeStr,
        clientName: clientRecord ? `${clientRecord.firstName} ${clientRecord.lastName}` : null,
      },
      depositInfo: {
        hasDeposit: !!hasDeposit,
        depositPaid: !!depositPaid,
        depositAmount,
        depositPolicy, // "none" | "refund" | "forfeit"
        depositRefunded,
        depositForfeited,
        hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
        isMoreThan24h,
        refund: refundResult ? {
          processed: refundResult.refunded,
          refundId: refundResult.refundId,
          amount: refundResult.amount,
          message: refundResult.message,
        } : null,
      },
      smsConfirmation: {
        sent: smsSent,
        phone: body.callerPhone,
      },
      conversationId: conversation?.id || null,
    });
  } catch (error) {
    logger.error("[Voice AI Cancel] Error", { error: error });
    return NextResponse.json(
      { error: "Blad przetwarzania anulacji wizyty" },
      { status: 500 }
    );
  }
}
