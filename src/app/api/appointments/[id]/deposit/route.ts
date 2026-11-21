import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { notifyDepositMarkedPaid } from "@/lib/deposit-marked-sms";
import { recordDepositStatusEvent, type DepositStatusEventActor } from "@/lib/deposit-status-events";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext, type SalonRole } from "@/lib/salon-context";
import { appointments, depositPayments } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * /api/appointments/[id]/deposit — ręczne oznaczenie zadatku rozliczanego
 * poza MyHelper (przelew BLIK na telefon salonu).
 *
 *   POST   → `depositPaid = true`  („zadatek wpłacony”)
 *   DELETE → `depositPaid = false` („cofnij” — pomyłka przy oznaczaniu)
 *
 * Dlaczego recepcja może tu, a w PUT /api/appointments/[id] nie:
 * PUT dopuszcza zmianę `depositPaid` tylko właścicielowi, bo ręczne „opłacenie”
 * wizyty z płatnością Stripe włączało przy anulowaniu ścieżkę zwrotu Stripe.
 * Ta trasa obsługuje WYŁĄCZNIE wizyty bez żadnego wiersza `deposit_payments`
 * (w dowolnym statusie) — inaczej 409 `DEPOSIT_ONLINE_PAYMENT`. Bez płatności
 * online nie ma czego zwracać przez Stripe: `refundAppointmentDeposits` zwraca
 * „Brak zadatku do zwrotu”, a anulowanie przez salon trafia w wariant `manual`
 * (zwrot ustala salon sam). Wpłatę BLIK widzi posiadacz konta przypisanego do
 * numeru; recepcja oznacza ją, gdy ma ten wgląd albo jego potwierdzenie. Pracownik (`employee`) — 403.
 *
 * Po oznaczeniu „wpłacony” (tylko przy zmianie stanu, po zatwierdzeniu transakcji) trasa wysyła klientowi SMS (`notifyDepositMarkedPaid`), najwyżej jeden na wizytę — ponowne oznaczenie po cofnięciu go nie powtarza; brak telefonu albo błąd SMS nie zmienia stanu ani odpowiedzi. Cofnięcie nie wysyła SMS.
 *
 * Kolejność: sesja (401) → kontekst salonu (404) → rola (403) → format id (400)
 * → jedna transakcja `forSalon(ctx.salonId).raw`: wizyta z jawnym `eq(salonId)`
 * i blokadą wiersza (404), płatności online (409), kwota zadatku i status (400),
 * stan docelowy już ustawiony (200 bez zapisu), zapis z `eq(id)` i `eq(salonId)`
 * i wpis dziennika `deposit_status_events` w tej samej transakcji (tylko przy zmianie).
 *
 * Ślad audytu: log `info` z salonId, appointmentId, userId, rolą i nowym
 * stanem — bez danych klienta i bez numeru BLIK. Trwały ślad: wpis dziennika
 * zmian zadatku (konto, rola w salonie, poprzednia i nowa wartość); log zostaje.
 */

/** Role, które mogą oznaczać zadatek. Właściciel i recepcja; pracownik nie. */
const DEPOSIT_MARK_ROLES: readonly DepositStatusEventActor["role"][] = ["owner", "receptionist"];

function isDepositMarkRole(role: SalonRole): role is DepositStatusEventActor["role"] {
  return (DEPOSIT_MARK_ROLES as readonly string[]).includes(role);
}

/** Statusy wizyty, przy których oznaczenie zadatku ma sens (wizyta przed realizacją). */
const MARKABLE_STATUSES: readonly string[] = ["scheduled", "confirmed"];

const DEPOSIT_ONLINE_PAYMENT_CODE = "DEPOSIT_ONLINE_PAYMENT";

type MarkOutcome =
  | { kind: "not_found" }
  | { kind: "online_payment" }
  | { kind: "no_deposit" }
  | { kind: "wrong_status" }
  | { kind: "ok"; changed: boolean };

/** Wizyta z zadatkiem: kwota dodatnia (numeric przychodzi jako napis). */
function hasPositiveDeposit(depositAmount: string | null): boolean {
  if (depositAmount === null) return false;
  const amount = Number(depositAmount);
  return Number.isFinite(amount) && amount > 0;
}

async function markDeposit(
  action: { method: "POST" | "DELETE"; logLabel: string },
  params: Promise<{ id: string }>
) {
  const targetPaid = action.method === "POST";
  let salonId: string | undefined;
  let appointmentId: string | undefined;

  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json({ success: false, error: "Salon not found" }, { status: 404 });
    }
    salonId = ctx.salonId;

    if (!isDepositMarkRole(ctx.role)) {
      return NextResponse.json({ success: false, error: "Brak uprawnien" }, { status: 403 });
    }
    const actor: DepositStatusEventActor = { userId: ctx.userId, role: ctx.role };

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid appointment ID format" },
        { status: 400 }
      );
    }
    appointmentId = id;
    const scopedSalonId = ctx.salonId;

    // Odczyt, warunki i zapis w jednej transakcji z kontekstem RLS salonu.
    // `for update` blokuje wiersz wizyty do końca transakcji, więc równoległe
    // „wpłacony” i „cofnij” nie przeplotą odczytu z zapisem.
    const outcome = await forSalon(scopedSalonId).raw(async (tx): Promise<MarkOutcome> => {
      const [appointment] = await tx
        .select({
          id: appointments.id,
          status: appointments.status,
          depositAmount: appointments.depositAmount,
          depositPaid: appointments.depositPaid,
        })
        .from(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.salonId, scopedSalonId)))
        .limit(1)
        .for("update");
      if (!appointment) return { kind: "not_found" };

      // Jakikolwiek wiersz płatności (także failed/expired/refunded) oznacza,
      // że zadatek tej wizyty prowadzi ścieżka online — tu jej nie ruszamy.
      const [payment] = await tx
        .select({ id: depositPayments.id })
        .from(depositPayments)
        .where(
          and(eq(depositPayments.appointmentId, id), eq(depositPayments.salonId, scopedSalonId))
        )
        .limit(1);
      if (payment) return { kind: "online_payment" };

      if (!hasPositiveDeposit(appointment.depositAmount)) return { kind: "no_deposit" };
      if (!MARKABLE_STATUSES.includes(appointment.status)) return { kind: "wrong_status" };

      // Idempotencja: powtórne kliknięcie nie zapisuje i nie zmienia updatedAt.
      if ((appointment.depositPaid === true) === targetPaid) return { kind: "ok", changed: false };

      await tx
        .update(appointments)
        .set({ depositPaid: targetPaid, updatedAt: new Date() })
        .where(and(eq(appointments.id, id), eq(appointments.salonId, scopedSalonId)));
      // Dziennik zmian (kto i kiedy) w TEJ SAMEJ transakcji: błąd wpisu cofa zmianę flagi (500).
      await recordDepositStatusEvent(tx, {
        salonId: scopedSalonId,
        appointmentId: id,
        previousDepositPaid: appointment.depositPaid,
        depositPaid: targetPaid,
        source: targetPaid ? "manual_mark" : "manual_unmark",
        actor,
      });
      return { kind: "ok", changed: true };
    });

    switch (outcome.kind) {
      case "not_found":
        return NextResponse.json({ success: false, error: "Appointment not found" }, { status: 404 });
      case "online_payment":
        return NextResponse.json(
          {
            success: false,
            code: DEPOSIT_ONLINE_PAYMENT_CODE,
            error: "Zadatek tej wizyty obsługuje płatność online",
          },
          { status: 409 }
        );
      case "no_deposit":
        return NextResponse.json(
          { success: false, error: "Wizyta nie ma zadatku do oznaczenia" },
          { status: 400 }
        );
      case "wrong_status":
        return NextResponse.json(
          { success: false, error: "Zadatek można oznaczyć tylko przy wizycie zaplanowanej lub potwierdzonej" },
          { status: 400 }
        );
      case "ok":
        break;
    }

    logger.info(`[AppointmentDeposit API] ${action.logLabel}`, {
      salonId: scopedSalonId,
      appointmentId: id,
      userId: ctx.userId,
      role: ctx.role,
      depositPaid: targetPaid,
      changed: outcome.changed,
    });

    // SMS do klienta dopiero po COMMIT (forSalon.raw już się rozstrzygnęło) i tylko
    // przy faktycznym oznaczeniu jako wpłacony; cofnięcie nie wysyła SMS.
    // Błąd SMS nie zmienia stanu ani odpowiedzi.
    if (targetPaid && outcome.changed) {
      try {
        await notifyDepositMarkedPaid({ salonId: scopedSalonId, appointmentId: id });
      } catch (error) {
        logger.warn("[AppointmentDeposit API] Deposit marked SMS failed", {
          appointmentId: id,
          ...toErrorIdentity(error),
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: { appointmentId: id, depositPaid: targetPaid, changed: outcome.changed },
    });
  } catch (error) {
    // Sama tożsamość błędu: treść błędu bazy może nieść parametry zapytania.
    logger.error(`[AppointmentDeposit API] ${action.method} failed`, {
      salonId,
      appointmentId,
      ...toErrorIdentity(error),
    });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zmienic stanu zadatku" },
      { status: 500 }
    );
  }
}

// POST /api/appointments/[id]/deposit — zadatek wpłacony poza MyHelper
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return markDeposit({ method: "POST", logLabel: "Deposit marked as paid" }, params);
}

// DELETE /api/appointments/[id]/deposit — cofnięcie oznaczenia (pomyłka)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return markDeposit({ method: "DELETE", logLabel: "Deposit mark reverted" }, params);
}
