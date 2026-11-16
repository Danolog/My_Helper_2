import crypto from "crypto";
import { eq, and, isNull, or, not } from "drizzle-orm";
import { appointmentConflictWhere, dbErrorCode, isAppointmentSlotTaken } from "@/lib/appointment-overlap";
import { db } from "@/lib/db";
import {
  checkBookingWithoutDeposit,
  DEPOSIT_CHECK_UNAVAILABLE_MESSAGE,
  DEPOSIT_REQUIRED_MESSAGE,
} from "@/lib/deposit-guard";
import { logger } from "@/lib/logger";
import { sendPushNotification } from "@/lib/push";
import {
  waitingList,
  clients,
  user,
  appointments,
  notifications,
} from "@/lib/schema";
import { sendSms } from "@/lib/sms";

interface NotifyWaitingListParams {
  salonId: string;
  serviceId: string | null;
  employeeId: string | null;
  startTime: Date;
  endTime: Date;
  serviceName: string;
  employeeName: string;
  salonName: string;
}

interface NotifyWaitingListResult {
  notified: number;
  smsCount: number;
  pushCount: number;
  errors: number;
}

/**
 * Notify waiting list entries when an appointment slot becomes available.
 *
 * Called when an appointment is cancelled. Finds matching waiting list entries
 * (same salon, optionally same service/employee/date) that have not been
 * notified or accepted/declined yet. For each match it sends an SMS and a push
 * notification with the freed slot details and updates `notifiedAt`.
 */
export async function notifyWaitingList(
  params: NotifyWaitingListParams
): Promise<NotifyWaitingListResult> {
  const result: NotifyWaitingListResult = {
    notified: 0,
    smsCount: 0,
    pushCount: 0,
    errors: 0,
  };

  try {
    // Build conditions for matching waiting list entries:
    // - Same salon (required)
    // - Not already notified (notifiedAt is null)
    // - Not already accepted or declined (accepted is null)
    // - Same service OR no service preference
    // - Same preferred employee OR no employee preference
    const serviceCondition = params.serviceId
      ? or(
          eq(waitingList.serviceId, params.serviceId),
          isNull(waitingList.serviceId)
        )
      : isNull(waitingList.serviceId);

    const employeeCondition = params.employeeId
      ? or(
          eq(waitingList.preferredEmployeeId, params.employeeId),
          isNull(waitingList.preferredEmployeeId)
        )
      : isNull(waitingList.preferredEmployeeId);

    const entries = await db
      .select({
        entry: waitingList,
        client: clients,
      })
      .from(waitingList)
      .innerJoin(clients, eq(waitingList.clientId, clients.id))
      .where(
        and(
          eq(waitingList.salonId, params.salonId),
          isNull(waitingList.notifiedAt),
          isNull(waitingList.accepted),
          serviceCondition,
          employeeCondition
        )
      );

    if (entries.length === 0) {
      logger.debug("No matching waiting list entries for freed slot", { salonId: params.salonId });
      return result;
    }

    logger.info("Found matching waiting list entries for freed slot", { count: entries.length, salonId: params.salonId });

    // Format the freed slot details for notification messages
    const formattedDate = params.startTime.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const formattedTime = params.startTime.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    for (const row of entries) {
      const clientName = `${row.client.firstName} ${row.client.lastName}`;
      const bookingLink = `${appUrl}/salons/${params.salonId}/book`;

      // Build the notification message in Polish
      const message =
        `${clientName}, zwolnil sie termin w ${params.salonName}: ` +
        `${params.serviceName} u ${params.employeeName}, ` +
        `${formattedDate} o ${formattedTime}. ` +
        `Zarezerwuj teraz: ${bookingLink}`;

      // Send SMS if the client has a phone number
      if (row.client.phone) {
        try {
          const smsResult = await sendSms({
            to: row.client.phone,
            message,
            salonId: params.salonId,
            clientId: row.client.id,
          });
          if (smsResult.success) {
            result.smsCount++;
          } else {
            result.errors++;
          }
        } catch (err) {
          logger.error("Waiting list SMS notification failed", { clientId: row.client.id, error: err });
          result.errors++;
        }
      }

      // Send push notification if the client has a linked user account.
      // We look up the user by email to find the userId for push delivery —
      // ONLY accounts with a VERIFIED email (same rule as src/lib/client-match.ts):
      // an account registered on someone else's address must not receive the
      // client's name, salon, service, employee and time.
      if (row.client.email) {
        try {
          const [linkedUser] = await db
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.email, row.client.email), eq(user.emailVerified, true)))
            .limit(1);

          if (linkedUser) {
            const pushResult = await sendPushNotification(linkedUser.id, {
              title: "Zwolnil sie termin!",
              body: message,
              tag: `waiting-list-${row.entry.id}`,
              data: {
                type: "waiting_list_notification",
                waitingListId: row.entry.id,
                salonId: params.salonId,
                url: "/client/waiting-list",
              },
              salonId: params.salonId,
              clientId: row.client.id,
            });
            if (pushResult.success) {
              result.pushCount++;
            }
          }
        } catch (err) {
          logger.warn("Waiting list push notification failed", { clientId: row.client.id, error: err });
          // Push failures are non-critical; do not increment errors
        }
      }

      // Find client's existing appointment for same service to link it
      let existingApptId: string | null = null;
      if (params.serviceId && row.client.id) {
        const existingAppts = await db
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.clientId, row.client.id),
              eq(appointments.salonId, params.salonId),
              eq(appointments.serviceId, params.serviceId),
              not(eq(appointments.status, "cancelled"))
            )
          )
          .limit(1);
        if (existingAppts.length > 0) {
          existingApptId = existingAppts[0]!.id;
        }
      }

      // Generate a secure accept token
      const acceptToken = crypto.randomBytes(32).toString("hex");

      // Mark the entry as notified and save offered slot details
      try {
        await db
          .update(waitingList)
          .set({
            notifiedAt: new Date(),
            offeredStartTime: params.startTime,
            offeredEndTime: params.endTime,
            offeredEmployeeId: params.employeeId,
            existingAppointmentId: existingApptId,
            acceptToken,
          })
          .where(eq(waitingList.id, row.entry.id));
        result.notified++;
      } catch (updateErr) {
        logger.error("Failed to update notifiedAt for waiting list entry", { entryId: row.entry.id, error: updateErr });
        result.errors++;
      }
    }

    logger.info("Waiting list notification complete", {
      notified: result.notified,
      smsCount: result.smsCount,
      pushCount: result.pushCount,
      errors: result.errors,
    });
  } catch (error) {
    logger.error("Failed to notify waiting list", { error });
    result.errors++;
  }

  return result;
}

// ─── Accept earlier slot ─────────────────────────────────────────────────────

interface AcceptResult {
  success: boolean;
  message: string;
  appointmentId?: string;
  oldStartTime?: Date;
  newStartTime?: Date;
}

/**
 * Accept an offered earlier slot from the waiting list.
 *
 * Validates the accept token, checks slot availability, then either moves
 * the client's existing appointment to the earlier time or creates a new
 * appointment. Marks the waiting list entry as accepted and logs a
 * confirmation notification.
 */
export async function acceptEarlierSlot(
  waitingListId: string,
  acceptToken: string
): Promise<AcceptResult> {
  // 1. Fetch the waiting list entry
  const [entry] = await db
    .select()
    .from(waitingList)
    .where(eq(waitingList.id, waitingListId))
    .limit(1);

  if (!entry) {
    return { success: false, message: "Wpis nie zostal znaleziony" };
  }

  // 2. Verify token
  if (entry.acceptToken !== acceptToken) {
    return { success: false, message: "Nieprawidlowy token akceptacji" };
  }

  // 3. Check not already handled
  if (entry.accepted !== null) {
    const prev = entry.accepted ? "zaakceptowany" : "odrzucony";
    return {
      success: false,
      message: `Ten wpis zostal juz ${prev}`,
    };
  }

  // 4. Verify offered slot details exist
  if (!entry.offeredStartTime || !entry.offeredEndTime) {
    return {
      success: false,
      message: "Brak danych o proponowanym terminie",
    };
  }

  const offeredStart = new Date(entry.offeredStartTime);
  const offeredEnd = new Date(entry.offeredEndTime);
  // #168 pkt 4 (decyzja Olivera, wariant A): oferta dotyczy terminu zwolnionego
  // u KONKRETNEGO pracownika (notifyWaitingList zapisuje go razem z tokenem).
  // Puste offeredEmployeeId = pracownik usunięty po wysłaniu oferty (FK ON
  // DELETE SET NULL) — oferta nieważna: odmowa, nic nie zapisane, wpis bez
  // zmian. Bez przejścia na preferredEmployeeId (ta osoba mogła w tym czasie
  // nie pracować) i bez przesuwania wizyty bez sprawdzenia kolizji.
  if (!entry.offeredEmployeeId) {
    return { success: false, message: "Proponowany termin nie jest juz dostepny" };
  }
  const employeeId = entry.offeredEmployeeId;

  // Przedział pusty/odwrócony nie trafiłby w warunek kolizji (#165) — odmowa,
  // nic nie zapisane, wpis bez zmian.
  if (!(offeredEnd.getTime() > offeredStart.getTime())) {
    return { success: false, message: "Nieprawidlowy proponowany termin" };
  }

  // 5. Check that the offered slot is still in the future
  if (offeredStart <= new Date()) {
    return {
      success: false,
      message: "Proponowany termin juz minal",
    };
  }

  // 6. Termin musi być nadal wolny (#165): ta sama definicja kolizji co przy
  // zapisie wizyty, półotwarta [start, end). Przenoszona wizyta klienta nie
  // koliduje sama ze sobą. Przy kolizji nic nie zapisujemy — wpis zostaje
  // nierozstrzygnięty (accepted = null).
  const overlapping = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      appointmentConflictWhere({
        salonId: entry.salonId,
        employeeId,
        start: offeredStart,
        end: offeredEnd,
        excludeId: entry.existingAppointmentId,
      })
    )
    .limit(1);

  if (overlapping.length > 0) {
    return { success: false, message: "Termin jest juz zajety" };
  }

  let appointmentId: string;
  let oldStartTime: Date | undefined;

  // #63: NOWA wizyta z listy oczekujących podlega tej samej regule co
  // /api/appointments — usługa z deposit_required / klient z require_deposit
  // (po clientId wpisu, ustawionym przez salon) nie powstaje bez wpłaty.
  // Wpis zostaje nierozstrzygnięty, klient może zarezerwować termin w portalu
  // z zadatkiem. Przeniesienie istniejącej wizyty nie tworzy nowej rezerwacji.
  const depositBlocksNewAppointment = async (): Promise<AcceptResult | null> => {
    if (!entry.serviceId) return null; // bez usługi nie ma zadatku
    const verdict = await checkBookingWithoutDeposit({
      salonId: entry.salonId,
      serviceId: entry.serviceId,
      startTime: offeredStart,
      clientId: entry.clientId,
    });
    if (verdict.allowed) return null;
    const message =
      verdict.reason === "unavailable"
        ? DEPOSIT_CHECK_UNAVAILABLE_MESSAGE
        : verdict.reason === "not_found"
          ? "Usługa z tego wpisu nie jest już dostępna"
          : DEPOSIT_REQUIRED_MESSAGE;
    return { success: false, message };
  };

  // 7. Move existing appointment or create a new one
  // #171: każdy zapis poniżej to jedno polecenie; jeśli równoległy zapis
  // zajął termin po kroku 6, EXCLUDE w bazie odrzuca je (23P01, albo 40P01
  // przy sprawdzaniu ograniczenia) — odmowa jak
  // przy kolizji, nic nie zapisane, wpis nierozstrzygnięty.
  try {
    if (entry.existingAppointmentId) {
      // Move existing appointment to the earlier slot
      const [existingAppt] = await db
        .select()
        .from(appointments)
        .where(eq(appointments.id, entry.existingAppointmentId))
        .limit(1);

      if (existingAppt && existingAppt.status !== "cancelled") {
        oldStartTime = new Date(existingAppt.startTime);
        await db
          .update(appointments)
          .set({
            startTime: offeredStart,
            endTime: offeredEnd,
            employeeId,
            notes: `${existingAppt.notes || ""} [Przeniesiony z listy oczekujacych]`.trim(),
          })
          .where(eq(appointments.id, entry.existingAppointmentId));
        appointmentId = entry.existingAppointmentId;
        logger.info("Moved appointment from waiting list", {
          appointmentId,
          from: oldStartTime.toISOString(),
          to: offeredStart.toISOString(),
        });
      } else {
        // Existing appointment was cancelled or missing – create new
        const blocked = await depositBlocksNewAppointment();
        if (blocked) return blocked;
        const [newAppt] = await db
          .insert(appointments)
          .values({
            salonId: entry.salonId,
            clientId: entry.clientId,
            employeeId,
            serviceId: entry.serviceId,
            startTime: offeredStart,
            endTime: offeredEnd,
            status: "scheduled",
            notes: "Utworzony z listy oczekujacych",
          })
          .returning();
        appointmentId = newAppt!.id;
      }
    } else {
      // No existing appointment – create new
      const blocked = await depositBlocksNewAppointment();
      if (blocked) return blocked;
      const [newAppt] = await db
        .insert(appointments)
        .values({
          salonId: entry.salonId,
          clientId: entry.clientId,
          employeeId,
          serviceId: entry.serviceId,
          startTime: offeredStart,
          endTime: offeredEnd,
          status: "scheduled",
          notes: "Utworzony z listy oczekujacych",
        })
        .returning();
      appointmentId = newAppt!.id;
    }
  } catch (error) {
    if (isAppointmentSlotTaken(error)) {
      return { success: false, message: "Termin jest juz zajety" };
    }
    logger.error("acceptEarlierSlot: zapis wizyty odrzucony przez baze", {
      waitingListId,
      code: dbErrorCode(error),
    });
    throw error;
  }

  // 8. Mark waiting list entry as accepted
  await db
    .update(waitingList)
    .set({ accepted: true })
    .where(eq(waitingList.id, waitingListId));

  // 9. Log a confirmation notification
  try {
    await db.insert(notifications).values({
      salonId: entry.salonId,
      clientId: entry.clientId,
      type: "sms",
      message: `Klient zaakceptowal wczesniejszy termin z listy oczekujacych. Wizyta ${appointmentId} przeniesiona na ${offeredStart.toLocaleString("pl-PL")}.`,
      status: "sent",
    });
  } catch (notifErr) {
    logger.error("Failed to create waiting list confirmation notification", { error: notifErr });
  }

  return {
    success: true,
    message: "Termin zostal zaakceptowany! Wizyta zostala przeniesiona.",
    appointmentId,
    ...(oldStartTime !== undefined ? { oldStartTime } : {}),
    newStartTime: offeredStart,
  };
}

// ─── Decline earlier slot ────────────────────────────────────────────────────

interface DeclineResult {
  success: boolean;
  message: string;
}

/**
 * Decline an offered earlier slot from the waiting list.
 */
export async function declineEarlierSlot(
  waitingListId: string,
  acceptToken: string
): Promise<DeclineResult> {
  const [entry] = await db
    .select()
    .from(waitingList)
    .where(eq(waitingList.id, waitingListId))
    .limit(1);

  if (!entry) {
    return { success: false, message: "Wpis nie zostal znaleziony" };
  }

  if (entry.acceptToken !== acceptToken) {
    return { success: false, message: "Nieprawidlowy token" };
  }

  if (entry.accepted !== null) {
    const prev = entry.accepted ? "zaakceptowany" : "odrzucony";
    return {
      success: false,
      message: `Ten wpis zostal juz ${prev}`,
    };
  }

  await db
    .update(waitingList)
    .set({ accepted: false })
    .where(eq(waitingList.id, waitingListId));

  return {
    success: true,
    message: "Termin zostal odrzucony.",
  };
}
