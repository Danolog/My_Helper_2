import { generateText } from "ai";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clients, appointments, services } from "@/lib/schema";

const requestSchema = z.object({
  clientId: z.string().uuid("Nieprawidlowy format ID klienta"),
  notificationType: z.enum(["birthday", "we_miss_you", "reminder", "follow_up"]),
  context: z.string().max(500).optional(),
});

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  birthday: "zyczenia urodzinowe",
  we_miss_you: "wiadomosc 'tesknimy' do nieaktywnego klienta",
  reminder: "przypomnienie o wizycie",
  follow_up: "follow-up po wizycie",
};

/** Maximum length for SMS messages in Poland (single segment). */
const SMS_MAX_LENGTH = 160;

export async function POST(req: Request) {
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

  const { clientId, notificationType, context } = parsed.data;

  // Fetch client data, ensuring the client belongs to this salon
  const [clientData] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
    .limit(1);

  if (!clientData) {
    return Response.json({ error: "Klient nie znaleziony" }, { status: 404 });
  }

  // Fetch last 3 appointments with service names for personalization context
  const recentAppointments = await db
    .select({
      serviceName: services.name,
      startTime: appointments.startTime,
      status: appointments.status,
    })
    .from(appointments)
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(
      and(eq(appointments.clientId, clientId), eq(appointments.salonId, salonId))
    )
    .orderBy(desc(appointments.startTime))
    .limit(3);

  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Build context for AI prompt
  const contextParts: string[] = [];
  contextParts.push(`Salon: "${salonName}" (${industryLabel})`);
  contextParts.push(`Klient: ${clientData.firstName} ${clientData.lastName}`);
  if (clientData.preferences) contextParts.push(`Preferencje: ${clientData.preferences}`);
  if (clientData.allergies) contextParts.push(`Alergie: ${clientData.allergies}`);
  if (clientData.birthday) contextParts.push(`Data urodzin: ${clientData.birthday}`);

  if (recentAppointments.length > 0) {
    const historyStr = recentAppointments
      .map(
        (a) =>
          `${new Date(a.startTime).toLocaleDateString("pl-PL")}: ${a.serviceName || "?"} (${a.status})`
      )
      .join("; ");
    contextParts.push(`Ostatnie wizyty: ${historyStr}`);
  }
  if (context) contextParts.push(`Dodatkowy kontekst: ${context}`);

  const typeLabel = NOTIFICATION_TYPE_LABELS[notificationType] || notificationType;

  const systemPrompt = `Jestes specjalista od komunikacji z klientami salonu "${salonName}" (${industryLabel}).

Twoje zadanie: napisz spersonalizowana wiadomosc typu "${typeLabel}" dla klienta.

Zwroc odpowiedz w formacie JSON (i TYLKO JSON):
{
  "message": "pelna wiadomosc (do 500 znakow, odpowiednia na email lub push)",
  "smsMessage": "krotka wersja SMS (MAKSYMALNIE 160 znakow!)"
}

Zasady:
- Pisz TYLKO po polsku
- Zwroc sie do klienta po imieniu
- Uwzglednij preferencje i historie klienta
- Ton: ciepły, profesjonalny, zachecajacy
- SMS musi miescic sie w 160 znakach!
- Nie uzywaj placeholderow - uzyj prawdziwych danych
- Na koncu wiadomosci zachec do umowienia wizyty
- Dla urodzin: dodaj zyczenia i specjalna oferte
- Dla "tesknimy": podkresl ze klient jest wazny, wspomnij ostatnia usluge
- Dla przypomnienia: krotko o nadchodzacej wizycie
- Dla follow-up: zapytaj o samopoczucie po zabiegu`;

  try {
    const openrouter = createAIClient();

    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: contextParts.join("\n"),
      maxOutputTokens: 500,
    });

    const rawText = result.text.trim();

    if (!rawText) {
      return Response.json(
        { error: "AI nie wygenerowalo wiadomosci. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    // Parse JSON response from AI — strip markdown code fences if present
    let aiResponse: { message?: string; smsMessage?: string };
    try {
      const jsonStr = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      aiResponse = JSON.parse(jsonStr);
    } catch {
      // If JSON parsing fails, treat the whole response as the message
      logger.warn("[AI Notifications] Failed to parse AI JSON response, using raw text", {
        rawText,
      });
      aiResponse = { message: rawText, smsMessage: rawText };
    }

    const message = aiResponse.message || rawText;
    let smsMessage = aiResponse.smsMessage || message;

    // Ensure SMS message respects the 160-character limit
    if (smsMessage.length > SMS_MAX_LENGTH) {
      smsMessage = smsMessage.slice(0, SMS_MAX_LENGTH - 3) + "...";
    }

    void trackAIUsage(salonId, "notifications_personalize");

    return Response.json({ success: true, message, smsMessage });
  } catch (error) {
    logger.error("[AI Notifications] Error generating personalized message", {
      error,
    });
    return Response.json(
      { error: "Blad podczas generowania wiadomosci. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
