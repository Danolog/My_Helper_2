/**
 * Wyjście systemowe (#193 P5a-2): backstop zgubionych webhooków Stripe —
 * anuluje „martwe” rezerwacje z nieopłaconym zadatkiem, żeby nie blokowały
 * terminów. Działa na wszystkich salonach (cron, sekret crona, bez sesji),
 * więc idzie przez pulę systemową, nie przez `forSalon`.
 *
 * Sesja Checkout zadatku żyje ok. 31 minut; webhook `checkout.session.expired`
 * / `async_payment_failed` ustawia płatność na `failed` i anuluje wizytę. Gdy
 * webhook nie dotrze, ten przebieg anuluje wizytę.
 *
 * Niezmiennik: wizyta (`scheduled`, `deposit_paid = false`, z co najmniej
 * jedną płatnością) jest anulowana tylko wtedy, gdy nie ma ŻYWEJ płatności —
 * żywa to płatność tej wizyty o statusie innym niż `failed` albo utworzona nie
 * wcześniej niż próg. Wizyt bez żadnej płatności przebieg nie rusza.
 *
 * Wybór i zmiana są w tym samym poleceniu (warunki płatności i wieku w SQL
 * każdego UPDATE), w jednej transakcji. Kolejność blokad: płatności, potem
 * wizyty — ta sama co w potwierdzeniu wpłaty. Przebieg jest idempotentny.
 *
 * Skutek jest nieodwracalny w wielu salonach (anulowanie wizyty, płatność →
 * `failed`), więc importerzy tego wyjścia są na liście DOKŁADNIE migawki L7
 * (zmianę akceptują recenzja i przegląd zgodności).
 */
import { and, eq, exists, gte, inArray, lt, ne, notExists, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { logger } from "@/lib/logger";
import { appointments, depositPayments } from "@/lib/schema";
import { dbSystem } from "./db-system";

const STALE_DEPOSIT_MINUTES = 45;

export type StaleDepositCleanupResult = {
  /** Wizyty faktycznie anulowane w tym przebiegu (RETURNING). */
  cancelledAppointments: number;
  /** Płatności faktycznie przestawione z `pending` na `failed` (RETURNING). */
  failedPayments: number;
};

/**
 * Anuluje martwe rezerwacje z zadatkiem w jednej transakcji:
 * 1. płatności `pending` starsze od progu → `failed`, tylko dla wizyt
 *    `scheduled` bez wpłaty, które nie mają płatności młodszej od progu ani
 *    płatności o statusie spoza `pending`/`failed`;
 * 2. wizyty `scheduled` bez wpłaty, z co najmniej jedną płatnością i bez żywej
 *    płatności → `cancelled` (po kroku 1 stare `pending` są już `failed`, więc
 *    warunek obejmuje też wizyty z samymi starymi `failed`).
 *
 * Liczniki = wiersze zmienione przez oba polecenia.
 */
export async function cleanupStaleDepositBookings(): Promise<StaleDepositCleanupResult> {
  const cutoff = new Date(Date.now() - STALE_DEPOSIT_MINUTES * 60 * 1000);
  const other = alias(depositPayments, "other_payment");

  const { failed, cancelled } = await dbSystem.transaction(async (tx) => {
    const failed = await tx
      .update(depositPayments)
      .set({ status: "failed" })
      .where(
        and(
          // Strażnik przeciw równoległemu potwierdzeniu wpłaty
          eq(depositPayments.status, "pending"),
          lt(depositPayments.createdAt, cutoff),
          inArray(
            depositPayments.appointmentId,
            tx
              .select({ id: appointments.id })
              .from(appointments)
              .where(
                and(
                  eq(appointments.status, "scheduled"),
                  eq(appointments.depositPaid, false),
                  notExists(
                    tx
                      .select({ one: sql`1` })
                      .from(other)
                      .where(
                        and(
                          eq(other.appointmentId, appointments.id),
                          or(gte(other.createdAt, cutoff), notInArray(other.status, ["pending", "failed"]))
                        )
                      )
                  )
                )
              )
          )
        )
      )
      .returning({ id: depositPayments.id });

    // Płatność wstawiona po starcie tego polecenia nie jest przez nie widziana
    // (okno = czas jednego polecenia). Potwierdzenie takiej płatności zastaje
    // wizytę anulowaną i kończy się zwrotem.
    const cancelled = await tx
      .update(appointments)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(appointments.status, "scheduled"),
          eq(appointments.depositPaid, false),
          exists(
            tx
              .select({ one: sql`1` })
              .from(depositPayments)
              .where(eq(depositPayments.appointmentId, appointments.id))
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(other)
              .where(
                and(
                  eq(other.appointmentId, appointments.id),
                  or(ne(other.status, "failed"), gte(other.createdAt, cutoff))
                )
              )
          )
        )
      )
      .returning({ id: appointments.id });

    return { failed, cancelled };
  });

  if (cancelled.length > 0 || failed.length > 0) {
    logger.info("[Cron] Cancelled stale unpaid deposit bookings", {
      cancelledAppointments: cancelled.length,
      failedPayments: failed.length,
      cutoff: cutoff.toISOString(),
    });
  }

  return { cancelledAppointments: cancelled.length, failedPayments: failed.length };
}
