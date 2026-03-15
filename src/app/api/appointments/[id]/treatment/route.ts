import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { treatmentHistory, appointments } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

// GET /api/appointments/[id]/treatment - Get treatment record for an appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    // Verify appointment exists
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Fetch treatment record for this appointment
    const [treatment] = await db
      .select()
      .from(treatmentHistory)
      .where(eq(treatmentHistory.appointmentId, id))
      .limit(1);

    console.log(`[Treatment API] GET treatment for appointment ${id}: ${treatment ? "found" : "not found"}`);

    return NextResponse.json({
      success: true,
      data: treatment || null,
    });
  } catch (error) {
    console.error("[Treatment API] Database error:", error);
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

    const { id } = await params;
    const body = await request.json();
    const { recipe, techniques, materialsJson, notes } = body;

    // Verify appointment exists
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    // Check if treatment record already exists for this appointment
    const [existing] = await db
      .select()
      .from(treatmentHistory)
      .where(eq(treatmentHistory.appointmentId, id))
      .limit(1);

    let treatment;

    if (existing) {
      // Update existing treatment record
      const updateData: Record<string, unknown> = {};
      if (recipe !== undefined) updateData.recipe = recipe;
      if (techniques !== undefined) updateData.techniques = techniques;
      if (materialsJson !== undefined) updateData.materialsJson = materialsJson;
      if (notes !== undefined) updateData.notes = notes;

      [treatment] = await db
        .update(treatmentHistory)
        .set(updateData)
        .where(eq(treatmentHistory.id, existing.id))
        .returning();

      console.log(`[Treatment API] Updated treatment record for appointment ${id}`);
    } else {
      // Create new treatment record
      [treatment] = await db
        .insert(treatmentHistory)
        .values({
          appointmentId: id,
          recipe: recipe || null,
          techniques: techniques || null,
          materialsJson: materialsJson || [],
          notes: notes || null,
        })
        .returning();

      console.log(`[Treatment API] Created treatment record for appointment ${id}`);
    }

    // If status is still "scheduled" or "confirmed", mark as "completed" automatically
    if (appointment.status === "scheduled" || appointment.status === "confirmed") {
      await db
        .update(appointments)
        .set({ status: "completed" })
        .where(eq(appointments.id, id));
      console.log(`[Treatment API] Auto-marked appointment ${id} as completed`);
    }

    return NextResponse.json({
      success: true,
      data: treatment,
      message: existing ? "Treatment record updated" : "Treatment record created",
    }, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error("[Treatment API] Database error:", error);
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

    const { id } = await params;

    const [deleted] = await db
      .delete(treatmentHistory)
      .where(eq(treatmentHistory.appointmentId, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Treatment record not found" },
        { status: 404 }
      );
    }

    console.log(`[Treatment API] Deleted treatment record for appointment ${id}`);

    return NextResponse.json({
      success: true,
      data: deleted,
      message: "Treatment record deleted",
    });
  } catch (error) {
    console.error("[Treatment API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete treatment record" },
      { status: 500 }
    );
  }
}
