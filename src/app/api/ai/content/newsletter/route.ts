import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import {
  salons,
  services,
  promotions,
  newsletters,
} from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

const requestSchema = z.object({
  topic: z.string().min(1).max(500),
  goals: z
    .enum([
      "promotion",
      "seasonal",
      "loyalty",
      "reactivation",
      "news",
      "tips",
    ])
    .default("promotion"),
  tone: z
    .enum(["professional", "casual", "fun", "luxurious", "educational"])
    .default("professional"),
  length: z.enum(["short", "medium", "long"]).default("medium"),
  includeCallToAction: z.boolean().default(true),
  save: z.boolean().default(false),
});

const GOAL_LABELS: Record<string, string> = {
  promotion: "Promocja uslugi lub produktu",
  seasonal: "Oferta sezonowa / swiateczna",
  loyalty: "Budowanie lojalnosci klientow",
  reactivation: "Reaktywacja nieaktywnych klientow",
  news: "Nowosci i aktualnosci z salonu",
  tips: "Porady i wskazowki pielegnacyjne",
};

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: "profesjonalny i ekspercki",
  casual: "swobodny i przyjazny",
  fun: "zabawny i energiczny",
  luxurious: "luksusowy i ekskluzywny",
  educational: "edukacyjny i informacyjny",
};

const LENGTH_INSTRUCTIONS: Record<string, string> = {
  short: "Krotki newsletter (150-250 slow) - zwiezly, konkretny, 2-3 krotkie akapity",
  medium:
    "Sredni newsletter (250-400 slow) - rozbudowany, 3-5 akapitow z detalami",
  long: "Dlugi newsletter (400-600 slow) - szczegolowy, 5-7 akapitow, z wieloma sekcjami",
};

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
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { topic, goals, tone, length, includeCallToAction, save } =
    parsed.data;

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
  let salonAddress = "";
  let salonPhone = "";
  let salonServices: string[] = [];
  let activePromotions: string[] = [];

  try {
    const salonInfo = await db
      .select({
        name: salons.name,
        industryType: salons.industryType,
        address: salons.address,
        phone: salons.phone,
      })
      .from(salons)
      .where(eq(salons.id, salonId))
      .then((r) => r[0]);

    if (salonInfo) {
      salonName = salonInfo.name;
      salonAddress = salonInfo.address || "";
      salonPhone = salonInfo.phone || "";
      const iType = salonInfo.industryType;
      if (iType && INDUSTRY_LABELS[iType]) {
        industryLabel = INDUSTRY_LABELS[iType];
      }
    }

    // Fetch top services
    const serviceList = await db
      .select({ name: services.name, basePrice: services.basePrice })
      .from(services)
      .where(
        and(eq(services.salonId, salonId), eq(services.isActive, true))
      )
      .limit(10);

    salonServices = serviceList.map(
      (s) => `${s.name} (${s.basePrice} PLN)`
    );

    // Fetch active promotions
    try {
      const promoList = await db
        .select({
          name: promotions.name,
          type: promotions.type,
          value: promotions.value,
        })
        .from(promotions)
        .where(
          and(
            eq(promotions.salonId, salonId),
            eq(promotions.isActive, true)
          )
        )
        .limit(5);

      activePromotions = promoList.map(
        (p) =>
          `${p.name} (${p.type === "percentage" ? `-${p.value}%` : `-${p.value} PLN`})`
      );
    } catch {
      // promotions table might not exist yet
    }
  } catch (error) {
    console.error("[AI Newsletter] Error fetching salon context:", error);
  }

  const goalLabel = GOAL_LABELS[goals] ?? "Promocja";
  const toneDesc = TONE_DESCRIPTIONS[tone] ?? "profesjonalny";
  const lengthInst = LENGTH_INSTRUCTIONS[length] ?? LENGTH_INSTRUCTIONS.medium;

  // Build context
  const contextParts: string[] = [];
  contextParts.push(`Salon: "${salonName}" (${industryLabel})`);
  if (salonAddress) contextParts.push(`Adres: ${salonAddress}`);
  if (salonPhone) contextParts.push(`Telefon: ${salonPhone}`);
  contextParts.push(`Cel newslettera: ${goalLabel}`);
  contextParts.push(`Temat/kontekst: ${topic}`);

  if (salonServices.length > 0) {
    contextParts.push(`Dostepne uslugi: ${salonServices.join(", ")}`);
  }
  if (activePromotions.length > 0) {
    contextParts.push(`Aktywne promocje: ${activePromotions.join("; ")}`);
  }

  const systemPrompt = `Jestes ekspertem od email marketingu specjalizujacym sie w branzy beauty, wellness i medycznej. Tworzysz profesjonalne newslettery emailowe dla salonow uslugowych w Polsce.

Zasady:
- Pisz WYLACZNIE po polsku
- Ton komunikacji: ${toneDesc}
- ${lengthInst}
- Newsletter musi miec:
  1. Chwytliwy tytul/temat (subject line) - na poczatku oznaczony jako TEMAT:
  2. Powitanie personalizowane (np. "Drogi Kliencie" lub "Cześć!")
  3. Tresc glowna podzielona na czytelne akapity
  4. ${includeCallToAction ? 'Wyrazne wezwanie do dzialania (CTA) - np. "Zarezerwuj wizyte", "Skontaktuj sie z nami"' : "BEZ wezwania do dzialania"}
  5. Profesjonalne zakonczenie z danymi salonu
- NIE uzywaj znakow [ ] ani placeholderow - uzyj prawdziwych danych salonu
- Format: czysty tekst z wyraznymi akapitami oddzielonymi pustymi liniami
- Newsletter powinien byc gotowy do wyslania - nie dodawaj komentarzy ani instrukcji
- Pierwsza linia powinna zawierac TEMAT: (subject line)
- Reszta to tresc emaila`;

  const userMessage = `Wygeneruj newsletter emailowy dla nastepujacego kontekstu:

${contextParts.join("\n")}

Wygeneruj TEMAT: na poczatku (jedna linia), potem pusta linia, potem tresc newslettera.`;

  try {
    const openrouter = createOpenRouter({ apiKey });

    const result = await generateText({
      model: openrouter(
        process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4"
      ),
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 1500,
    });

    const fullContent = result.text.trim();

    if (!fullContent) {
      return Response.json(
        { error: "AI nie wygenerowalo newslettera. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    // Extract subject line from content
    let subject = "";
    let content = fullContent;

    const subjectMatch = fullContent.match(/^TEMAT:\s*(.+)/m);
    if (subjectMatch) {
      subject = subjectMatch[1]!.trim();
      // Remove TEMAT: line from content
      content = fullContent.replace(/^TEMAT:\s*.+\n?\n?/m, "").trim();
    } else {
      // Fallback: use first line as subject
      const lines = fullContent.split("\n");
      subject = lines[0]!.trim();
      content = lines.slice(1).join("\n").trim();
    }

    // Word count
    const wordCount = content.split(/\s+/).filter(Boolean).length;

    // Optionally save to database
    let savedId: string | null = null;
    if (save) {
      try {
        const [saved] = await db
          .insert(newsletters)
          .values({
            salonId: salonId,
            subject,
            content,
          })
          .returning({ id: newsletters.id });

        savedId = saved!.id;
      } catch (error) {
        console.error("[AI Newsletter] Error saving newsletter:", error);
      }
    }

    return Response.json({
      success: true,
      subject,
      content,
      wordCount,
      goal: goals,
      tone,
      savedId,
    });
  } catch (error: unknown) {
    console.error("[AI Newsletter] Error generating newsletter:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return Response.json(
      {
        error: "Blad podczas generowania newslettera. Sprobuj ponownie.",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

// GET - list saved newsletters
export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return Response.json({ error: "Salon not found" }, { status: 404 });
  }

  try {
    const result = await db
      .select()
      .from(newsletters)
      .where(eq(newsletters.salonId, salonId))
      .orderBy(desc(newsletters.createdAt))
      .limit(20);

    return Response.json({ newsletters: result });
  } catch (error) {
    console.error("[AI Newsletter] Error fetching newsletters:", error);
    return Response.json(
      { error: "Blad podczas pobierania newsletterow" },
      { status: 500 }
    );
  }
}
