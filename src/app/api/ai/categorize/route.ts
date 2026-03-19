import { generateText } from "ai";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";

const requestSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana").max(200),
  description: z.string().max(500).optional(),
  type: z.enum(["service", "product"]),
  existingCategories: z.array(z.string()).max(50).default([]),
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

  const { name, description, type, existingCategories } = parsed.data;

  try {
    const { industryLabel } = await getSalonContext(salonId);
    const typeLabel = type === "service" ? "uslugi" : "produktu";

    const systemPrompt = `Jestes ekspertem od kategoryzacji ${typeLabel} w branzy beauty/wellness/medycznej (${industryLabel}).

Zwroc odpowiedz w formacie JSON (i TYLKO JSON, bez dodatkowego tekstu):
{
  "suggestedCategory": "nazwa kategorii",
  "confidence": "high" | "medium" | "low",
  "isNew": true/false,
  "reason": "krotkie uzasadnienie wyboru"
}

Zasady:
- Pisz TYLKO po polsku
- Jezeli istniejace kategorie zawieraja dobra opcje, uzyj jej (isNew: false)
- Jezeli zadna istniejaca kategoria nie pasuje, zaproponuj nowa (isNew: true)
- Nowa kategoria powinna byc ogolna (nie zbyt szczegolowa) i pasowac do branzy
- confidence: "high" gdy nazwa jednoznacznie wskazuje na kategorie, "medium" gdy jest kilka opcji, "low" gdy trudno okreslic
- reason: 1 zdanie wyjasniajacie dlaczego ta kategoria`;

    const contextParts: string[] = [];
    contextParts.push(`Nazwa ${typeLabel}: "${name}"`);
    if (description) {
      contextParts.push(`Opis: ${description}`);
    }
    if (existingCategories.length > 0) {
      contextParts.push(
        `Istniejace kategorie: ${existingCategories.join(", ")}`,
      );
    } else {
      contextParts.push("Brak istniejacych kategorii - zaproponuj nowa.");
    }

    const openrouter = createAIClient();
    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: contextParts.join("\n"),
      maxOutputTokens: 300,
    });

    const responseText = result.text.trim();

    // Parse JSON response from AI, with fallback for malformed output
    let categorization;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      categorization = JSON.parse(jsonMatch[0]);
    } catch {
      logger.warn("[AI Categorize] Failed to parse AI response as JSON", {
        responseText,
      });
      categorization = {
        suggestedCategory: responseText.slice(0, 100),
        confidence: "low",
        isNew: true,
        reason: "Nie udalo sie przetworzyc odpowiedzi AI",
      };
    }

    return Response.json({ success: true, ...categorization });
  } catch (error) {
    logger.error("[AI Categorize] Error categorizing", { error });
    return Response.json(
      { error: "Blad podczas kategoryzacji. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
