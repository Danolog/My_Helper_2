import { generateText } from "ai";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";

const requestSchema = z.object({
  transcript: z.string().min(1, "Transkrypt jest wymagany").max(1000),
});

/**
 * System prompt that teaches the AI model how to interpret Polish voice
 * commands and map them to dashboard navigation actions.
 */
const SYSTEM_PROMPT = `Jestes interpreterem komend glosowych dla systemu zarzadzania salonem. Uzytkownik mowi po polsku.

Dostepne strony/akcje:
- /dashboard — pulpit
- /dashboard/calendar — kalendarz
- /dashboard/booking — nowa rezerwacja/wizyta
- /dashboard/clients — lista klientow
- /dashboard/services — uslugi
- /dashboard/employees — pracownicy
- /dashboard/products — magazyn/produkty
- /dashboard/reports — raporty
- /dashboard/reports/revenue — przychody
- /dashboard/gallery — galeria
- /dashboard/promotions — promocje
- /dashboard/invoices — faktury
- /dashboard/settings — ustawienia
- /dashboard/ai-assistant — asystent AI
- /dashboard/notifications — powiadomienia
- /dashboard/reviews — opinie
- /dashboard/waiting-list — lista oczekujacych
- /dashboard/promo-codes — kody promocyjne
- /dashboard/finance — prowizje/wynagrodzenia
- /dashboard/payments — historia platnosci
- /dashboard/subscription — subskrypcja

Zwroc odpowiedz w formacie JSON (i TYLKO JSON, bez dodatkowego tekstu):
{
  "intent": "krotki opis intencji",
  "action": {
    "type": "navigate" | "search" | "create_appointment" | "check_schedule" | "unknown",
    "path": "/dashboard/...",
    "params": {}
  },
  "displayText": "Tekst do wyswietlenia uzytkownikowi"
}

Zasady:
- "type" okresla rodzaj akcji:
  - "navigate" — nawigacja do strony (path wymagany)
  - "search" — wyszukiwanie (params.query wymagany)
  - "create_appointment" — przejscie do /dashboard/booking
  - "check_schedule" — przejscie do /dashboard/calendar
  - "unknown" — nie udalo sie rozpoznac intencji
- "displayText" to krotkie potwierdzenie po polsku, np. "Otwieram kalendarz"
- Jezeli komenda jest niejasna, uzyj "unknown" z pomocnym displayText

Przyklady:
- "pokaz kalendarz" -> navigate to /dashboard/calendar
- "umow wizyte" -> create_appointment, path /dashboard/booking
- "ile zarobilimy w tym miesiacu" -> navigate to /dashboard/reports/revenue
- "dodaj nowego klienta" -> navigate to /dashboard/clients
- "sprawdz magazyn" -> navigate to /dashboard/products
- "pokaz raporty" -> navigate to /dashboard/reports
- "opinie klientow" -> navigate to /dashboard/reviews
- "ustawienia salonu" -> navigate to /dashboard/settings`;

/**
 * POST /api/ai/voice/interpret-command
 *
 * Interprets a voice transcript and returns a structured action
 * (navigation target, search query, etc.) for the dashboard UI.
 * Requires Pro plan subscription.
 */
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

  const { transcript } = parsed.data;

  try {
    const openrouter = createAIClient();
    const result = await generateText({
      model: openrouter(getAIModel()),
      system: SYSTEM_PROMPT,
      prompt: `Komenda glosowa uzytkownika: "${transcript}"`,
      maxOutputTokens: 300,
    });

    const responseText = result.text.trim();

    // Parse JSON response from AI, with fallback for malformed output
    let interpretation;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      interpretation = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn(
        "[AI Voice] Failed to parse interpret-command AI response as JSON",
        { responseText },
      );
      interpretation = {
        intent: "unknown",
        action: { type: "unknown" as const },
        displayText: "Nie udalo sie rozpoznac komendy. Sprobuj ponownie.",
      };
    }

    void trackAIUsage(salonId, "voice_command");

    return Response.json({
      success: true,
      intent: interpretation.intent ?? "unknown",
      action: interpretation.action ?? { type: "unknown" },
      displayText:
        interpretation.displayText ??
        "Nie udalo sie rozpoznac komendy. Sprobuj ponownie.",
    });
  } catch (error) {
    logger.error("[AI Voice] Command interpretation error", { error });
    return Response.json(
      { error: "Blad podczas interpretacji komendy. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
