import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reviews, salons } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// PATCH /api/reviews/[id]/respond - Save owner response to a review
export async function PATCH(
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
    const { id: reviewId } = await params;

    // Parse request body
    const body = await request.json();
    const { response } = body;

    if (!response || typeof response !== "string" || response.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Odpowiedz nie moze byc pusta" },
        { status: 400 }
      );
    }

    if (response.trim().length > 2000) {
      return NextResponse.json(
        { success: false, error: "Odpowiedz nie moze byc dluzsza niz 2000 znakow" },
        { status: 400 }
      );
    }

    // Find the salon owned by the current user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, userId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Find the review and verify it belongs to the owner's salon
    const [review] = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.salonId, salon.id)
        )
      )
      .limit(1);

    if (!review) {
      return NextResponse.json(
        { success: false, error: "Opinia nie zostala znaleziona" },
        { status: 404 }
      );
    }

    // Save the owner response
    const [updatedReview] = await db
      .update(reviews)
      .set({
        ownerResponse: response.trim(),
        ownerResponseAt: new Date(),
      })
      .where(eq(reviews.id, reviewId))
      .returning();

    console.log(
      `[Reviews API] Owner response saved for review ${reviewId} by user ${userId} (salon ${salon.id})`
    );

    return NextResponse.json({
      success: true,
      data: updatedReview,
      message: "Odpowiedz zostala zapisana",
    });
  } catch (error) {
    console.error("[Reviews API] PATCH Respond Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zapisac odpowiedzi" },
      { status: 500 }
    );
  }
}

// DELETE /api/reviews/[id]/respond - Remove owner response from a review
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

    const userId = session.user.id;
    const { id: reviewId } = await params;

    // Find the salon owned by the current user
    const [salon] = await db
      .select()
      .from(salons)
      .where(eq(salons.ownerId, userId))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Find the review and verify it belongs to the owner's salon
    const [review] = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.salonId, salon.id)
        )
      )
      .limit(1);

    if (!review) {
      return NextResponse.json(
        { success: false, error: "Opinia nie zostala znaleziona" },
        { status: 404 }
      );
    }

    // Remove the owner response
    const [updatedReview] = await db
      .update(reviews)
      .set({
        ownerResponse: null,
        ownerResponseAt: null,
      })
      .where(eq(reviews.id, reviewId))
      .returning();

    console.log(
      `[Reviews API] Owner response removed for review ${reviewId} by user ${userId} (salon ${salon.id})`
    );

    return NextResponse.json({
      success: true,
      data: updatedReview,
      message: "Odpowiedz zostala usunieta",
    });
  } catch (error) {
    console.error("[Reviews API] DELETE Respond Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie usunac odpowiedzi" },
      { status: 500 }
    );
  }
}
