import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appointments, reviews } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { validateBody, clientReviewSchema } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
// GET /api/client/appointments/[id]/review - Check if a review exists for this appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;
    const { id } = await params;

    // Verify the appointment belongs to this user
    const appointmentResult = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.bookedByUserId, userId)
        )
      )
      .limit(1);

    if (!appointmentResult[0]) {
      return NextResponse.json(
        { success: false, error: "Wizyta nie zostala znaleziona" },
        { status: 404 }
      );
    }

    // Look for an existing review for this appointment
    const existingReview = await db
      .select()
      .from(reviews)
      .where(eq(reviews.appointmentId, id))
      .limit(1);

    const review = existingReview[0] || null;

    return NextResponse.json({
      success: true,
      data: review,
    });
  } catch (error) {
    logger.error("[Client Review API] GET Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac opinii" },
      { status: 500 }
    );
  }
}

// POST /api/client/appointments/[id]/review - Submit a new review for a completed appointment
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const userId = authResult.user.id;
    const { id } = await params;

    // Parse and validate request body
    const body = await request.json();
    const validationError = validateBody(clientReviewSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }
    const { rating, comment } = body;

    // Rating is optional (null for text-only reviews), but if provided must be 1-5
    const hasRating = rating !== null && rating !== undefined && rating !== 0;
    const hasComment = typeof comment === "string" && comment.trim().length > 0;

    if (!hasRating && !hasComment) {
      return NextResponse.json(
        { success: false, error: "Musisz podac ocene lub komentarz" },
        { status: 400 }
      );
    }

    if (hasRating && (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return NextResponse.json(
        { success: false, error: "Ocena musi byc liczba calkowita od 1 do 5" },
        { status: 400 }
      );
    }

    // Fetch the appointment and verify ownership
    const appointmentResult = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.bookedByUserId, userId)
        )
      )
      .limit(1);

    const appointment = appointmentResult[0];
    if (!appointment) {
      return NextResponse.json(
        { success: false, error: "Wizyta nie zostala znaleziona" },
        { status: 404 }
      );
    }

    // Verify the appointment is completed
    if (appointment.status !== "completed") {
      return NextResponse.json(
        { success: false, error: "Opinie mozna wystawiac tylko dla zakoczonych wizyt" },
        { status: 400 }
      );
    }

    // Check if a review already exists for this appointment
    const existingReview = await db
      .select()
      .from(reviews)
      .where(eq(reviews.appointmentId, id))
      .limit(1);

    if (existingReview[0]) {
      return NextResponse.json(
        { success: false, error: "Opinia dla tej wizyty zostala juz wystawiona" },
        { status: 409 }
      );
    }

    // Insert the new review with salonId and employeeId from the appointment
    const [newReview] = await db
      .insert(reviews)
      .values({
        salonId: appointment.salonId,
        employeeId: appointment.employeeId,
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        rating: hasRating ? rating : null,
        comment: hasComment ? comment.trim() : null,
        status: "pending",
      })
      .returning();

    logger.info(`[Client Review API] User ${userId} submitted review for appointment ${id}`,
      { rating: hasRating ? rating : null, hasComment, reviewId: newReview?.id });

    return NextResponse.json({
      success: true,
      data: newReview,
      message: "Opinia zostala dodana pomyslnie",
    });
  } catch (error) {
    logger.error("[Client Review API] POST Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie dodac opinii" },
      { status: 500 }
    );
  }
}
