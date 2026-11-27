import { NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { validateBody, treatmentSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import {
  NO_SHOW_COMPLETE_BLOCKED_CODE,
  NO_SHOW_COMPLETE_BLOCKED_MESSAGE,
  NO_SHOW_STATUS,
} from "@/lib/no-show";
import { treatmentHistory, appointments } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/**
 * Statusy, których zapis zabiegu nie zmienia na `completed`. Ten sam zbiór co
 * w POST /api/appointments/[id]/complete: „Nie przyszedł” zmienia tylko trasa
 * oznaczenia, a zakończona i anulowana wizyta ma już ostateczny wynik.
 */
const NOT_AUTO_COMPLETABLE_STATUSES = ["completed", "cancelled", NO_SHOW_STATUS];

/**
 * Wizyta okazała się „Nie przyszedł” przy zapisie statusu (oznaczenie weszło
 * po odczycie). Rzucany w transakcji, żeby wycofać zapis zabiegu.
 */
class TreatmentOnNoShowError extends Error {
  constructor() {
    super("Appointment marked as no-show before treatment was saved");
    this.name = "TreatmentOnNoShowError";
  }
}

/** Ta sama odpowiedź co w POST /api/appointments/[id]/complete. */
function noShowConflictResponse() {
  return NextResponse.json(
    {
      success: false,
      code: NO_SHOW_COMPLETE_BLOCKED_CODE,
      error: NO_SHOW_COMPLETE_BLOCKED_MESSAGE,
    },
    { status: 409 }
  );
}

// GET /api/appointments/[id]/treatment - Get treatment record for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // Verify appointment exists in the caller's salon
    const appointment = await forSalon(salonId).findOne(appointments, id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Fetch treatment record for this appointment (treatmentHistory salon-scoped posrednio)
    const [treatment] = await forSalon(salonId).raw((tx) =>
      tx
        .select()
        .from(treatmentHistory)
        .where(eq(treatmentHistory.appointmentId, id))
        .limit(1)
    );

    logger.info(`[Treatment API] GET treatment for appointment ${id}: ${treatment ? "found" : "not found"}`);

    return NextResponse.json({
      success: true,
      data: treatment || null,
    });
  } catch (error) {
    logger.error("[Treatment API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch treatment record" },
      { status: 500 }
    );
  }
}

// POST /api/appointments/[id]/treatment - Create or update treatment record
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const validationError = validateBody(treatmentSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { recipe, techniques, materialsJson, notes } = body;

    // Verify appointment exists in the caller's salon
    const appointment = await forSalon(salonId).findOne(appointments, id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Zapis zabiegu kończy wizytę, a nieobecność nie może być naraz
    // zrealizowaną usługą — najpierw cofnięcie oznaczenia (jak w /complete).
    if (appointment.status === NO_SHOW_STATUS) {
      return noShowConflictResponse();
    }

    // Upsert rekordu zabiegu + auto-complete wizyty atomowo w transakcji RLS.
    const { treatment, existing } = await forSalon(salonId).raw(async (tx) => {
      // Check if treatment record already exists for this appointment
      const [existingRow] = await tx
        .select()
        .from(treatmentHistory)
        .where(eq(treatmentHistory.appointmentId, id))
        .limit(1);

      let row;

      if (existingRow) {
        // Update existing treatment record
        const updateData: Record<string, unknown> = {};
        if (recipe !== undefined) updateData.recipe = recipe;
        if (techniques !== undefined) updateData.techniques = techniques;
        if (materialsJson !== undefined) updateData.materialsJson = materialsJson;
        if (notes !== undefined) updateData.notes = notes;

        [row] = await tx
          .update(treatmentHistory)
          .set(updateData)
          .where(eq(treatmentHistory.id, existingRow.id))
          .returning();

        logger.info(`[Treatment API] Updated treatment record for appointment ${id}`);
      } else {
        // Create new treatment record
        [row] = await tx
          .insert(treatmentHistory)
          .values({
            appointmentId: id,
            recipe: recipe || null,
            techniques: techniques || null,
            materialsJson: materialsJson || [],
            notes: notes || null,
          })
          .returning();

        logger.info(`[Treatment API] Created treatment record for appointment ${id}`);
      }

      // If status is still "scheduled" or "confirmed", mark as "completed" automatically
      if (appointment.status === "scheduled" || appointment.status === "confirmed") {
        // Odczyt wyżej jest poza transakcją, a trasa „Nie przyszedł” zmienia
        // status pod blokadą wiersza. UPDATE czeka na tę blokadę i sprawdza
        // warunek statusu ponownie, więc nie nadpisze oznaczenia.
        const [completed] = await tx
          .update(appointments)
          .set({ status: "completed" })
          .where(
            and(
              eq(appointments.id, id),
              eq(appointments.salonId, salonId),
              notInArray(appointments.status, NOT_AUTO_COMPLETABLE_STATUSES)
            )
          )
          .returning({ id: appointments.id });

        if (completed) {
          logger.info(`[Treatment API] Auto-marked appointment ${id} as completed`);
        } else {
          // Bieżący status z tej samej transakcji. „Nie przyszedł” → 409 i
          // wycofanie zapisu zabiegu. Równoległe zakończenie albo anulowanie
          // → zabieg zostaje zapisany jak przy wizycie już w tym stanie.
          const [current] = await tx
            .select({ status: appointments.status })
            .from(appointments)
            .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
            .limit(1);
          if (current?.status === NO_SHOW_STATUS) {
            throw new TreatmentOnNoShowError();
          }
        }
      }

      return { treatment: row, existing: !!existingRow };
    });

    return NextResponse.json({
      success: true,
      data: treatment,
      message: existing ? "Treatment record updated" : "Treatment record created",
    }, { status: existing ? 200 : 201 });
  } catch (error) {
    if (error instanceof TreatmentOnNoShowError) {
      return noShowConflictResponse();
    }
    logger.error("[Treatment API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to save treatment record" },
      { status: 500 }
    );
  }
}

// DELETE /api/appointments/[id]/treatment - Delete treatment record
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // Verify the appointment belongs to the caller's salon before touching its treatment
    const appointment = await forSalon(salonId).findOne(appointments, id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    const [deleted] = await forSalon(salonId).raw((tx) =>
      tx
        .delete(treatmentHistory)
        .where(eq(treatmentHistory.appointmentId, id))
        .returning()
    );

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Treatment record not found" },
        { status: 404 }
      );
    }

    logger.info(`[Treatment API] Deleted treatment record for appointment ${id}`);

    return NextResponse.json({
      success: true,
      data: deleted,
      message: "Treatment record deleted",
    });
  } catch (error) {
    logger.error("[Treatment API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to delete treatment record" },
      { status: 500 }
    );
  }
}
