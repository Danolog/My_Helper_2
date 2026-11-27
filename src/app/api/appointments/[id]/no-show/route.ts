import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import {
  NO_SHOW_MARKABLE_STATUSES,
  NO_SHOW_RESTORED_STATUS,
  NO_SHOW_STATUS,
  hasNoShowDayArrived,
  isNoShowMarkRole,
} from "@/lib/no-show";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext } from "@/lib/salon-context";
import { appointments } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * /api/appointments/[id]/no-show — oznaczenie „Nie przyszedł”.
 *
 *   POST   → status `no_show` (wizyta zaplanowana/potwierdzona, dzień wizyty już nadszedł)
 *   DELETE → cofnięcie: status `scheduled` (pomyłka przy oznaczaniu)
 *
 * Jedyna droga do statusu `no_show` i z powrotem: PUT /api/appointments/[id]
 * odrzuca taką zmianę (400 `NO_SHOW_DEDICATED_ROUTE`), żeby reguły roli i dnia
 * wizyty były w jednym miejscu. Licznik na karcie klienta liczy wizyty z tym
 * statusem (GET /api/clients/[id]/no-shows), więc nie wymaga osobnego zapisu.
 *
 * Kolejność: sesja (401) → kontekst salonu (404) → rola (403: tylko właściciel
 * i recepcja) → format id (400) → jedna transakcja `forSalon(ctx.salonId).raw`:
 * wizyta z jawnym `eq(salonId)` i blokadą wiersza (404), status i dzień wizyty
 * (400), stan docelowy już ustawiony (200 bez zapisu), zapis z `eq(id)` i `eq(salonId)`.
 *
 * Ślad audytu: log `info` z salonId, appointmentId, userId, rolą i nowym
 * statusem — bez danych klienta.
 */

type NoShowOutcome =
  | { kind: "not_found" }
  | { kind: "wrong_status" }
  | { kind: "too_early" }
  | { kind: "ok"; changed: boolean };

const WRONG_STATUS_MESSAGE: Record<"POST" | "DELETE", string> = {
  POST: "„Nie przyszedł” można oznaczyć tylko przy wizycie zaplanowanej lub potwierdzonej",
  DELETE: "Ta wizyta nie jest oznaczona jako „Nie przyszedł”",
};

const TOO_EARLY_MESSAGE = "„Nie przyszedł” można oznaczyć dopiero w dniu wizyty albo później";

// Teksty 400/404 trafiają do toastu w panelu, więc są po polsku.
const SALON_NOT_FOUND_MESSAGE = "Nie znaleziono salonu";
const FORBIDDEN_MESSAGE = "Brak uprawnień";
const INVALID_ID_MESSAGE = "Nieprawidłowy identyfikator wizyty";
const APPOINTMENT_NOT_FOUND_MESSAGE = "Nie znaleziono wizyty";
const SERVER_ERROR_MESSAGE = "Nie udało się zmienić oznaczenia wizyty";

async function changeNoShow(
  action: { method: "POST" | "DELETE"; logLabel: string },
  params: Promise<{ id: string }>
) {
  const markAsNoShow = action.method === "POST";
  const targetStatus = markAsNoShow ? NO_SHOW_STATUS : NO_SHOW_RESTORED_STATUS;
  let salonId: string | undefined;
  let appointmentId: string | undefined;

  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json({ success: false, error: SALON_NOT_FOUND_MESSAGE }, { status: 404 });
    }
    salonId = ctx.salonId;

    if (!isNoShowMarkRole(ctx.role)) {
      return NextResponse.json({ success: false, error: FORBIDDEN_MESSAGE }, { status: 403 });
    }

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ success: false, error: INVALID_ID_MESSAGE }, { status: 400 });
    }
    appointmentId = id;
    const scopedSalonId = ctx.salonId;

    // Odczyt, warunki i zapis w jednej transakcji z kontekstem RLS salonu.
    // `for update` blokuje wiersz do końca transakcji: równoległe „oznacz”
    // i „cofnij” (albo zakończenie wizyty) nie przeplotą odczytu z zapisem.
    const outcome = await forSalon(scopedSalonId).raw(async (tx): Promise<NoShowOutcome> => {
      const [appointment] = await tx
        .select({
          id: appointments.id,
          status: appointments.status,
          startTime: appointments.startTime,
        })
        .from(appointments)
        .where(and(eq(appointments.id, id), eq(appointments.salonId, scopedSalonId)))
        .limit(1)
        .for("update");
      if (!appointment) return { kind: "not_found" };

      if (markAsNoShow) {
        // Idempotencja: powtórne kliknięcie nie zapisuje i nie zmienia updatedAt.
        if (appointment.status === NO_SHOW_STATUS) return { kind: "ok", changed: false };
        if (!NO_SHOW_MARKABLE_STATUSES.includes(appointment.status)) return { kind: "wrong_status" };
        if (!hasNoShowDayArrived(appointment.startTime)) return { kind: "too_early" };
      } else {
        // Cofnięcie już cofniętego (wizyta znów zaplanowana/potwierdzona) — bez zapisu.
        if (NO_SHOW_MARKABLE_STATUSES.includes(appointment.status)) return { kind: "ok", changed: false };
        if (appointment.status !== NO_SHOW_STATUS) return { kind: "wrong_status" };
      }

      await tx
        .update(appointments)
        .set({ status: targetStatus, updatedAt: new Date() })
        .where(and(eq(appointments.id, id), eq(appointments.salonId, scopedSalonId)));
      return { kind: "ok", changed: true };
    });

    switch (outcome.kind) {
      case "not_found":
        return NextResponse.json(
          { success: false, error: APPOINTMENT_NOT_FOUND_MESSAGE },
          { status: 404 }
        );
      case "wrong_status":
        return NextResponse.json(
          { success: false, error: WRONG_STATUS_MESSAGE[action.method] },
          { status: 400 }
        );
      case "too_early":
        return NextResponse.json({ success: false, error: TOO_EARLY_MESSAGE }, { status: 400 });
      case "ok":
        break;
    }

    logger.info(`[AppointmentNoShow API] ${action.logLabel}`, {
      salonId: scopedSalonId,
      appointmentId: id,
      userId: ctx.userId,
      role: ctx.role,
      noShow: markAsNoShow,
      changed: outcome.changed,
    });

    return NextResponse.json({
      success: true,
      data: { appointmentId: id, noShow: markAsNoShow, changed: outcome.changed },
    });
  } catch (error) {
    // Sama tożsamość błędu: treść błędu bazy może nieść parametry zapytania.
    logger.error(`[AppointmentNoShow API] ${action.method} failed`, {
      salonId,
      appointmentId,
      ...toErrorIdentity(error),
    });
    return NextResponse.json({ success: false, error: SERVER_ERROR_MESSAGE }, { status: 500 });
  }
}

// POST /api/appointments/[id]/no-show — klient nie przyszedł na wizytę
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return changeNoShow({ method: "POST", logLabel: "Appointment marked as no-show" }, params);
}

// DELETE /api/appointments/[id]/no-show — cofnięcie oznaczenia (pomyłka)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return changeNoShow({ method: "DELETE", logLabel: "Appointment no-show reverted" }, params);
}
