import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { appointments, reviews } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/client/appointments/[id]/review - Check if a review exists for this appointment
export async function GET(
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

    const userId = session.user.id;
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
    console.error("[Client Review API] GET Error:", error);
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
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const { id } = await params;

    // Parse and validate request body
    const body = await request.json();
    const { rating, comment } = body;

    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
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
        rating,
        comment: comment || null,
        status: "pending",
      })
      .returning();

    console.log(
      `[Client Review API] User ${userId} submitted review for appointment ${id}`,
      { rating, reviewId: newReview?.id }
    );

    return NextResponse.json({
      success: true,
      data: newReview,
      message: "Opinia zostala dodana pomyslnie",
    });
  } catch (error) {
    console.error("[Client Review API] POST Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie dodac opinii" },
      { status: 500 }
    );
  }
}
