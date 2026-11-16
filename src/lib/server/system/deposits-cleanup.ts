/**
 * Wyjście systemowe (#193 P5a-2): backstop zgubionych webhooków Stripe —
 * anuluje „martwe” rezerwacje z nieopłaconym zadatkiem, żeby nie blokowały
 * terminów. Działa na wszystkich salonach (cron, sekret crona, bez sesji),
 * więc idzie przez pulę systemową, nie przez `forSalon`.
 *
 * Sesja Checkout zadatku żyje ok. 31 minut; webhook `checkout.session.expired`
 * / `async_payment_failed` ustawia płatność na `failed` i anuluje wizytę. Gdy
 * webhook nie dotrze, ten przebieg anuluje wizyty nadal `scheduled` z
 * `depositPaid = false`, których płatność zadatku jest `pending`/`failed`
 * i starsza niż próg.
 *
 * Skutek jest nieodwracalny w wielu salonach (anulowanie wizyty, płatność →
 * `failed`), więc importerzy tego wyjścia są na liście DOKŁADNIE migawki L7
 * (zmianę akceptują CTO i CRCO).
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { appointments, depositPayments } from "@/lib/schema";
import { dbSystem } from "./db-system";

const STALE_DEPOSIT_MINUTES = 45;

export type StaleDepositCleanupResult = {
  cancelledAppointments: number;
  failedPayments: number;
};

/**
 * Anuluje martwe rezerwacje z zadatkiem: płatności `pending` → `failed`
 * (strażnik `status = 'pending'` przeciw równoległemu potwierdzeniu), wizyty
 * → `cancelled` (strażnik `scheduled` i `depositPaid = false`), w jednej
 * transakcji. Liczniki jak dotąd: wizyty i płatności `pending` z wyboru.
 */
export async function cleanupStaleDepositBookings(): Promise<StaleDepositCleanupResult> {
  const cutoff = new Date(Date.now() - STALE_DEPOSIT_MINUTES * 60 * 1000);

  // Find stale deposit bookings: unpaid deposit payment older than the
  // cutoff whose appointment is still scheduled and unpaid.
  const stale = await dbSystem
    .select({
      paymentId: depositPayments.id,
      paymentStatus: depositPayments.status,
      appointmentId: depositPayments.appointmentId,
    })
    .from(depositPayments)
    .innerJoin(appointments, eq(depositPayments.appointmentId, appointments.id))
    .where(
      and(
        inArray(depositPayments.status, ["pending", "failed"]),
        lt(depositPayments.createdAt, cutoff),
        eq(appointments.status, "scheduled"),
        eq(appointments.depositPaid, false)
      )
    );

  if (stale.length === 0) {
    return { cancelledAppointments: 0, failedPayments: 0 };
  }

  const pendingPaymentIds = stale
    .filter((row) => row.paymentStatus === "pending")
    .map((row) => row.paymentId);
  const appointmentIds = [...new Set(stale.map((row) => row.appointmentId))];

  await dbSystem.transaction(async (tx) => {
    if (pendingPaymentIds.length > 0) {
      await tx
        .update(depositPayments)
        .set({ status: "failed" })
        .where(
          and(
            inArray(depositPayments.id, pendingPaymentIds),
            // Guard against a webhook confirming concurrently
            eq(depositPayments.status, "pending")
          )
        );
    }

    await tx
      .update(appointments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          inArray(appointments.id, appointmentIds),
          eq(appointments.status, "scheduled"),
          eq(appointments.depositPaid, false)
        )
      );
  });

  logger.info("[Cron] Cancelled stale unpaid deposit bookings", {
    cancelledAppointments: appointmentIds.length,
    failedPayments: pendingPaymentIds.length,
    cutoff: cutoff.toISOString(),
  });

  return { cancelledAppointments: appointmentIds.length, failedPayments: pendingPaymentIds.length };
}
