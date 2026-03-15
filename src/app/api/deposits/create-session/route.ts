import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { services, appointments, depositPayments } from "@/lib/schema";
import { eq, and, not, or, lte, gte, lt, gt } from "drizzle-orm";
import { timeBlocks } from "@/lib/schema";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, depositCreateSessionSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * POST /api/deposits/create-session
 *
 * Creates a deposit payment session for a booking.
 * In production, this would create a Stripe Checkout session.
 * For now, it creates a pending payment record and returns a session ID.
 */
export async function POST(request: Request) {
  // Rate limit: deposit payment creation is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const body = await request.json();
    const validationError = validateBody(depositCreateSessionSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
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

    const bookedByUserId = user.id;

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
      const [service] = await db.select({ id: services.id }).from(services).where(eq(services.id, serviceId));
      if (!service) {
        return NextResponse.json(
          { success: false, error: "Service not found" },
          { status: 404 }
        );
      }
    }

    // Check for overlapping appointments for this employee (only need id for existence check)
    const overlapping = await db.select({ id: appointments.id })
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

    // Check for vacation/time blocks that overlap (only need id for existence check)
    const conflictingBlocks = await db.select({ id: timeBlocks.id })
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

    logger.info("Deposit payment session created", {
      sessionId,
      appointmentId: newAppointment.id,
      amount: depositAmount,
      currency: "PLN",
      paymentMethod: paymentMethod || "stripe",
      ...(paymentMethod === "blik" ? { blikPhoneNumber } : {}),
    });

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
    logger.error("Deposit session creation failed", { error });
    return NextResponse.json(
      { success: false, error: "Failed to create deposit payment session" },
      { status: 500 }
    );
  }
}
