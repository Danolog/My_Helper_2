import { generateText } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { firstNameForReply, reviewCommentForModel } from "@/lib/ai/client-context";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { reviews, clients, employees, services, appointments } from "@/lib/schema";
import { frozenModuleResponse } from "@/lib/server/frozen-guard";
import { forSalon } from "@/lib/server/repository";

const requestSchema = z.object({
  reviewId: z.string().uuid("Nieprawidlowe ID opinii"),
});

/**
 * Opinia z powiązanymi danymi i kontekst salonu. Brak opinii w salonie daje
 * `null`; błąd bazy jest rzucany dalej.
 */
async function loadReviewContext(salonId: string, reviewId: string) {
  // Fetch the review with related data
  const [reviewData] = await forSalon(salonId).raw((tx) =>
    tx
      .select({
        review: reviews,
        client: clients,
        employee: employees,
        service: services,
        appointment: appointments,
      })
      .from(reviews)
      .leftJoin(clients, eq(reviews.clientId, clients.id))
      .leftJoin(employees, eq(reviews.employeeId, employees.id))
      .leftJoin(appointments, eq(reviews.appointmentId, appointments.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(reviews.id, reviewId),
          eq(reviews.salonId, salonId)
        )
      )
      .limit(1)
  );

  if (!reviewData) return null;

  const { salonName, industryLabel } = await getSalonContext(salonId);
  return { reviewData, salonName, industryLabel };
}

export async function POST(req: Request) {
  // Druga linia obrony zamrożenia (pierwsza: src/proxy.ts).
  const frozen = frozenModuleResponse("reviews");
  if (frozen) return frozen;

  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  // Parse request
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { reviewId } = parsed.data;

  // Odczyty z bazy; błąd = 500 bez wywołania modelu. Log zawiera tylko błąd,
  // bez treści opinii i danych klienta.
  let loaded: Awaited<ReturnType<typeof loadReviewContext>>;
  try {
    loaded = await loadReviewContext(salonId, reviewId);
  } catch (error) {
    logger.error("[AI Content] Error loading review data", { error: error });
    return Response.json(
      { error: "Blad podczas pobierania opinii. Sprobuj ponownie." },
      { status: 500 }
    );
  }

  if (!loaded) {
    return Response.json(
      { error: "Opinia nie zostala znaleziona" },
      { status: 404 }
    );
  }

  const { reviewData, salonName, industryLabel } = loaded;
  const review = reviewData.review;
  // Odpowiedź jest skierowana do klienta, więc do modelu trafia samo jego
  // pierwsze imię; pracownik też tylko z imienia. Nazwiska nie trafiają nigdy.
  const clientFirstName = firstNameForReply(reviewData.client);
  const employeeFirstName = firstNameForReply(reviewData.employee);
  const serviceName = reviewData.service?.name || null;

  // Bez imienia klienta model nie dostaje polecenia zwracania się po imieniu.
  const addressRule = clientFirstName
    ? "Zwroc sie do klienta po imieniu (uzyj pierwszego imienia)"
    : "Zwroc sie do klienta bez imienia - nie zgaduj i nie wymyslaj imienia";

  // Build context about the review
  const contextParts: string[] = [];
  contextParts.push(`Ocena: ${review.rating ? `${review.rating}/5 gwiazdek` : "brak oceny"}`);
  const reviewComment = reviewCommentForModel(review.comment);
  if (reviewComment) {
    contextParts.push(`Komentarz klienta: "${reviewComment}"`);
  } else {
    contextParts.push("Klient nie pozostawil komentarza (tylko ocena)");
  }
  if (clientFirstName) contextParts.push(`Imie klienta: ${clientFirstName}`);
  if (employeeFirstName) contextParts.push(`Pracownik: ${employeeFirstName}`);
  if (serviceName) contextParts.push(`Usluga: ${serviceName}`);

  // Determine tone based on rating
  let toneGuidance: string;
  if (!review.rating || review.rating >= 4) {
    toneGuidance = "Ton: Ciepły, wdzieczny, zachecajacy do ponownej wizyty. Podkresli, ze pozytywna opinia jest wazna dla salonu.";
  } else if (review.rating === 3) {
    toneGuidance = "Ton: Profesjonalny, wyrozumialy. Podziekuj za opinie, wyraz gotowość do poprawy i zapros do ponownej wizyty.";
  } else {
    toneGuidance = "Ton: Przepraszajacy, empatyczny, profesjonalny. Wyrazy szczere ubolewanie, podziekuj za opinie, obiecaj poprawe i zapros do kontaktu w celu rozwiazania problemu.";
  }

  const systemPrompt = `Jestes profesjonalnym menadzerem salonu "${salonName}" (${industryLabel}). Twoje zadanie to napisac odpowiedz na opinie klienta.

Zasady:
- Pisz TYLKO po polsku
- Napisz krotka odpowiedz (2-4 zdania)
- ${addressRule}
- ${toneGuidance}
- NIE uzywaj naglowkow, punktorow ani formatowania - sam czysty tekst
- NIE dodawaj tekstu typu "Odpowiedz:" na poczatku
- Jezeli opinia jest pozytywna, podziekuj i zachec do ponownej wizyty
- Jezeli opinia jest negatywna, przepros, wyraz zrozumienie i zaproponuj rozwiazanie
- Jezeli opinia jest neutralna, podziekuj i wyraz gotowość do poprawy
- Badz autentyczny i naturalny - unikaj szablonowych odpowiedzi
- Na koncu mozesz podpisac sie imieniem (np. "Pozdrawiam, Zespol ${salonName}")`;

  const userMessage = `Napisz odpowiedz na opinie klienta:\n\n${contextParts.join("\n")}`;

  try {
    const openrouter = createAIClient();

    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 500,
    });

    const response = result.text.trim();

    if (!response) {
      return Response.json(
        { error: "AI nie wygenerowalo odpowiedzi. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    logger.info(`[AI Content] Generated review response for review ${reviewId} (rating: ${review.rating})`);

    void trackAIUsage(salonId, "review_response");

    return Response.json({
      success: true,
      response,
      reviewId,
      tone: !review.rating || review.rating >= 4 ? "positive" : review.rating === 3 ? "neutral" : "negative",
    });
  } catch (error) {
    logger.error("[AI Content] Error generating review response", { error: error });
    return Response.json(
      { error: "Blad podczas generowania odpowiedzi. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
