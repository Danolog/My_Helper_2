import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reviews, salons } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

// PATCH /api/reviews/[id]/moderate - Approve or reject a review
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
    const { action } = body; // 'approve' or 'reject'

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { success: false, error: "Akcja musi byc 'approve' lub 'reject'" },
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

    // Update the review status
    const newStatus = action === "approve" ? "approved" : "rejected";
    const [updatedReview] = await db
      .update(reviews)
      .set({ status: newStatus })
      .where(eq(reviews.id, reviewId))
      .returning();

    console.log(
      `[Reviews Moderation API] Review ${reviewId} ${newStatus} by user ${userId} (salon ${salon.id})`
    );

    return NextResponse.json({
      success: true,
      data: updatedReview,
      message:
        action === "approve"
          ? "Opinia zostala zatwierdzona"
          : "Opinia zostala odrzucona",
    });
  } catch (error) {
    console.error("[Reviews Moderation API] PATCH Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zmoderować opinii" },
      { status: 500 }
    );
  }
}
