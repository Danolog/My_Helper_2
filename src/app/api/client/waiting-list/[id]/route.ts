import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { waitingList, clients } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  acceptEarlierSlot,
  declineEarlierSlot,
} from "@/lib/waiting-list";

import { logger } from "@/lib/logger";
// POST /api/client/waiting-list/[id] - Client accepts or declines a notified slot
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userEmail = session.user.email;
    const { id } = await params;

    const body = await request.json();
    const { accepted } = body;

    if (typeof accepted !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: "Pole 'accepted' jest wymagane i musi byc wartoscia logiczna (true/false)",
        },
        { status: 400 }
      );
    }

    // Find the waiting list entry with client info for ownership verification
    const [entry] = await db
      .select({
        entry: waitingList,
        client: clients,
      })
      .from(waitingList)
      .innerJoin(clients, eq(waitingList.clientId, clients.id))
      .where(eq(waitingList.id, id))
      .limit(1);

    if (!entry) {
      return NextResponse.json(
        { success: false, error: "Wpis na liscie oczekujacych nie zostal znaleziony" },
        { status: 404 }
      );
    }

    // Verify the entry belongs to a client linked to this user (by email)
    if (entry.client.email !== userEmail) {
      return NextResponse.json(
        { success: false, error: "Brak dostepu do tego wpisu" },
        { status: 403 }
      );
    }

    // Verify the entry has been notified (notifiedAt must be set)
    if (!entry.entry.notifiedAt) {
      return NextResponse.json(
        {
          success: false,
          error: "Ten wpis nie zostal jeszcze powiadomiony o dostepnym terminie",
        },
        { status: 400 }
      );
    }

    // Verify the entry hasn't already been accepted or declined
    if (entry.entry.accepted !== null) {
      const previousDecision = entry.entry.accepted
        ? "zaakceptowany"
        : "odrzucony";
      return NextResponse.json(
        {
          success: false,
          error: `Ten wpis zostal juz ${previousDecision}`,
        },
        { status: 409 }
      );
    }

    // Use the full accept/decline logic if the entry has an acceptToken
    if (entry.entry.acceptToken) {
      if (accepted) {
        const acceptResult = await acceptEarlierSlot(
          id,
          entry.entry.acceptToken
        );
        logger.info(`[Client WaitingList API] POST [id]: Accept result for ${id}`,
          { result: acceptResult as unknown as Record<string, unknown> });
        return NextResponse.json({
          success: acceptResult.success,
          message: acceptResult.message,
          data: {
            appointmentId: acceptResult.appointmentId,
            oldStartTime: acceptResult.oldStartTime,
            newStartTime: acceptResult.newStartTime,
          },
        });
      } else {
        const declineResult = await declineEarlierSlot(
          id,
          entry.entry.acceptToken
        );
        logger.info(`[Client WaitingList API] POST [id]: Decline result for ${id}`,
          { result: declineResult as unknown as Record<string, unknown> });
        return NextResponse.json({
          success: declineResult.success,
          message: declineResult.message,
        });
      }
    }

    // Fallback: simple update for legacy entries without acceptToken
    const [updatedEntry] = await db
      .update(waitingList)
      .set({ accepted })
      .where(eq(waitingList.id, id))
      .returning();

    const action = accepted ? "zaakceptowal" : "odrzucil";
    logger.info(`[Client WaitingList API] POST [id]: User ${session.user.id} ${action} entry ${id}`);

    return NextResponse.json({
      success: true,
      data: updatedEntry,
      message: accepted
        ? "Termin zostal zaakceptowany. Skontaktuj sie z salonem, aby potwierdzic rezerwacje."
        : "Termin zostal odrzucony.",
    });
  } catch (error) {
    logger.error("[Client WaitingList API] POST [id] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zaktualizowac wpisu" },
      { status: 500 }
    );
  }
}

// DELETE /api/client/waiting-list/[id] - Client removes themselves from a waiting list
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userEmail = session.user.email;
    const { id } = await params;

    // Find the waiting list entry with client info for ownership verification
    const [entry] = await db
      .select({
        entry: waitingList,
        client: clients,
      })
      .from(waitingList)
      .innerJoin(clients, eq(waitingList.clientId, clients.id))
      .where(eq(waitingList.id, id))
      .limit(1);

    if (!entry) {
      return NextResponse.json(
        { success: false, error: "Wpis na liscie oczekujacych nie zostal znaleziony" },
        { status: 404 }
      );
    }

    // Verify the entry belongs to a client linked to this user (by email)
    if (entry.client.email !== userEmail) {
      return NextResponse.json(
        { success: false, error: "Brak dostepu do tego wpisu" },
        { status: 403 }
      );
    }

    const [deletedEntry] = await db
      .delete(waitingList)
      .where(eq(waitingList.id, id))
      .returning();

    logger.info(`[Client WaitingList API] DELETE: User ${session.user.id} removed entry ${id}`);

    return NextResponse.json({
      success: true,
      data: deletedEntry,
      message: "Zostales usuniety z listy oczekujacych",
    });
  } catch (error) {
    logger.error("[Client WaitingList API] DELETE Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie usunac wpisu" },
      { status: 500 }
    );
  }
}
