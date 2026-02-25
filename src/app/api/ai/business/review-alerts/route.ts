import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reviews, clients, employees, services, appointments } from "@/lib/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

/**
 * Severity classification for negative reviews.
 * - critical: 1-2 star reviews that require immediate attention
 * - warning: 3 star reviews that indicate areas for improvement
 */
type ReviewAlertSeverity = "critical" | "warning";

interface ReviewAlert {
  id: string;
  reviewId: string;
  rating: number;
  comment: string | null;
  clientName: string;
  employeeName: string;
  serviceName: string;
  appointmentDate: string | null;
  createdAt: string;
  severity: ReviewAlertSeverity;
  suggestedResponse: string;
  responseType: "ai" | "template";
}

/**
 * Returns a template-based response suggestion for a negative review.
 * Used as a fallback when AI generation is unavailable or fails.
 */
function getTemplateResponse(rating: number, clientName: string): string {
  if (rating <= 1) {
    return `Szanowny/a ${clientName}, bardzo przepraszamy za negatywne doswiadczenie. Zalezy nam na jakosci naszych uslug i chcielibysmy naprawic te sytuacje. Prosimy o kontakt - chetnie omowimy, jak mozemy to wynagrodzic.`;
  }
  if (rating <= 2) {
    return `Szanowny/a ${clientName}, dziekujemy za szczere opinie. Przykro nam, ze usluga nie spelnila Pana/Pani oczekiwan. Wezmemy Pana/Pani uwagi pod rozwage i dolozymy staran, aby poprawic jakosc. Zapraszamy do kontaktu.`;
  }
  // Rating 3
  return `Szanowny/a ${clientName}, dziekujemy za opinie. Doceniamy feedback i bedziemy pracowac nad poprawa w obszarach, ktore Pan/Pani wskazal/a. Mamy nadzieje na kolejna wizyte.`;
}

/**
 * Attempts to generate a professional response using AI.
 * Falls back to a template response if the AI call fails or the API key is missing.
 */
async function generateResponseSuggestion(
  review: {
    rating: number;
    comment: string | null;
    clientName: string;
    serviceName: string;
  },
  openrouterApiKey: string | undefined,
  modelId: string
): Promise<{ text: string; type: "ai" | "template" }> {
  // Fall back to template if no API key is configured
  if (!openrouterApiKey) {
    return {
      text: getTemplateResponse(review.rating, review.clientName),
      type: "template",
    };
  }

  try {
    const openrouter = createOpenRouter({
      apiKey: openrouterApiKey,
    });

    const { text } = await generateText({
      model: openrouter(modelId),
      maxOutputTokens: 300,
      system: [
        "Jestes asystentem salonu kosmetycznego/fryzjerskiego.",
        "Twoim zadaniem jest napisanie profesjonalnej, empatycznej odpowiedzi na negatywna opinie klienta.",
        "Odpowiedz musi byc w jezyku polskim, uprzejma i konstruktywna.",
        "Zachowaj dlugosc do 3 zdan.",
      ].join(" "),
      prompt: [
        `Klient: ${review.clientName}`,
        `Usluga: ${review.serviceName}`,
        `Ocena: ${review.rating}/5`,
        `Komentarz: ${review.comment || "(brak komentarza)"}`,
        "",
        "Napisz profesjonalna odpowiedz od wlasciciela salonu, ktora:",
        "- Odnosi sie do konkretnych uwag klienta (jesli podane)",
        "- Wyrazha empatia i przeprosiny",
        "- Proponuje rozwiazanie lub zaprasza do kontaktu",
      ].join("\n"),
    });

    return { text, type: "ai" };
  } catch (error) {
    console.error("[Review Alerts] AI generation failed, using template:", error);
    return {
      text: getTemplateResponse(review.rating, review.clientName),
      type: "template",
    };
  }
}

export async function GET(_request: Request) {
  // Auth check and resolve salon
  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Pro plan check
  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro." },
      { status: 403 }
    );
  }

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Query negative reviews (rating <= 3) from the last 30 days,
    // joining with clients, employees, services, and appointments
    // to provide full context for each alert.
    const negativeReviews = await db
      .select({
        reviewId: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        reviewCreatedAt: reviews.createdAt,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
        appointmentStartTime: appointments.startTime,
      })
      .from(reviews)
      .leftJoin(clients, eq(reviews.clientId, clients.id))
      .leftJoin(employees, eq(reviews.employeeId, employees.id))
      .leftJoin(appointments, eq(reviews.appointmentId, appointments.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(reviews.salonId, salonId),
          lte(reviews.rating, 3),
          gte(reviews.createdAt, thirtyDaysAgo)
        )
      )
      .orderBy(desc(reviews.createdAt))
      .limit(5);

    const totalNegativeReviewsResult = await db
      .select({
        reviewId: reviews.id,
      })
      .from(reviews)
      .where(
        and(
          eq(reviews.salonId, salonId),
          lte(reviews.rating, 3),
          gte(reviews.createdAt, thirtyDaysAgo)
        )
      );

    const totalNegativeReviews = totalNegativeReviewsResult.length;

    // Read AI configuration once for all generations
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    const modelId = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4";

    // Generate response suggestions for all reviews in parallel
    const responseResults = await Promise.allSettled(
      negativeReviews.map((review) => {
        const clientName = [review.clientFirstName, review.clientLastName]
          .filter(Boolean)
          .join(" ") || "Kliencie";
        const serviceName = review.serviceName || "usluga";

        return generateResponseSuggestion(
          {
            rating: review.rating!,
            comment: review.comment,
            clientName,
            serviceName,
          },
          openrouterApiKey,
          modelId
        );
      })
    );

    // Build the alerts array by combining review data with generated responses
    const alerts: ReviewAlert[] = negativeReviews.map((review, index) => {
      const clientName = [review.clientFirstName, review.clientLastName]
        .filter(Boolean)
        .join(" ") || "Nieznany klient";
      const employeeName = [review.employeeFirstName, review.employeeLastName]
        .filter(Boolean)
        .join(" ") || "Nieprzypisany";
      const serviceName = review.serviceName || "Nieokreslona";

      // Extract the response from Promise.allSettled result
      const responseResult = responseResults[index] as
        | PromiseSettledResult<{ text: string; type: "ai" | "template" }>
        | undefined;
      let suggestedResponse: string;
      let responseType: "ai" | "template";

      if (responseResult && responseResult.status === "fulfilled") {
        suggestedResponse = responseResult.value.text;
        responseType = responseResult.value.type;
      } else {
        // If the promise was rejected or result is missing, fall back to template
        suggestedResponse = getTemplateResponse(review.rating!, clientName);
        responseType = "template";
      }

      const severity: ReviewAlertSeverity =
        review.rating !== null && review.rating <= 2 ? "critical" : "warning";

      return {
        id: `review-alert-${review.reviewId}`,
        reviewId: review.reviewId,
        rating: review.rating!,
        comment: review.comment,
        clientName,
        employeeName,
        serviceName,
        appointmentDate: review.appointmentStartTime
          ? review.appointmentStartTime.toISOString()
          : null,
        createdAt: review.reviewCreatedAt.toISOString(),
        severity,
        suggestedResponse,
        responseType,
      };
    });

    return NextResponse.json({
      success: true,
      alerts,
      totalNegativeReviews,
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[AI Review Alerts] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate review alerts" },
      { status: 500 }
    );
  }
}
