import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  appointments,
  treatmentHistory,
  employeeCommissions,
  services,
  employeeServicePrices,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";

// POST /api/appointments/[id]/complete - Complete an appointment with treatment notes and commission
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { recipe, techniques, notes, commissionPercentage } = body;

    // Fetch the appointment with service info
    const result = await db
      .select({
        appointment: appointments,
        service: services,
      })
      .from(appointments)
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(eq(appointments.id, id))
      .limit(1);

    const row = result[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Appointment not found" },
        { status: 404 }
      );
    }

    const appointment = row.appointment;
    const service = row.service;

    // Don't allow completing already completed or cancelled appointments
    if (appointment.status === "completed") {
      return NextResponse.json(
        { success: false, error: "Wizyta jest juz zakonczona" },
        { status: 400 }
      );
    }
    if (appointment.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Nie mozna zakonczyc anulowanej wizyty" },
        { status: 400 }
      );
    }

    // 1. Save or update treatment record
    const [existingTreatment] = await db
      .select()
      .from(treatmentHistory)
      .where(eq(treatmentHistory.appointmentId, id))
      .limit(1);

    let treatment;
    if (existingTreatment) {
      const updateData: Record<string, unknown> = {};
      if (recipe !== undefined) updateData.recipe = recipe;
      if (techniques !== undefined) updateData.techniques = techniques;
      if (notes !== undefined) updateData.notes = notes;

      [treatment] = await db
        .update(treatmentHistory)
        .set(updateData)
        .where(eq(treatmentHistory.id, existingTreatment.id))
        .returning();
    } else {
      [treatment] = await db
        .insert(treatmentHistory)
        .values({
          appointmentId: id,
          recipe: recipe || null,
          techniques: techniques || null,
          materialsJson: [],
          notes: notes || null,
        })
        .returning();
    }

    console.log(
      `[Complete API] ${existingTreatment ? "Updated" : "Created"} treatment record for appointment ${id}`
    );

    // 2. Mark appointment as completed
    const [updatedAppointment] = await db
      .update(appointments)
      .set({ status: "completed" })
      .where(eq(appointments.id, id))
      .returning();

    console.log(`[Complete API] Marked appointment ${id} as completed`);

    // 3. Calculate and record commission
    let commission = null;
    const commPct =
      commissionPercentage !== undefined && commissionPercentage !== null
        ? parseFloat(commissionPercentage)
        : 50; // Default 50% commission

    if (service && appointment.employeeId) {
      // Determine effective service price
      // Check for employee-specific pricing first
      let effectivePrice = parseFloat(service.basePrice);

      const [employeePrice] = await db
        .select()
        .from(employeeServicePrices)
        .where(
          and(
            eq(employeeServicePrices.employeeId, appointment.employeeId),
            eq(employeeServicePrices.serviceId, service.id)
          )
        )
        .limit(1);

      if (employeePrice) {
        effectivePrice = parseFloat(employeePrice.customPrice);
      }

      const commissionAmount = (effectivePrice * commPct) / 100;

      // Check if commission already exists for this appointment
      const [existingCommission] = await db
        .select()
        .from(employeeCommissions)
        .where(eq(employeeCommissions.appointmentId, id))
        .limit(1);

      if (existingCommission) {
        // Update existing commission
        [commission] = await db
          .update(employeeCommissions)
          .set({
            amount: commissionAmount.toFixed(2),
            percentage: commPct.toFixed(2),
          })
          .where(eq(employeeCommissions.id, existingCommission.id))
          .returning();
      } else {
        // Create new commission record
        [commission] = await db
          .insert(employeeCommissions)
          .values({
            employeeId: appointment.employeeId,
            appointmentId: id,
            amount: commissionAmount.toFixed(2),
            percentage: commPct.toFixed(2),
          })
          .returning();
      }

      console.log(
        `[Complete API] Commission: ${commPct}% of ${effectivePrice.toFixed(2)} PLN = ${commissionAmount.toFixed(2)} PLN for employee ${appointment.employeeId}`
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        appointment: updatedAppointment,
        treatment,
        commission,
      },
      message: "Wizyta zakonczona pomyslnie",
    });
  } catch (error) {
    console.error("[Complete API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to complete appointment" },
      { status: 500 }
    );
  }
}
