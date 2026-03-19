import { generateText } from "ai";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
} from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  appointments,
  clients,
  services,
  reviews,
  loyaltyPoints,
} from "@/lib/schema";

const requestSchema = z.object({
  clientId: z.string().uuid("Nieprawidlowy format ID klienta"),
});

export async function POST(req: Request) {
  // Combined auth + salon + Pro plan check
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const { clientId } = parsed.data;

  try {
    // Fetch client profile, scoped to the salon
    const [clientData] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
      .limit(1);

    if (!clientData) {
      return Response.json(
        { error: "Klient nie znaleziony" },
        { status: 404 },
      );
    }

    // Fetch aggregate appointment statistics
    // COUNT aggregation always returns a row, but TS doesn't know that, so provide a default
    const appointmentStats = await db
      .select({
        totalVisits: count(),
        completedVisits:
          sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'completed')`,
        cancelledVisits:
          sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'cancelled')`,
        noShowVisits:
          sql<number>`COUNT(*) FILTER (WHERE ${appointments.status} = 'no_show')`,
        firstVisit: sql<Date | null>`MIN(${appointments.startTime})`,
        lastVisit: sql<Date | null>`MAX(${appointments.startTime})`,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          eq(appointments.salonId, salonId),
        ),
      )
      .then((r) => r[0] ?? {
        totalVisits: 0,
        completedVisits: 0,
        cancelledVisits: 0,
        noShowVisits: 0,
        firstVisit: null,
        lastVisit: null,
      });

    // Fetch top services used by this client (completed visits only)
    const topServices = await db
      .select({
        serviceName: services.name,
        servicePrice: services.basePrice,
        visitCount: count(),
      })
      .from(appointments)
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(appointments.clientId, clientId),
          eq(appointments.salonId, salonId),
          eq(appointments.status, "completed"),
        ),
      )
      .groupBy(services.name, services.basePrice)
      .orderBy(desc(count()))
      .limit(5);

    // Fetch recent reviews left by this client
    const clientReviews = await db
      .select({
        rating: reviews.rating,
        comment: reviews.comment,
      })
      .from(reviews)
      .where(
        and(eq(reviews.clientId, clientId), eq(reviews.salonId, salonId)),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(5);

    // Fetch loyalty points balance (may not exist for this client)
    let loyaltyBalance = 0;
    try {
      const [loyaltyData] = await db
        .select({ points: loyaltyPoints.points })
        .from(loyaltyPoints)
        .where(
          and(
            eq(loyaltyPoints.clientId, clientId),
            eq(loyaltyPoints.salonId, salonId),
          ),
        )
        .limit(1);
      loyaltyBalance = loyaltyData ? Number(loyaltyData.points) : 0;
    } catch {
      // Table may not have data for this client — default to 0
    }

    // Calculate average spending from completed visits with service prices
    const [spendingData] = await db
      .select({
        totalSpent:
          sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        avgSpent:
          sql<string>`COALESCE(AVG(CAST(${services.basePrice} AS numeric)), 0)`,
      })
      .from(appointments)
      .innerJoin(services, eq(appointments.serviceId, services.id))
      .where(
        and(
          eq(appointments.clientId, clientId),
          eq(appointments.salonId, salonId),
          eq(appointments.status, "completed"),
        ),
      );

    const { salonName, industryLabel } = await getSalonContext(salonId);

    // Build context string for the AI prompt
    const contextParts: string[] = [];

    contextParts.push(`Salon: "${salonName}" (${industryLabel})`);
    contextParts.push(
      `Klient: ${clientData.firstName} ${clientData.lastName}`,
    );

    if (clientData.preferences) {
      contextParts.push(`Preferencje: ${clientData.preferences}`);
    }
    if (clientData.allergies) {
      contextParts.push(`Alergie: ${clientData.allergies}`);
    }
    if (clientData.birthday) {
      contextParts.push(`Urodziny: ${clientData.birthday}`);
    }

    contextParts.push(
      `\nSTATYSTYKI WIZYT:
- Laczna liczba wizyt: ${appointmentStats.totalVisits}
- Ukonczone: ${appointmentStats.completedVisits}
- Anulowane: ${appointmentStats.cancelledVisits}
- Nieobecnosci (no-show): ${appointmentStats.noShowVisits}
- Pierwsza wizyta: ${appointmentStats.firstVisit ? new Date(appointmentStats.firstVisit).toLocaleDateString("pl-PL") : "brak"}
- Ostatnia wizyta: ${appointmentStats.lastVisit ? new Date(appointmentStats.lastVisit).toLocaleDateString("pl-PL") : "brak"}`,
    );

    contextParts.push(
      `\nWYDATKI:
- Calkowite wydatki: ${parseFloat(spendingData?.totalSpent ?? "0").toFixed(2)} PLN
- Sredni wydatek na wizyte: ${parseFloat(spendingData?.avgSpent ?? "0").toFixed(2)} PLN`,
    );

    if (topServices.length > 0) {
      const servicesStr = topServices
        .map(
          (s, i) =>
            `  ${i + 1}. ${s.serviceName} - ${s.visitCount} wizyt (${s.servicePrice} PLN)`,
        )
        .join("\n");
      contextParts.push(`\nNAJCZESCIEJ WYBIERANE USLUGI:\n${servicesStr}`);
    } else {
      contextParts.push("\nNAJCZESCIEJ WYBIERANE USLUGI: Brak danych");
    }

    if (clientReviews.length > 0) {
      const reviewsStr = clientReviews
        .map(
          (r, i) =>
            `  ${i + 1}. Ocena: ${r.rating ?? "brak"}/5${r.comment ? ` - "${r.comment}"` : ""}`,
        )
        .join("\n");
      contextParts.push(`\nOPINIE KLIENTA:\n${reviewsStr}`);
    } else {
      contextParts.push("\nOPINIE KLIENTA: Klient nie wystawil jeszcze opinii");
    }

    contextParts.push(`\nPUNKTY LOJALNOSCIOWE: ${loyaltyBalance} pkt`);

    const systemPrompt = `Jestes analitykiem CRM w salonie "${salonName}" (${industryLabel}). Twoje zadanie to przeanalizowac dane klienta i zwrocic ustrukturyzowane wnioski.

Zwroc odpowiedz w formacie JSON (i TYLKO JSON, bez dodatkowego tekstu):
{
  "churnRisk": <liczba 1-10, gdzie 1 = bardzo niskie ryzyko odejscia, 10 = bardzo wysokie>,
  "spendingTrend": "<opis trendu wydatkow, np. 'Stabilne wydatki na poziomie 150 PLN/wizyte'>",
  "topServices": ["usluga 1", "usluga 2"],
  "visitFrequency": "<opis czestotliwosci wizyt, np. 'Regularnie co 4 tygodnie'>",
  "reengagementSuggestions": ["sugestia 1", "sugestia 2", "sugestia 3"],
  "summary": "<2-4 zdania podsumowujace profil klienta i kluczowe obserwacje>"
}

Zasady:
- Pisz TYLKO po polsku
- churnRisk: Ocen ryzyko odejscia na podstawie czestotliwosci wizyt, anulacji, no-show, czasu od ostatniej wizyty
- spendingTrend: Opisz trend wydatkow (rosnacy, stabilny, malejacy) na podstawie danych
- topServices: Lista najczesciej wybieranych uslug (maks 5)
- visitFrequency: Opisz jak czesto klient odwiedza salon
- reengagementSuggestions: 2-4 konkretne, praktyczne sugestie jak utrzymac/odzyskac klienta (np. wyslij SMS z rabatem, zaproponuj nowa usluge, przypomnienie o wizycie)
- summary: Zwiezle podsumowanie profilu klienta z kluczowymi wnioskami
- Bazuj TYLKO na dostarczonych danych, nie wymyslaj
- Jezeli brakuje danych, dostosuj swoja analize i zaznacz to w odpowiedzi
- Dzisiejsza data: ${new Date().toLocaleDateString("pl-PL")}`;

    const openrouter = createAIClient();
    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: contextParts.join("\n"),
      maxOutputTokens: 1200,
    });

    const responseText = result.text.trim();

    // Parse JSON response from AI, with fallback for malformed output
    let insights;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      insights = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn("[AI Client Insights] Failed to parse AI response as JSON", {
        responseText,
      });
      // Provide a sensible fallback structure
      insights = {
        churnRisk: 5,
        spendingTrend: "Brak wystarczajacych danych do analizy",
        topServices: topServices.map((s) => s.serviceName),
        visitFrequency: "Brak wystarczajacych danych do analizy",
        reengagementSuggestions: [
          "Wyslij klientowi wiadomosc z aktualną oferta",
        ],
        summary: responseText || "Nie udalo sie wygenerowac podsumowania.",
      };
    }

    return Response.json({ success: true, insights });
  } catch (error) {
    logger.error("[AI Client Insights] Error generating client insights", {
      error,
    });
    return Response.json(
      { error: "Blad podczas generowania analizy klienta. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
