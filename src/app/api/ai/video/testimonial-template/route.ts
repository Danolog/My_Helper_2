import { generateText } from "ai";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  serviceName: z.string().min(1).max(200).optional(),
  clientName: z.string().max(100).optional(),
  platform: z
    .enum(["instagram", "tiktok", "youtube", "facebook"])
    .default("instagram"),
  tone: z
    .enum(["professional", "casual", "emotional", "energetic"])
    .default("casual"),
  /** Target video duration in seconds */
  duration: z.enum(["15", "30", "60"]).default("30"),
});

// ────────────────────────────────────────────────────────────
// Tone labels for the AI prompt (Polish descriptions)
// ────────────────────────────────────────────────────────────

const TONE_LABELS: Record<string, string> = {
  professional: "profesjonalny i ekspercki",
  casual: "swobodny i przyjazny",
  emotional: "emocjonalny i wzruszajacy",
  energetic: "energiczny i dynamiczny",
};

// ────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth + Pro plan guard
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

  const { serviceName, clientName, platform, tone, duration } = parsed.data;

  const { salonName, industryLabel } = await getSalonContext(salonId);

  const toneLabel = TONE_LABELS[tone] ?? "swobodny i przyjazny";

  const systemPrompt = `Jestes ekspertem od tresci wideo dla branzy beauty/wellness. Tworzysz szablony testimoniali wideo dla salonow.

Zwroc odpowiedz w formacie JSON:
{
  "intro": "Tekst wstepu (co powiedziec na poczatku, 1-2 zdania)",
  "questions": ["Pytanie 1 do klienta", "Pytanie 2", "Pytanie 3", "Pytanie 4"],
  "suggestedAnswerTips": ["Wskazowka 1 jak odpowiedziec", "Wskazowka 2"],
  "outro": "Tekst zakonczenia (call to action, 1-2 zdania)",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3"],
  "shootingTips": ["Wskazowka 1 dot. nagrywania", "Wskazowka 2"],
  "estimatedDuration": "${duration}s"
}

Zasady:
- Pisz TYLKO po polsku
- Intro: krotkie, angazujace, z hookiem
- Pytania: naturalne, otwarte, zachecajace do szczerej odpowiedzi
- Pytania powinny prowadzic klienta przez: doswiadczenie, efekt, emocje, rekomendacje
- Outro: call-to-action (rezerwacja, obserwowanie profilu)
- Hashtagi: 5-8, trafne dla platformy ${platform} i branzy
- Wskazowki nagrywania: oswietlenie, kat kamery, tlo
- Ton: ${toneLabel}
- Dostosuj dlugosc do ${duration} sekund
- ${serviceName ? `Usluga: ${serviceName}` : "Ogolny testimonial"}
- ${clientName ? `Imie klienta: ${clientName}` : ""}`;

  try {
    const openrouter = createAIClient();

    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: `Wygeneruj szablon testimonial wideo dla salonu "${salonName}" (${industryLabel}).`,
      maxOutputTokens: 1000,
    });

    const responseText = result.text.trim();

    let template;
    try {
      // Extract JSON from the response — the model may wrap it in markdown fences
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      template = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn("[AI Video] Failed to parse testimonial template as JSON", {
        responseText,
      });
      // Graceful fallback — return whatever text we got in a structured shape
      template = {
        intro: responseText.slice(0, 200),
        questions: [],
        suggestedAnswerTips: [],
        outro: "",
        hashtags: [],
        shootingTips: [],
        estimatedDuration: `${duration}s`,
      };
    }

    void trackAIUsage(salonId, "testimonial_template");

    return Response.json({ success: true, template });
  } catch (error) {
    logger.error("[AI Video] Testimonial template error", { error });
    return Response.json(
      { error: "Blad podczas generowania szablonu. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
