import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appointments, promotions, services, timeBlocks } from "@/lib/schema";
import { eq, and, not, lte, gte, or, lt, gt, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";

/**
 * POST /api/appointments/book-package
 * Book all services in a package promotion as sequential appointments
 *
 * Body:
 *   promotionId - ID of the package promotion
 *   employeeId - Employee to book with
 *   clientId - Optional client ID
 *   date - Booking date (YYYY-MM-DD)
 *   startTime - Start time for the first service (ISO string)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { promotionId, employeeId, clientId, startTime } = body;

    if (!promotionId || !employeeId || !startTime) {
      return NextResponse.json(
        { success: false, error: "promotionId, employeeId, and startTime are required" },
        { status: 400 }
      );
    }

    // Try to get logged-in user ID from session
    let bookedByUserId: string | null = null;
    try {
      const session = await auth.api.getSession({ headers: await headers() });
      if (session?.user?.id) {
        bookedByUserId = session.user.id;
      }
    } catch {
      // Not authenticated, that's ok for staff-created appointments
    }

    // 1. Get the package promotion
    const [promotion] = await db
      .select()
      .from(promotions)
      .where(eq(promotions.id, promotionId))
      .limit(1);

    if (!promotion) {
      return NextResponse.json(
        { success: false, error: "Promotion not found" },
        { status: 404 }
      );
    }

    if (promotion.type !== "package") {
      return NextResponse.json(
        { success: false, error: "Promotion is not a package type" },
        { status: 400 }
      );
    }

    if (!promotion.isActive) {
      return NextResponse.json(
        { success: false, error: "Package promotion is not active" },
        { status: 400 }
      );
    }

    // Check date validity
    const now = new Date();
    if (promotion.startDate && new Date(promotion.startDate) > now) {
      return NextResponse.json(
        { success: false, error: "Package promotion has not started yet" },
        { status: 400 }
      );
    }
    if (promotion.endDate && new Date(promotion.endDate) < now) {
      return NextResponse.json(
        { success: false, error: "Package promotion has expired" },
        { status: 400 }
      );
    }

    // 2. Get package service IDs from conditions
    const conditions = (promotion.conditionsJson as Record<string, unknown>) || {};
    const packageServiceIds = (conditions.packageServiceIds as string[]) || [];

    if (packageServiceIds.length < 2) {
      return NextResponse.json(
        { success: false, error: "Package must contain at least 2 services" },
        { status: 400 }
      );
    }

    // 3. Fetch all services in the package
    const packageServices = await db
      .select()
      .from(services)
      .where(inArray(services.id, packageServiceIds));

    if (packageServices.length !== packageServiceIds.length) {
      return NextResponse.json(
        { success: false, error: "One or more services in the package no longer exist" },
        { status: 400 }
      );
    }

    // Order services in same order as packageServiceIds
    const orderedServices = packageServiceIds
      .map((id) => packageServices.find((s) => s.id === id))
      .filter((s): s is typeof packageServices[0] => s !== undefined);

    // 4. Calculate sequential time slots for all services
    const packagePrice = parseFloat(promotion.value);
    const totalIndividualPrice = orderedServices.reduce(
      (sum, svc) => sum + parseFloat(svc.basePrice),
      0
    );
    const totalDuration = orderedServices.reduce(
      (sum, svc) => sum + svc.baseDuration,
      0
    );

    let currentStart = new Date(startTime);
    const appointmentSlots = orderedServices.map((svc) => {
      const start = new Date(currentStart);
      const end = new Date(start.getTime() + svc.baseDuration * 60000);
      currentStart = end; // Next service starts when this one ends
      return { service: svc, start, end };
    });

    // 5. Check for overlapping appointments for the entire duration
    const firstStart = appointmentSlots[0]!.start;
    const lastEnd = appointmentSlots[appointmentSlots.length - 1]!.end;

    const overlapping = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, employeeId),
          not(eq(appointments.status, "cancelled")),
          or(
            and(
              lte(appointments.startTime, firstStart),
              gte(appointments.endTime, firstStart)
            ),
            and(
              lte(appointments.startTime, lastEnd),
              gte(appointments.endTime, lastEnd)
            ),
            and(
              gte(appointments.startTime, firstStart),
              lte(appointments.endTime, lastEnd)
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

    // 6. Check for vacation/time blocks
    const conflictingBlocks = await db
      .select()
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.employeeId, employeeId),
          lt(timeBlocks.startTime, lastEnd),
          gt(timeBlocks.endTime, firstStart)
        )
      );

    if (conflictingBlocks.length > 0) {
      return NextResponse.json(
        { success: false, error: "Employee has time block during the requested period" },
        { status: 409 }
      );
    }

    // 7. Create all appointments
    const createdAppointments = [];
    const salonId = promotion.salonId;

    for (const slot of appointmentSlots) {
      const [newAppointment] = await db
        .insert(appointments)
        .values({
          salonId,
          clientId: clientId || null,
          employeeId,
          serviceId: slot.service.id,
          bookedByUserId,
          startTime: slot.start,
          endTime: slot.end,
          notes: `Pakiet: ${promotion.name} (${packagePrice.toFixed(2)} PLN)`,
          status: "scheduled",
        })
        .returning();

      if (newAppointment) {
        createdAppointments.push({
          ...newAppointment,
          serviceName: slot.service.name,
          servicePrice: slot.service.basePrice,
        });
      }
    }

    console.log(
      `[Package Booking API] Booked package "${promotion.name}" with ${createdAppointments.length} services. ` +
      `Package price: ${packagePrice.toFixed(2)} PLN (individual total: ${totalIndividualPrice.toFixed(2)} PLN). ` +
      `Savings: ${(totalIndividualPrice - packagePrice).toFixed(2)} PLN`
    );

    return NextResponse.json({
      success: true,
      data: {
        packageName: promotion.name,
        packagePrice,
        totalIndividualPrice: Math.round(totalIndividualPrice * 100) / 100,
        savings: Math.round((totalIndividualPrice - packagePrice) * 100) / 100,
        totalDuration,
        appointments: createdAppointments,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[Package Booking API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to book package" },
      { status: 500 }
    );
  }
}
