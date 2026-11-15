import { NextResponse } from "next/server";
import { eq, and, not, or, lte, gte } from "drizzle-orm";
import { validateBody, updateAppointmentSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// `db` pozostaje dla efektow ubocznych anulacji (forfeit zadatku, notyfikacja,
// nazwa salonu do waiting-list) — to NIE jest brama zasobu [id], ktora pilnuje
// test izolacji. Pelna migracja na repo + kontekst RLS tych zapisow = R2.
// Pod RLS (rola myhelper_app) te zapytania wymagaja wlasnego kontekstu salonu;
// sciezka pozytywna DELETE z zadatkiem nie jest pokryta testem R1 (zob. raport).
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { processAutomaticRefund, type RefundResult } from "@/lib/refund";
import {
  buildSalonCancellationSms,
  cancelAppointmentInTx,
  expireCheckoutSessions,
} from "@/lib/salon-cancellation";
import { getSalonContext, type SalonContext } from "@/lib/salon-context";
import { assertSalonRefs } from "@/lib/salon-refs";
import { appointments, clients, employees, services, notifications, salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";
import { notifyWaitingList } from "@/lib/waiting-list";

// Faza 3 (role): employee widzi/modyfikuje wyłącznie WŁASNE wizyty.
// Cudza wizyta = 404 (nie 403 — nie zdradzamy istnienia zasobu).
function isForeignForEmployee(
  ctx: SalonContext,
  appointmentEmployeeId: string | null
): boolean {
  return (
    ctx.role === "employee" &&
    (!ctx.employeeId || appointmentEmployeeId !== ctx.employeeId)
  );
}

// GET /api/appointments/[id] - Get a single appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    const salonId = ctx.salonId;

    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid appointment ID format" },
        { status: 400 }
      );
    }

    // Join — przez raw(tx) z jawnym eq(salonId) (defense in depth: filtr
    // aplikacyjny widoczny, plus kontekst RLS ustawiony przez forSalon).
    const result = await forSalon(salonId).raw((tx) =>
      tx
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
        .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
        .limit(1)
    );

    const row = result[0];
    if (!row || isForeignForEmployee(ctx, row.appointment.employeeId)) {
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

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    const salonId = ctx.salonId;

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

    // P1 (Ryan): pola zadatku zmienia tylko wlasciciel (reczne rozliczenie).
    // Normalnie depositPaid ustawia potwierdzenie platnosci (webhook Stripe ->
    // confirmDepositPayment), a kwote liczy /api/deposits/create-session.
    // Zaden ekran panelu nie wysyla tych pol w PUT. Pracownik/recepcja,
    // ktorzy "oplacali" zadatek recznie, wlaczali tez sciezke zwrotu przy
    // anulacji (DELETE) — dlatego 403, nie ciche pominiecie.
    if ((depositAmount !== undefined || depositPaid !== undefined) && ctx.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Tylko wlasciciel salonu moze zmieniac zadatek" },
        { status: 403 }
      );
    }

    // Check if appointment exists in the caller's salon — cudza/nieistniejaca
    // wizyta = 404 (scoped findOne, kontekst RLS ustawiony).
    const existing = await forSalon(salonId).findOne(appointments, id);

    if (!existing || isForeignForEmployee(ctx, existing.employeeId)) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // P1 (Ryan): klient, pracownik i usluga z body musza nalezec do salonu
    // z sesji — inaczej wizyta wskazywalaby cudzego klienta (dane w GET) lub
    // blokowala kalendarz pracownika innego salonu. null = wyczyszczenie pola.
    const refsError = await assertSalonRefs(salonId, { clientId, employeeId, serviceId });
    if (refsError) return refsError;

    // If times or employee changed, check for conflicts
    const newStartTime = startTime ? new Date(startTime) : existing.startTime;
    const newEndTime = endTime ? new Date(endTime) : existing.endTime;
    const newEmployeeId = employeeId || existing.employeeId;

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

    // Sprawdzenie kolizji + update w JEDNYM kontekscie RLS (raw(tx)); jawny
    // eq(salonId) zachowany jako filtr aplikacyjny (defense in depth).
    const conflict = await forSalon(salonId).raw(async (tx) => {
      const overlapping = await tx.select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
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
        return { conflicting: overlapping[0], updated: null as typeof appointments.$inferSelect | null };
      }

      logger.info(`[Appointments API] Updating appointment ${id}`, { updateData });

      const [updatedAppointment] = await tx
        .update(appointments)
        .set(updateData)
        .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
        .returning();

      return { conflicting: null, updated: updatedAppointment };
    });

    if (conflict.conflicting) {
      return NextResponse.json(
        { success: false, error: "Termin koliduje z istniejaca wizyta. Wybierz inna godzine", conflictingAppointment: conflict.conflicting },
        { status: 409 }
      );
    }

    const updatedAppointment = conflict.updated;

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

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    const salonId = ctx.salonId;

    const { id } = await params;
    const url = new URL(request.url);
    const notifyClient = url.searchParams.get("notifyClient") === "true";

    // Fetch the appointment with client info, scoped to the caller's salon
    // (join przez raw(tx) z jawnym eq(salonId) — cudza wizyta = pusty wynik = 404).
    const result = await forSalon(salonId).raw((tx) =>
      tx
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
        .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
        .limit(1)
    );

    const row = result[0];
    if (!row || isForeignForEmployee(ctx, row.appointment.employeeId)) {
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

    // Calculate time difference (informacyjnie — salon zwraca zadatek zawsze, RF1)
    const now = new Date();
    const startTime = new Date(appointment.startTime);
    const hoursUntilAppointment = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isMoreThan24h = hoursUntilAppointment > 24;

    // refund-fix RF1 + #70 pkt 1: płatność pending → failed i wizyta →
    // cancelled w JEDNEJ transakcji (kontekst RLS salonu); decyzja o zwrocie
    // na stanie wizyty po blokadzie (`src/lib/salon-cancellation.ts`).
    const txResult = await forSalon(salonId).raw((tx) => cancelAppointmentInTx(tx, salonId, id));
    if ("notFound" in txResult) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }
    if ("alreadyCancelled" in txResult) {
      return NextResponse.json(
        { success: false, error: "Wizyta jest juz anulowana" },
        { status: 400 }
      );
    }
    const { cancelled: cancelledAppointment, depositPaid, variant, failedPayments } = txResult;
    const depositAmount = appointment.depositAmount ? parseFloat(appointment.depositAmount) : 0;
    const hasDeposit = depositAmount > 0;

    // #70 pkt 1: otwarta sesja Checkout nie przyjmie już wpłaty (błąd = warn).
    await expireCheckoutSessions(id, failedPayments);

    // RF1: odwołanie przez salon = pełny zwrot, niezależnie od reguły 24 h.
    let refundResult: RefundResult | null = null;
    if (hasDeposit && depositPaid) {
      refundResult = await processAutomaticRefund(id, "Odwolanie wizyty przez salon - pelny zwrot zadatku");
      if (!refundResult.success) {
        logger.error("[Appointments API] Deposit refund failed after salon cancellation — manual refund", {
          appointmentId: id,
          salonId,
          refundMessage: refundResult.message,
        });
      }
    }
    const refundFailed = refundResult?.success === false;

    logger.info("[Appointments API] Cancelled appointment by salon", {
      appointmentId: id,
      hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
      hasDeposit,
      depositPaid,
      variant,
      refunded: refundResult?.refunded ?? false,
      refundFailed,
      expiredSessions: failedPayments.length,
      notifyClient,
    });

    const [salon] = await db
      .select({ name: salons.name, phone: salons.phone })
      .from(salons)
      .where(eq(salons.id, appointment.salonId))
      .limit(1);
    const salonName = salon?.name || "Salon";
    const serviceName = row.service?.name || "Wizyta";

    // RF2: JEDEN SMS (odwołanie + ewentualny zwrot), bez linku do rezerwacji.
    const shouldNotify = !!row.client && (notifyClient || refundResult?.refunded === true);
    let clientNotified = false;
    if (shouldNotify && row.client) {
      try {
        await db.insert(notifications).values({
          salonId: appointment.salonId,
          clientId: row.client.id,
          type: "sms",
          message: buildSalonCancellationSms({
            salonName,
            salonPhone: salon?.phone ?? null,
            serviceName,
            startTime,
            variant,
            depositAmount,
          }),
          status: "pending",
        });
        clientNotified = true;
      } catch (notifError) {
        logger.error("[Appointments API] Failed to create notification", { error: notifError, appointmentId: id });
        // Don't fail the cancellation if notification creation fails
      }
    }

    // Notify waiting list entries about the freed slot
    try {
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
        hasDeposit,
        depositPaid,
        depositAmount,
        depositRefunded: refundResult?.refunded === true,
        // RF1: salon nigdy nie zatrzymuje zadatku (pole zostaje dla zgodności UI).
        depositForfeited: false,
        depositVariant: variant,
        refundFailed,
        clientNotified,
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
