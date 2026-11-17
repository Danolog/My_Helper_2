import { generateText } from "ai";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { buildClientContext, firstNameForReply } from "@/lib/ai/client-context";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { clients, appointments, services } from "@/lib/schema";
import { frozenModuleResponse } from "@/lib/server/frozen-guard";
import { forSalon } from "@/lib/server/repository";

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

/**
 * Znacznik imienia w odpowiedzi modelu. Ta trasa nie wysyła modelowi imienia
 * klienta; model wstawia znacznik, a serwer podmienia go po odpowiedzi.
 */
const FIRST_NAME_TOKEN = "{imie}";

/** Tekst w jednej linii: znaki nowej linii i tabulatory zamienione na spacje. */
function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Podmienia każde wystąpienie znacznika imienia na `firstName`. Bez imienia
 * usuwa znacznik razem z przylegającymi spacjami, tak by nie zostały podwójne
 * spacje, spacja przed znakiem interpunkcyjnym ani przecinek na początku linii.
 */
function fillFirstName(text: string, firstName: string | null): string {
  if (firstName) return text.split(FIRST_NAME_TOKEN).join(firstName);

  return (
    text
      // Znacznik na początku linii razem z następującym po nim przecinkiem.
      .replace(/(^|\n)[ \t]*\{imie\}[ \t]*[,;:]?[ \t]*/g, "$1")
      // Znacznik w środku linii: spacja zostaje tylko między dwoma wyrazami.
      .replace(/[ \t]*\{imie\}[ \t]*(?=([,!.?;:)]|\n|$)?)/g, (match, next) => {
        if (next !== undefined) return "";
        return /^[ \t]/.test(match) || /[ \t]$/.test(match) ? " " : "";
      })
  );
}

export async function POST(req: Request) {
  // Druga linia obrony zamrożenia (pierwsza: src/proxy.ts).
  const frozen = frozenModuleResponse("aiNotifications");
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

  const { clientId, notificationType, context } = parsed.data;

  // Fetch only the client columns this route needs, ensuring the client
  // belongs to this salon
  const [clientData] = await forSalon(salonId).raw((tx) =>
    tx
      .select({
        id: clients.id,
        firstName: clients.firstName,
        preferences: clients.preferences,
      })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
      .limit(1)
  );

  if (!clientData) {
    return Response.json({ error: "Klient nie znaleziony" }, { status: 404 });
  }

  // Fetch last 3 appointments with service names for personalization context
  const recentAppointments = await forSalon(salonId).raw((tx) =>
    tx
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
      .limit(3)
  );

  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Imię nie trafia do modelu — serwer wstawia je w miejsce znacznika.
  const firstName = firstNameForReply(clientData);

  // Build context for AI prompt: the client is described only by
  // buildClientContext (constant label and preferences on one line)
  const contextParts: string[] = [];
  contextParts.push(`Salon: "${salonName}" (${industryLabel})`);
  contextParts.push(...buildClientContext(clientData));

  if (recentAppointments.length > 0) {
    const historyStr = recentAppointments
      .map(
        (a) =>
          `${new Date(a.startTime).toLocaleDateString("pl-PL")}: ${a.serviceName || "?"} (${a.status})`
      )
      .join("; ");
    contextParts.push(`Ostatnie wizyty: ${historyStr}`);
  }
  const contextLine = context ? toSingleLine(context) : "";
  if (contextLine) contextParts.push(`Dodatkowy kontekst: ${contextLine}`);

  const typeLabel = NOTIFICATION_TYPE_LABELS[notificationType] || notificationType;

  const addressRule = firstName
    ? `- Zwroc sie do klienta po imieniu: w miejscu imienia wstaw dokladnie znacznik ${FIRST_NAME_TOKEN} (bez zmian, bez odmiany). Nie znasz imienia klienta - nie zgaduj go i nie uzywaj innych znacznikow ani placeholderow`
    : `- Nie zwracaj sie do klienta po imieniu i nie uzywaj zadnych znacznikow ani placeholderow`;

  const systemPrompt = `Jestes specjalista od komunikacji z klientami salonu "${salonName}" (${industryLabel}).

Twoje zadanie: napisz spersonalizowana wiadomosc typu "${typeLabel}" dla klienta.

Zwroc odpowiedz w formacie JSON (i TYLKO JSON):
{
  "message": "pelna wiadomosc (do 500 znakow, odpowiednia na email lub push)",
  "smsMessage": "krotka wersja SMS (MAKSYMALNIE 160 znakow!)"
}

Zasady:
- Pisz TYLKO po polsku
${addressRule}
- Uwzglednij preferencje i historie klienta
- Ton: ciepły, profesjonalny, zachecajacy
- SMS musi miescic sie w 160 znakach!
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

    const modelMessage = aiResponse.message || rawText;
    const modelSms = aiResponse.smsMessage || modelMessage;

    // Insert the first name in both fields (JSON answer and fallback alike)
    const message = fillFirstName(modelMessage, firstName);
    let smsMessage = fillFirstName(modelSms, firstName);

    // Ensure SMS message respects the 160-character limit (after inserting
    // the first name)
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
