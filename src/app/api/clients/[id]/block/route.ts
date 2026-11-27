import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { clientBlockSchema, parseBody } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { CLIENT_BLOCKED_BY_AUTO, isClientBlockRole, type ClientBlockState } from "@/lib/client-block";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext } from "@/lib/salon-context";
import { clients } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * /api/clients/[id]/block — blokada rezerwacji online klienta.
 *
 *   POST   → blokada (opcjonalna notatka `{ note }`, do 500 znaków);
 *            karta już zablokowana zostaje bez zmian (200, `changed: false`)
 *   DELETE → zdjęcie blokady (także automatycznej); bez blokady 200 `changed: false`
 *
 * Zablokowany klient nie zarezerwuje wizyty w portalu ani jako gość
 * (src/lib/online-booking-block.ts). Personel dodaje mu wizytę w panelu.
 *
 * Kolejność: sesja (401) → kontekst salonu (404) → rola (403: tylko
 * właściciel) → format id (400) → treść POST (400) → jedna transakcja
 * `forSalon(ctx.salonId).raw` z jawnym `eq(salonId)`: karta (404), zapis.
 *
 * Ślad audytu: log `info` z salonId, clientId, userId i kierunkiem zmiany —
 * bez notatki i danych klienta.
 */

type BlockRow = { blockedAt: Date | null; blockedBy: string | null; blockNote: string | null };

const BLOCK_COLUMNS = {
  blockedAt: clients.blockedAt,
  blockedBy: clients.blockedBy,
  blockNote: clients.blockNote,
};

function toState(clientId: string, row: BlockRow, changed: boolean): ClientBlockState {
  return {
    clientId,
    blocked: row.blockedAt !== null,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
    blockedBy: row.blockedBy,
    automatic: row.blockedBy === CLIENT_BLOCKED_BY_AUTO,
    note: row.blockNote,
    changed,
  };
}

const SERVER_ERROR_MESSAGE: Record<"POST" | "DELETE", string> = {
  POST: "Nie udało się zablokować rezerwacji online",
  DELETE: "Nie udało się odblokować rezerwacji online",
};

async function changeBlock(method: "POST" | "DELETE", request: Request, params: Promise<{ id: string }>) {
  const block = method === "POST";
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

    if (!isClientBlockRole(ctx.role)) {
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

    // POST: treść opcjonalna — puste ciało to blokada bez notatki.
    let note: string | null = null;
    if (block) {
      const text = await request.text();
      let body: unknown = {};
      if (text.trim() !== "") {
        try {
          body = JSON.parse(text);
        } catch {
          return NextResponse.json({ success: false, error: "Nieprawidłowe dane żądania" }, { status: 400 });
        }
      }
      const parsed = parseBody(clientBlockSchema, body);
      if (!parsed.ok) {
        const message = parsed.error.details.note ?? parsed.error.error;
        return NextResponse.json({ ...parsed.error, error: message }, { status: 400 });
      }
      note = parsed.data.note ?? null;
    }

    const scopedSalonId = ctx.salonId;
    const userId = ctx.userId;
    const isOwnedClient = and(eq(clients.id, id), eq(clients.salonId, scopedSalonId));

    const result = await forSalon(scopedSalonId).raw(async (tx) => {
      const now = new Date();
      // Warunek na bieżący stan w samym UPDATE: równoległe „zablokuj” nie
      // nadpisze daty i autora pierwszej blokady.
      const [updated] = block
        ? await tx
            .update(clients)
            .set({ blockedAt: now, blockedBy: userId, blockNote: note, updatedAt: now })
            .where(and(isOwnedClient, isNull(clients.blockedAt)))
            .returning(BLOCK_COLUMNS)
        : await tx
            .update(clients)
            .set({ blockedAt: null, blockedBy: null, blockNote: null, updatedAt: now })
            .where(and(isOwnedClient, isNotNull(clients.blockedAt)))
            .returning(BLOCK_COLUMNS);
      if (updated) return { row: updated, changed: true };

      const [current] = await tx.select(BLOCK_COLUMNS).from(clients).where(isOwnedClient).limit(1);
      return current ? { row: current, changed: false } : null;
    });

    if (!result) {
      return NextResponse.json({ success: false, error: "Nie znaleziono klienta" }, { status: 404 });
    }

    logger.info(block ? "[ClientBlock API] Online booking blocked" : "[ClientBlock API] Online booking unblocked", {
      salonId: scopedSalonId,
      clientId: id,
      userId,
      changed: result.changed,
    });

    return NextResponse.json({ success: true, data: toState(id, result.row, result.changed) });
  } catch (error) {
    // Sama tożsamość błędu: treść błędu bazy może nieść parametry zapytania.
    logger.error(`[ClientBlock API] ${method} failed`, { salonId, clientId, ...toErrorIdentity(error) });
    return NextResponse.json({ success: false, error: SERVER_ERROR_MESSAGE[method] }, { status: 500 });
  }
}

// POST /api/clients/[id]/block — zablokuj rezerwację online (opcjonalna notatka)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return changeBlock("POST", request, params);
}

// DELETE /api/clients/[id]/block — odblokuj rezerwację online
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return changeBlock("DELETE", request, params);
}
