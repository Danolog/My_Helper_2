import { NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { isValidUuid } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { refundAppointmentDeposits, selectSucceededDepositsInTx } from "@/lib/refund";
import { appointments } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { findClientAppointmentForUser, type ClientAppointmentForCancel } from "@/lib/server/system";
import { notifyWaitingList } from "@/lib/waiting-list";

// #193 (ADR-002, wariant U): wizyta klienta przez odczyt systemowy
// `findClientAppointmentForUser` (tożsamość z sesji, warunek booked_by_user_id),
// a odczyt płatności i zapis anulowania przez forSalon(salon z wyniku odczytu).
// Salon nigdy nie pochodzi z żądania. Skutki uboczne (zwrot, zatrzymanie
// zadatku, lista oczekujących) dopiero po zapisie, który zwrócił wiersz.

/** Stany, z których klient nie anuluje wizyty (sprawdzane też w samym zapisie). */
const FINAL_STATUSES = ["cancelled", "completed"];

const NOT_FOUND = { success: false, error: "Appointment not found" } as const;

/**
 * Wpłacony zadatek bez płatności `succeeded` w MyHelper (np. BLIK na telefon
 * salonu oznaczony ręcznie): aplikacja nie ma czego zwrócić ani zatrzymać,
 * więc o zwrocie decyduje salon poza aplikacją. Klient nie może dostać
 * obietnicy przelewu, którego nikt nie wykona. Odczyt w kontekście salonu
 * wizyty — bez kontekstu rola aplikacji widziałaby 0 płatności i każdy zadatek
 * wyglądałby na rozliczany przez salon.
 */
async function isDepositSettledBySalon(found: ClientAppointmentForCancel): Promise<boolean> {
  const payments = await forSalon(found.salonId).raw((tx) =>
    selectSucceededDepositsInTx(tx, found.salonId, found.appointmentId)
  );
  return payments.length === 0;
}

// GET /api/client/appointments/[id]/cancel - Get cancellation policy info for client
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
        { success: false, error: "Nieprawidłowy ID" },
        { status: 400 }
      );
    }

    // Wizyta zarezerwowana przez to konto; cudza i nieistniejąca = 404 bez rozróżnienia.
    const appointment = await findClientAppointmentForUser(userId, id);
    if (!appointment) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

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

    let depositAction: "refund" | "forfeit" | "salon" | "none" = "none";
    let settledBySalon = false;
    if (hasDeposit && depositPaid) {
      settledBySalon = await isDepositSettledBySalon(appointment);
      if (settledBySalon) {
        depositAction = "salon";
      } else {
        depositAction = isMoreThan24h ? "refund" : "forfeit";
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        appointmentId: appointment.appointmentId,
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
          settledBySalon,
        },
        employee: appointment.employeeName !== null ? { name: appointment.employeeName } : null,
        service:
          appointment.serviceName !== null
            ? { name: appointment.serviceName, price: appointment.servicePrice }
            : null,
        salon:
          appointment.salonName !== null
            ? { name: appointment.salonName, phone: appointment.salonPhone }
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
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;
    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy ID" },
        { status: 400 }
      );
    }

    // Wizyta zarezerwowana przez to konto; cudza i nieistniejąca = 404 bez rozróżnienia.
    const appointment = await findClientAppointmentForUser(userId, id);
    if (!appointment) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

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
    let depositSettledBySalon = false;

    // Sprawdzane przed zmianą statusu: błąd odczytu płatności kończy się 500
    // bez anulowania, a nie anulowaniem z błędną informacją o zadatku.
    if (hasDeposit && depositPaid) {
      depositSettledBySalon = await isDepositSettledBySalon(appointment);
    }

    if (hasDeposit && depositPaid && !depositSettledBySalon) {
      if (isMoreThan24h) {
        depositRefunded = true;
      } else {
        depositForfeited = true;
      }
    }

    // Zapis w salonie wizyty z ponowionymi warunkami: id, salon, tożsamość
    // z sesji i stan. Wizyta, która w międzyczasie zmieniła stan (np. równoległe
    // anulowanie) albo nie należy już do tego konta, daje 0 wierszy.
    const salonId = appointment.salonId;
    const [cancelledAppointment] = await forSalon(salonId).raw((tx) =>
      tx
        .update(appointments)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(appointments.id, appointment.appointmentId),
            eq(appointments.salonId, salonId),
            eq(appointments.bookedByUserId, userId),
            notInArray(appointments.status, FINAL_STATUSES)
          )
        )
        .returning({
          id: appointments.id,
          status: appointments.status,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
        })
    );

    // 0 wierszy: jak dla wizyty nieznalezionej — bez zwrotu, zatrzymania
    // zadatku i powiadomienia listy oczekujących.
    if (!cancelledAppointment) {
      logger.info("[Client Cancel API] Cancel write matched no row", { appointmentId: id });
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    logger.info(`[Client Cancel API] Client ${userId} cancelled appointment ${id}`, {
      hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
      isMoreThan24h,
      hasDeposit,
      depositPaid,
      depositRefunded,
      depositForfeited,
      depositSettledBySalon,
    });

    // Process automatic refund if eligible (24h+ before appointment, deposit paid online — a succeeded payment in MyHelper)
    let refundResult = null;
    if (depositRefunded) {
      refundResult = await refundAppointmentDeposits(
        id,
        "Anulacja wizyty przez klienta - wiecej niz 24h przed terminem"
      );
      logger.info(`[Client Cancel API] Refund result for appointment ${id}`, { refundResult: refundResult as unknown as Record<string, unknown> });
    }

    // Mark deposit as forfeited if late cancellation (<24h) of a deposit paid online (succeeded payment in MyHelper)
    if (depositForfeited) {
      // Zatrzymana tylko najstarsza płatność `succeeded`; kolejne (np. druga
      // sesja Checkout) wracają do klienta (#98).
      try {
        const forfeitResult = await refundAppointmentDeposits(
          id,
          "Dodatkowa wplata zadatku - zwrot przy anulacji ponizej 24h",
          { forfeitReason: "Anulacja wizyty przez klienta mniej niz 24h przed terminem - zadatek zatrzymany przez salon" }
        );
        logger.info(`[Client Cancel API] Deposit forfeited for appointment ${id}`, {
          forfeitedPaymentId: forfeitResult.forfeitedPaymentId ?? null,
          extraRefunds: forfeitResult.results.length,
        });
      } catch (forfeitError) {
        logger.error("[Client Cancel API] Failed to mark deposit as forfeited", {
          appointmentId: id,
          errorName: forfeitError instanceof Error ? forfeitError.name : typeof forfeitError,
        });
      }
    }

    // Notify waiting list entries about the freed slot (salon z odczytu wizyty, nie z żądania)
    try {
      const waitingListResult = await notifyWaitingList({
        salonId,
        serviceId: appointment.serviceId,
        employeeId: appointment.employeeId,
        startTime,
        endTime: new Date(appointment.endTime),
        serviceName: appointment.serviceName || "Wizyta",
        employeeName: appointment.employeeName || "Pracownik",
        salonName: appointment.salonName || "Salon",
      });

      // Tylko liczniki — wynik nie może zawierać danych klientów z listy oczekujących.
      const { notified, smsCount, pushCount, errors } = waitingListResult;
      logger.info(`[Client Cancel API] Waiting list notification result`, { notified, smsCount, pushCount, errors });
    } catch (waitingListError) {
      logger.error("[Client Cancel API] Failed to notify waiting list", { error: waitingListError });
      // Don't fail the cancellation if waiting list notification fails
    }

    return NextResponse.json({
      success: true,
      data: {
        id: cancelledAppointment.id,
        status: cancelledAppointment.status,
        startTime: cancelledAppointment.startTime,
        endTime: cancelledAppointment.endTime,
      },
      message: "Wizyta zostala anulowana",
      cancellationDetails: {
        hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
        isMoreThan24h,
        hasDeposit: !!hasDeposit,
        depositPaid: !!depositPaid,
        depositAmount: appointment.depositAmount ? parseFloat(appointment.depositAmount) : 0,
        depositRefunded,
        depositForfeited,
        depositSettledBySalon,
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
