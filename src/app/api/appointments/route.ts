import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appointments, clients, employees, services, timeBlocks, promoCodes, promotions } from "@/lib/schema";
import { eq, and, gte, lte, or, not, lt, gt, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { validateBody, createAppointmentSchema } from "@/lib/api-validation";

// GET /api/appointments - List appointments with optional date range filter
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const salonId = searchParams.get("salonId");
    const employeeId = searchParams.get("employeeId");

    console.log("[Appointments API] GET with params:", { startDate, endDate, salonId, employeeId });

    let query = db.select({
      appointment: appointments,
      client: clients,
      employee: employees,
      service: services,
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(employees, eq(appointments.employeeId, employees.id))
    .leftJoin(services, eq(appointments.serviceId, services.id));

    const conditions = [];

    if (salonId) {
      conditions.push(eq(appointments.salonId, salonId));
    }
    if (employeeId) {
      conditions.push(eq(appointments.employeeId, employeeId));
    }
    if (startDate) {
      conditions.push(gte(appointments.startTime, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(appointments.endTime, new Date(endDate)));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const result = await query;
    console.log(`[Appointments API] Query returned ${result.length} rows`);

    // Transform result to a cleaner format
    const formattedAppointments = result.map((row) => ({
      ...row.appointment,
      client: row.client,
      employee: row.employee,
      service: row.service,
    }));

    return NextResponse.json({
      success: true,
      data: formattedAppointments,
      count: formattedAppointments.length,
    });
  } catch (error) {
    console.error("[Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}

// POST /api/appointments - Create a new appointment
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salonId, clientId, employeeId, serviceId, startTime, endTime, notes, depositAmount, bookedByUserId: bodyUserId, promoCodeId, discountAmount } = body;

    // Try to get logged-in user ID from session (for client portal bookings)
    let bookedByUserId: string | null = bodyUserId || null;
    if (!bookedByUserId) {
      try {
        const session = await auth.api.getSession({ headers: await headers() });
        if (session?.user?.id) {
          bookedByUserId = session.user.id;
        }
      } catch {
        // Not authenticated, that's ok for staff-created appointments
      }
    }

    // Server-side validation with Zod schema
    const validationError = validateBody(createAppointmentSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    // Check for overlapping appointments for this employee
    const overlapping = await db.select()
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, employeeId),
          not(eq(appointments.status, "cancelled")),
          or(
            and(
              lte(appointments.startTime, new Date(startTime)),
              gte(appointments.endTime, new Date(startTime))
            ),
            and(
              lte(appointments.startTime, new Date(endTime)),
              gte(appointments.endTime, new Date(endTime))
            ),
            and(
              gte(appointments.startTime, new Date(startTime)),
              lte(appointments.endTime, new Date(endTime))
            )
          )
        )
      );

    if (overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: "Time slot conflicts with existing appointment" },
        { status: 409 }
      );
    }

    // Check for vacation/time blocks that overlap with the requested time
    const conflictingBlocks = await db.select()
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.employeeId, employeeId),
          // Time block overlaps with requested appointment time
          lt(timeBlocks.startTime, new Date(endTime)),
          gt(timeBlocks.endTime, new Date(startTime))
        )
      );

    if (conflictingBlocks.length > 0) {
      const block = conflictingBlocks[0];
      const blockTypeLabels: Record<string, string> = {
        vacation: "urlop",
        holiday: "dzien wolny",
        break: "przerwa",
        personal: "czas osobisty",
        other: "blokada czasu",
      };
      const label = block ? (blockTypeLabels[block.blockType] || block.blockType) : "blokada czasu";
      return NextResponse.json(
        { success: false, error: `Pracownik ma ${label} w tym terminie${block?.reason ? ` (${block.reason})` : ""}` },
        { status: 409 }
      );
    }

    // Validate promo code if provided
    let validatedPromoCodeId: string | null = null;
    let validatedDiscountAmount: string | null = null;

    if (promoCodeId) {
      // Verify the promo code exists and is valid
      const [promoCode] = await db
        .select({
          promoCode: promoCodes,
          promotion: promotions,
        })
        .from(promoCodes)
        .leftJoin(promotions, eq(promoCodes.promotionId, promotions.id))
        .where(eq(promoCodes.id, promoCodeId))
        .limit(1);

      if (!promoCode) {
        return NextResponse.json(
          { success: false, error: "Nieprawidlowy kod promocyjny" },
          { status: 400 }
        );
      }

      const now = new Date();
      const pc = promoCode.promoCode;

      // Check expiry
      if (pc.expiresAt && new Date(pc.expiresAt) < now) {
        return NextResponse.json(
          { success: false, error: "Kod promocyjny wygasl" },
          { status: 400 }
        );
      }

      // Check usage limit
      if (pc.usageLimit != null && pc.usedCount != null && pc.usedCount >= pc.usageLimit) {
        return NextResponse.json(
          { success: false, error: "Limit uzycia kodu promocyjnego zostal wyczerpany" },
          { status: 400 }
        );
      }

      // Check linked promotion is active
      if (promoCode.promotion && !promoCode.promotion.isActive) {
        return NextResponse.json(
          { success: false, error: "Promocja powiazana z kodem jest nieaktywna" },
          { status: 400 }
        );
      }

      validatedPromoCodeId = promoCodeId;
      validatedDiscountAmount = discountAmount ? String(discountAmount) : null;
    }

    console.log(`[Appointments API] Creating appointment for employee ${employeeId}, bookedBy: ${bookedByUserId}, promoCode: ${validatedPromoCodeId}`);
    const [newAppointment] = await db
      .insert(appointments)
      .values({
        salonId,
        clientId: clientId || null,
        employeeId,
        serviceId: serviceId || null,
        bookedByUserId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        notes: notes || null,
        depositAmount: depositAmount || null,
        promoCodeId: validatedPromoCodeId,
        discountAmount: validatedDiscountAmount,
        status: "scheduled",
      })
      .returning();

    // Increment promo code usage count
    if (validatedPromoCodeId) {
      await db
        .update(promoCodes)
        .set({ usedCount: sql`COALESCE(${promoCodes.usedCount}, 0) + 1` })
        .where(eq(promoCodes.id, validatedPromoCodeId));
      console.log(`[Appointments API] Incremented usage count for promo code ${validatedPromoCodeId}`);
    }

    console.log(`[Appointments API] Created appointment with id: ${newAppointment?.id}`);

    return NextResponse.json({
      success: true,
      data: newAppointment,
    }, { status: 201 });
  } catch (error) {
    console.error("[Appointments API] Database error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create appointment" },
      { status: 500 }
    );
  }
}
