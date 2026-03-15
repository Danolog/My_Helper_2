import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";

const requestSchema = z.object({
  serviceName: z.string().min(1, "Nazwa uslugi jest wymagana").max(200),
  categoryName: z.string().max(100).optional(),
  basePrice: z.number().min(0).optional(),
  baseDuration: z.number().min(1).optional(),
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
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  // Verify authentication and resolve salon
  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
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

  const { serviceName, categoryName, basePrice, baseDuration } = parsed.data;

  // Check OpenRouter API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OpenRouter API key not configured" },
      { status: 500 }
    );
  }

  // Fetch salon info for context
  let salonName = "Salon";
  let industryLabel = "salon uslugowy";
  try {
    const salonInfo = await db
      .select({ name: salons.name, industryType: salons.industryType })
      .from(salons)
      .where(eq(salons.id, salonId))
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
    const openrouter = createOpenRouter({ apiKey });

    const result = await generateText({
      model: openrouter(
        process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4"
      ),
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

    return Response.json({ success: true, description });
  } catch (error) {
    console.error("[AI Content] Error generating description:", error);
    return Response.json(
      { error: "Blad podczas generowania opisu. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
