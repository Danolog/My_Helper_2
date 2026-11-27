import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { NO_SHOW_STATUS } from "@/lib/no-show";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext } from "@/lib/salon-context";
import { appointments, clients } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * GET /api/clients/[id]/no-shows — liczba wizyt klienta oznaczonych
 * „Nie przyszedł” (status `no_show`) w salonie z sesji.
 *
 * Licznik nie jest zapisywany osobno: liczymy wizyty z tym statusem, więc
 * cofnięcie oznaczenia od razu zmniejsza wynik. Wizyty gościa bez karty
 * klienta (sam telefon na wizycie) nie trafiają do żadnej karty.
 *
 * Kolejność: sesja (401) → kontekst salonu (404) → rola (403: kartoteka
 * klientów to właściciel i recepcja, jak GET /api/clients/[id]) → format id
 * (400) → jedna transakcja `forSalon(ctx.salonId).raw`: karta klienta z jawnym
 * `eq(salonId)` (404), licznik z jawnym `eq(salonId)`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let salonId: string | undefined;
  let clientId: string | undefined;

  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json({ success: false, error: "Nie znaleziono salonu" }, { status: 404 });
    }
    salonId = ctx.salonId;

    if (ctx.role === "employee") {
      return NextResponse.json({ success: false, error: "Brak uprawnień" }, { status: 403 });
    }

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy identyfikator klienta" },
        { status: 400 }
      );
    }
    clientId = id;
    const scopedSalonId = ctx.salonId;

    const result = await forSalon(scopedSalonId).raw(async (tx) => {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, id), eq(clients.salonId, scopedSalonId)))
        .limit(1);
      if (!client) return null;

      const [row] = await tx
        .select({ noShowCount: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, scopedSalonId),
            eq(appointments.clientId, id),
            eq(appointments.status, NO_SHOW_STATUS)
          )
        );
      return { noShowCount: Number(row?.noShowCount ?? 0) };
    });

    if (!result) {
      return NextResponse.json({ success: false, error: "Nie znaleziono klienta" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: { clientId: id, noShowCount: result.noShowCount },
    });
  } catch (error) {
    // Sama tożsamość błędu: treść błędu bazy może nieść parametry zapytania.
    logger.error("[ClientNoShows API] GET failed", { salonId, clientId, ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Nie udało się pobrać liczby nieobecności" },
      { status: 500 }
    );
  }
}
