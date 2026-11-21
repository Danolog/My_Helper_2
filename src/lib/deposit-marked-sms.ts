/**
 * SMS do klienta po ręcznym oznaczeniu zadatku jako wpłaconego.
 *
 * Wołany przez trasę oznaczania (/api/appointments/[id]/deposit) po zatwierdzeniu
 * transakcji i tylko przy zmianie stanu. Best-effort: nigdy nie rzuca, brak
 * telefonu albo błąd nie zmienia oznaczenia ani odpowiedzi.
 *
 * Odczyt w osobnej transakcji `forSalon`, bo błąd odczytu w transakcji
 * oznaczenia cofnąłby oznaczenie. Do logu trafia tylko id wizyty i powód
 * z zamkniętej listy albo tożsamość błędu (treść błędu może nieść numer).
 * Najwyżej jeden SMS na wizytę: drugi wpis dziennika `manual_mark`/`stripe_confirmation`
 * z `deposit_paid = true` → pominięcie `already_confirmed`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import { appointments, clients, depositStatusEvents, salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { sendDepositMarkedSms, smsFailureReason } from "@/lib/sms";

/** Powód pominięcia SMS (zamknięta lista do logu). */
export type DepositMarkedSmsSkipReason = "no_details" | "no_phone" | "not_paid" | "no_amount" | "already_confirmed";

/**
 * Źródła wpisów dziennika, po których klient już ma potwierdzenie wpłaty:
 * `manual_mark` (ta trasa wysyła po nim SMS) i `stripe_confirmation` (płatność
 * online). `owner_edit` nie wysyła SMS, więc się nie liczy.
 */
const CONFIRMING_SOURCES = ["manual_mark", "stripe_confirmation"] as const;

export async function notifyDepositMarkedPaid(input: {
  salonId: string;
  appointmentId: string;
}): Promise<void> {
  const skip = (reason: DepositMarkedSmsSkipReason): void => {
    logger.info("[AppointmentDeposit API] Deposit marked SMS skipped", {
      appointmentId: input.appointmentId,
      reason,
    });
  };

  try {
    // Klient tylko z tego salonu (jawne eq(clients.salonId)) niezależnie od RLS;
    // bez imion i e-maili — szablon ich nie używa.
    const { details, confirmations } = await forSalon(input.salonId).raw(async (tx) => {
      const rows = await tx
        .select({
          clientId: appointments.clientId,
          clientPhone: clients.phone,
          guestPhone: appointments.guestPhone,
          startTime: appointments.startTime,
          depositAmount: appointments.depositAmount,
          depositPaid: appointments.depositPaid,
          salonName: salons.name,
        })
        .from(appointments)
        .leftJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.salonId, input.salonId)))
        .innerJoin(salons, eq(appointments.salonId, salons.id))
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.salonId, input.salonId)))
        .limit(1);
      const confirmations = await tx
        .select({ id: depositStatusEvents.id })
        .from(depositStatusEvents)
        .where(
          and(
            eq(depositStatusEvents.appointmentId, input.appointmentId),
            eq(depositStatusEvents.salonId, input.salonId),
            eq(depositStatusEvents.depositPaid, true),
            inArray(depositStatusEvents.source, [...CONFIRMING_SOURCES])
          )
        )
        .limit(2);
      return { details: rows[0], confirmations: confirmations.length };
    });

    if (!details) return skip("no_details");
    // Równoległe „cofnij” po COMMIT oznaczenia: stan w bazie już nie „wpłacony”.
    if (details.depositPaid !== true) return skip("not_paid");
    // Wpis bieżącego oznaczenia jest już w dzienniku (odczyt po COMMIT), więc drugi wpis potwierdzający = klient ma już SMS albo potwierdzenie Stripe; najwyżej jeden SMS na wizytę.
    if (confirmations > 1) return skip("already_confirmed");

    const amount = Number(details.depositAmount);
    if (details.depositAmount === null || !Number.isFinite(amount) || amount <= 0) {
      return skip("no_amount");
    }

    // Klient z kartoteki ma pierwszeństwo przed polami gościa (reguła #377).
    const phone = details.clientPhone || details.guestPhone;
    if (!phone) return skip("no_phone");

    const result = await sendDepositMarkedSms({
      clientPhone: phone,
      amount,
      appointmentDate: details.startTime,
      salonName: details.salonName,
      salonId: input.salonId,
      ...(details.clientId ? { clientId: details.clientId } : {}),
    });
    // `?.` i ścisłe `=== false`: atrapa bez wyniku (`undefined`) nie jest
    // nieudaną wysyłką i nie może sięgać po stałe błędów.
    if (result?.success === false) {
      logger.warn("[AppointmentDeposit API] Deposit marked SMS not sent", {
        appointmentId: input.appointmentId,
        reason: smsFailureReason(result),
      });
    }
  } catch (error) {
    logger.warn("[AppointmentDeposit API] Deposit marked SMS failed", {
      appointmentId: input.appointmentId,
      ...toErrorIdentity(error),
    });
  }
}
