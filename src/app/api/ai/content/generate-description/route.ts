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

const requestSchema = z.object({
  serviceName: z.string().min(1, "Nazwa uslugi jest wymagana").max(200),
  categoryName: z.string().max(100).optional(),
  basePrice: z.number().min(0).optional(),
  baseDuration: z.number().min(1).optional(),
});

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

  const { serviceName, categoryName, basePrice, baseDuration } = parsed.data;

  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Build context
  const contextParts: string[] = [];
  if (categoryName) contextParts.push(`Kategoria uslugi: ${categoryName}`);
  if (basePrice !== undefined) contextParts.push(`Cena bazowa: ${basePrice} PLN`);
  if (baseDuration !== undefined) contextParts.push(`Czas trwania: ${baseDuration} minut`);
  const contextStr = contextParts.length > 0 ? contextParts.join(". ") + "." : "";

  const systemPrompt = `Jestes copywriterem specjalizujacym sie w tekstach marketingowych dla branz beauty, wellness i medycznej. Piszesz profesjonalne opisy uslug dla "${salonName}" (${industryLabel}).

Zasady:
- Pisz TYLKO po polsku
- Napisz opis uslugi w 2-4 zdaniach
- Opis powinien byc profesjonalny, zachecajacy i marketingowy
- NIE podawaj ceny ani czasu trwania w opisie (to jest pokazywane osobno w aplikacji)
- NIE uzywaj naglowkow, punktorow ani formatowania - sam czysty tekst
- NIE dodawaj tekstu typu "Opis:" na poczatku
- Uwzglednij specyfike branzy (${industryLabel}) i rodzaj uslugi
- Opis powinien podkreslac korzysci dla klienta, profesjonalizm i jakosc
- Unikaj ogolnikow - badz konkretny i zwiazany z dana usluga
- Jezeli nazwa uslugi sugeruje konkretny zabieg, uwzglednij to w opisie`;

  const userMessage = `Napisz profesjonalny opis marketingowy dla uslugi: "${serviceName}"${contextStr ? `\n\nDodatkowy kontekst: ${contextStr}` : ""}`;

  try {
    const openrouter = createAIClient();

    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 500,
    });

    const description = result.text.trim();

    if (!description) {
      return Response.json(
        { error: "AI nie wygenerowalo opisu. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    void trackAIUsage(salonId, "generate_description");

    return Response.json({ success: true, description });
  } catch (error) {
    logger.error("[AI Content] Error generating description", { error: error });
    return Response.json(
      { error: "Blad podczas generowania opisu. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
