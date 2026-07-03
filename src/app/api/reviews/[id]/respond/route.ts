import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-handler";
import { validateBody, reviewRespondSchema } from "@/lib/api-validation";
import { auth } from "@/lib/auth";
import { getUserSalon } from "@/lib/get-user-salon";
import { logger } from "@/lib/logger";
import { reviews } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
// PATCH /api/reviews/[id]/respond - Save owner response to a review
export const PATCH = withApiHandler(
  {
    auth: "user",
    logLabel: "[Reviews API] PATCH Respond",
    errorMessage: "Nie udalo sie zapisac odpowiedzi",
  },
  async ({ request, params }) => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const reviewId = params.id!; // segment [id] zawsze obecny w trasie dynamicznej

    // Parse and validate request body
    // Walidacja pozostaje w handlerze (nie w opcji schema): oryginalna
    // kolejnosc krokow to sesja -> walidacja, a wrapper walidowalby wczesniej.
    const body = await request.json();

    const validationError = validateBody(reviewRespondSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    const { response } = body;

    // Find the salon owned by the current user
    const salon = await getUserSalon();

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Find the review and verify it belongs to the owner's salon
    const review = await forSalon(salon.id).findOne(reviews, reviewId);

    if (!review) {
      return NextResponse.json(
        { success: false, error: "Opinia nie zostala znaleziona" },
        { status: 404 }
      );
    }

    // Save the owner response
    const updatedReview = await forSalon(salon.id).updateOwned(reviews, reviewId, {
      ownerResponse: response.trim(),
      ownerResponseAt: new Date(),
    });

    logger.info(`[Reviews API] Owner response saved for review ${reviewId} by user ${userId} (salon ${salon.id})`);

    return NextResponse.json({
      success: true,
      data: updatedReview,
      message: "Odpowiedz zostala zapisana",
    });
  }
);

// DELETE /api/reviews/[id]/respond - Remove owner response from a review
export const DELETE = withApiHandler(
  {
    auth: "user",
    logLabel: "[Reviews API] DELETE Respond",
    errorMessage: "Nie udalo sie usunac odpowiedzi",
  },
  async ({ params }) => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Brak autoryzacji" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const reviewId = params.id!; // segment [id] zawsze obecny w trasie dynamicznej

    // Find the salon owned by the current user
    const salon = await getUserSalon();

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Nie znaleziono salonu dla tego uzytkownika" },
        { status: 403 }
      );
    }

    // Find the review and verify it belongs to the owner's salon
    const review = await forSalon(salon.id).findOne(reviews, reviewId);

    if (!review) {
      return NextResponse.json(
        { success: false, error: "Opinia nie zostala znaleziona" },
        { status: 404 }
      );
    }

    // Remove the owner response
    const updatedReview = await forSalon(salon.id).updateOwned(reviews, reviewId, {
      ownerResponse: null,
      ownerResponseAt: null,
    });

    logger.info(`[Reviews API] Owner response removed for review ${reviewId} by user ${userId} (salon ${salon.id})`);

    return NextResponse.json({
      success: true,
      data: updatedReview,
      message: "Odpowiedz zostala usunieta",
    });
  }
);
