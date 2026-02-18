import { headers } from "next/headers";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { salons, reviews, clients, employees, services, appointments } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

const requestSchema = z.object({
  reviewId: z.string().uuid("Nieprawidlowe ID opinii"),
});

const INDUSTRY_LABELS: Record<string, string> = {
  hair_salon: "salon fryzjerski",
  beauty_salon: "salon kosmetyczny",
  medical: "gabinet medyczny / klinika",
  barber: "barber shop",
  spa: "salon SPA / wellness",
  nail_salon: "salon paznokci / manicure",
};

export async function POST(req: Request) {
  // Verify authentication
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check Pro plan
  const hasPro = await isProPlan();
  if (!hasPro) {
    return Response.json(
      {
        error: "Funkcje AI sa dostepne tylko w Planie Pro.",
        code: "PLAN_UPGRADE_REQUIRED",
      },
      { status: 403 }
    );
  }

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

  // Check OpenRouter API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OpenRouter API key not configured" },
      { status: 500 }
    );
  }

  // Fetch the review with related data
  const [reviewData] = await db
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
        eq(reviews.salonId, DEMO_SALON_ID)
      )
    )
    .limit(1);

  if (!reviewData) {
    return Response.json(
      { error: "Opinia nie zostala znaleziona" },
      { status: 404 }
    );
  }

  const review = reviewData.review;
  const clientName = reviewData.client
    ? `${reviewData.client.firstName} ${reviewData.client.lastName}`
    : "Klient";
  const employeeName = reviewData.employee
    ? `${reviewData.employee.firstName} ${reviewData.employee.lastName}`
    : null;
  const serviceName = reviewData.service?.name || null;

  // Fetch salon info for context
  let salonName = "Salon";
  let industryLabel = "salon uslugowy";
  try {
    const salonInfo = await db
      .select({ name: salons.name, industryType: salons.industryType })
      .from(salons)
      .where(eq(salons.id, DEMO_SALON_ID))
      .then((r) => r[0]);

    if (salonInfo) {
      salonName = salonInfo.name;
      const iType = salonInfo.industryType;
      if (iType && INDUSTRY_LABELS[iType]) {
        industryLabel = INDUSTRY_LABELS[iType];
      }
    }
  } catch (error) {
    console.error("[AI Content] Error fetching salon info:", error);
  }

  // Build context about the review
  const contextParts: string[] = [];
  contextParts.push(`Ocena: ${review.rating ? `${review.rating}/5 gwiazdek` : "brak oceny"}`);
  if (review.comment) {
    contextParts.push(`Komentarz klienta: "${review.comment}"`);
  } else {
    contextParts.push("Klient nie pozostawil komentarza (tylko ocena)");
  }
  contextParts.push(`Imie klienta: ${clientName}`);
  if (employeeName) contextParts.push(`Pracownik: ${employeeName}`);
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
- Zwroc sie do klienta po imieniu (uzyj pierwszego imienia)
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
    const openrouter = createOpenRouter({ apiKey });

    const result = await generateText({
      model: openrouter(
        process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4"
      ),
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

    console.log(
      `[AI Content] Generated review response for review ${reviewId} (rating: ${review.rating})`
    );

    return Response.json({
      success: true,
      response,
      reviewId,
      tone: !review.rating || review.rating >= 4 ? "positive" : review.rating === 3 ? "neutral" : "negative",
    });
  } catch (error) {
    console.error("[AI Content] Error generating review response:", error);
    return Response.json(
      { error: "Blad podczas generowania odpowiedzi. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
