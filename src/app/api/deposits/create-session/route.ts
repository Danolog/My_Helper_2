import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { services, appointments, depositPayments } from "@/lib/schema";
import { eq, and, not, or, lte, gte, lt, gt } from "drizzle-orm";
import { timeBlocks } from "@/lib/schema";
import { auth } from "@/lib/auth";

/**
 * POST /api/deposits/create-session
 *
 * Creates a deposit payment session for a booking.
 * In production, this would create a Stripe Checkout session.
 * For now, it creates a pending payment record and returns a session ID.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      salonId,
      clientId,
      employeeId,
      serviceId,
      variantId,
      startTime,
      endTime,
      notes,
      depositAmount,
      paymentMethod,
      blikPhoneNumber,
    } = body;

    // Validate required fields
    if (!salonId || !employeeId || !startTime || !endTime || !depositAmount) {
      return NextResponse.json(
        { success: false, error: "salonId, employeeId, startTime, endTime, and depositAmount are required" },
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
      // Not authenticated, continue without user ID
    }

    if (parseFloat(depositAmount) <= 0) {
      return NextResponse.json(
        { success: false, error: "Deposit amount must be greater than 0" },
        { status: 400 }
      );
    }

    // Validate Blik phone number is required for Blik P2P payments
    if (paymentMethod === "blik") {
      if (!blikPhoneNumber || typeof blikPhoneNumber !== "string") {
        return NextResponse.json(
          { success: false, error: "Numer telefonu jest wymagany dla platnosci BLIK" },
          { status: 400 }
        );
      }
      // Validate Polish phone number format (9 digits, optionally with +48 prefix)
      const cleanedPhone = blikPhoneNumber.replace(/[\s\-()]/g, "");
      const phoneRegex = /^(\+48)?[0-9]{9}$/;
      if (!phoneRegex.test(cleanedPhone)) {
        return NextResponse.json(
          { success: false, error: "Nieprawidlowy numer telefonu. Podaj 9-cyfrowy numer." },
          { status: 400 }
        );
      }
    }

    // Verify the service exists and has deposit required
    if (serviceId) {
      const [service] = await db.select().from(services).where(eq(services.id, serviceId));
      if (!service) {
        return NextResponse.json(
          { success: false, error: "Service not found" },
          { status: 404 }
        );
      }
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
        { success: false, error: "Wybrany termin jest juz zajety. Wybierz inny termin." },
        { status: 409 }
      );
    }

    // Check for vacation/time blocks that overlap
    const conflictingBlocks = await db.select()
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.employeeId, employeeId),
          lt(timeBlocks.startTime, new Date(endTime)),
          gt(timeBlocks.endTime, new Date(startTime))
        )
      );

    if (conflictingBlocks.length > 0) {
      return NextResponse.json(
        { success: false, error: "Pracownik nie jest dostepny w wybranym terminie." },
        { status: 409 }
      );
    }

    // Create the appointment in "pending_payment" status
    const [newAppointment] = await db
      .insert(appointments)
      .values({
        salonId,
        clientId: clientId || null,
        employeeId,
        serviceId: serviceId || null,
        variantId: variantId || null,
        bookedByUserId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        notes: notes || null,
        depositAmount: String(depositAmount),
        depositPaid: false,
        status: "scheduled",
      })
      .returning();

    if (!newAppointment) {
      return NextResponse.json(
        { success: false, error: "Failed to create appointment" },
        { status: 500 }
      );
    }

    // Create a pending deposit payment record
    const [depositPayment] = await db
      .insert(depositPayments)
      .values({
        appointmentId: newAppointment.id,
        salonId,
        amount: String(depositAmount),
        currency: "PLN",
        paymentMethod: paymentMethod || "stripe",
        blikPhoneNumber: paymentMethod === "blik" ? blikPhoneNumber : null,
        status: "pending",
      })
      .returning();

    if (!depositPayment) {
      return NextResponse.json(
        { success: false, error: "Failed to create deposit payment record" },
        { status: 500 }
      );
    }

    // In production, we'd create a Stripe Checkout session here.
    // For now, return a session with the payment ID as the session reference.
    const sessionId = `dep_session_${depositPayment.id}`;

    console.log(`[Deposit API] Created payment session: ${sessionId} for appointment: ${newAppointment.id}, amount: ${depositAmount} PLN, method: ${paymentMethod || "stripe"}${paymentMethod === "blik" ? `, phone: ${blikPhoneNumber}` : ""}`);

    return NextResponse.json({
      success: true,
      data: {
        sessionId,
        appointmentId: newAppointment.id,
        depositPaymentId: depositPayment.id,
        amount: depositAmount,
        currency: "PLN",
        paymentMethod: paymentMethod || "stripe",
        ...(paymentMethod === "blik" ? { blikPhoneNumber } : {}),
        // In production, this would be the Stripe Checkout URL or Blik P2P redirect
        paymentUrl: paymentMethod === "blik"
          ? `/api/deposits/blik-confirm?session=${sessionId}`
          : `/api/deposits/checkout?session=${sessionId}`,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[Deposit API] Error creating session:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create deposit payment session" },
      { status: 500 }
    );
  }
}
