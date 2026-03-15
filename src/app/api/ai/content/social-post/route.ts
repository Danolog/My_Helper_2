import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { salons, services, promotions } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

import { logger } from "@/lib/logger";
const platformEnum = z.enum(["instagram", "facebook", "tiktok"]);

const requestSchema = z.object({
  platform: platformEnum,
  postType: z.enum([
    "promotion",
    "service_highlight",
    "tips_and_tricks",
    "behind_the_scenes",
    "client_transformation",
    "seasonal",
    "engagement",
  ]),
  context: z.string().max(500).optional(),
  tone: z
    .enum(["professional", "casual", "fun", "luxurious", "educational"])
    .default("professional"),
  includeEmoji: z.boolean().default(true),
  includeHashtags: z.boolean().default(true),
});

const INDUSTRY_LABELS: Record<string, string> = {
  hair_salon: "salon fryzjerski",
  beauty_salon: "salon kosmetyczny",
  medical: "gabinet medyczny / klinika",
  barber: "barber shop",
  spa: "salon SPA / wellness",
  nail_salon: "salon paznokci / manicure",
};

const POST_TYPE_LABELS: Record<string, string> = {
  promotion: "Promocja / oferta specjalna",
  service_highlight: "Prezentacja uslugi",
  tips_and_tricks: "Porady i wskazowki",
  behind_the_scenes: "Za kulisami salonu",
  client_transformation: "Metamorfoza klienta",
  seasonal: "Post sezonowy / okolicznosciowy",
  engagement: "Post angazujacy (pytanie / ankieta)",
};

const PLATFORM_CONSTRAINTS: Record<
  string,
  { maxLength: number; hashtagGuide: string; format: string }
> = {
  instagram: {
    maxLength: 2200,
    hashtagGuide: "Dodaj 15-20 trafnych hashtagow na koncu posta",
    format:
      "Post na Instagram - z emoji, emocjonalny, wizualny jezyk, zacheta do interakcji",
  },
  facebook: {
    maxLength: 1500,
    hashtagGuide: "Dodaj 3-5 kluczowych hashtagow na koncu posta",
    format:
      "Post na Facebook - bardziej opisowy, moze byc dluzszy, z call-to-action",
  },
  tiktok: {
    maxLength: 500,
    hashtagGuide: "Dodaj 5-8 trendowych hashtagow na koncu posta",
    format:
      "Post/opis na TikTok - krotki, dynamiczny, z hookiem na poczatku, trendowy jezyk",
  },
};

const TONE_DESCRIPTIONS: Record<string, string> = {
  professional: "profesjonalny i ekspercki",
  casual: "swobodny i przyjazny",
  fun: "zabawny i energiczny",
  luxurious: "luksusowy i ekskluzywny",
  educational: "edukacyjny i informacyjny",
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

  const { platform, postType, context, tone, includeEmoji, includeHashtags } =
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
  let salonServices: string[] = [];
  let activePromotions: string[] = [];

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

    // Fetch top services for context
    const serviceList = await db
      .select({ name: services.name, basePrice: services.basePrice })
      .from(services)
      .where(
        and(
          eq(services.salonId, salonId),
          eq(services.isActive, true)
        )
      )
      .limit(10);

    salonServices = serviceList.map(
      (s) => `${s.name} (${s.basePrice} PLN)`
    );

    // Fetch active promotions
    try {
      const promoList = await db
        .select({ name: promotions.name, type: promotions.type, value: promotions.value })
        .from(promotions)
        .where(
          and(
            eq(promotions.salonId, salonId),
            eq(promotions.isActive, true)
          )
        )
        .limit(5);

      activePromotions = promoList.map(
        (p) => `${p.name} (${p.type === "percentage" ? `-${p.value}%` : `-${p.value} PLN`})`
      );
    } catch {
      // promotions table might not exist yet
    }
  } catch (error) {
    logger.error("[AI Content] Error fetching salon context", { error: error });
  }

  // Platform is validated by zod enum - always present in constraints
  const platformConfig = PLATFORM_CONSTRAINTS[platform]!;
  const toneDesc = TONE_DESCRIPTIONS[tone] ?? "profesjonalny";
  const postTypeLabel = POST_TYPE_LABELS[postType];

  // Build context parts
  const contextParts: string[] = [];
  contextParts.push(`Salon: "${salonName}" (${industryLabel})`);
  contextParts.push(`Typ posta: ${postTypeLabel}`);
  contextParts.push(`Ton: ${toneDesc}`);

  if (salonServices.length > 0) {
    contextParts.push(`Dostepne uslugi: ${salonServices.join(", ")}`);
  }
  if (activePromotions.length > 0) {
    contextParts.push(`Aktywne promocje: ${activePromotions.join("; ")}`);
  }
  if (context) {
    contextParts.push(`Dodatkowy kontekst od uzytkownika: ${context}`);
  }

  const systemPrompt = `Jestes ekspertem od social media marketingu specjalizujacym sie w branzy beauty, wellness i medycznej. Tworzysz angazujace posty dla salonow uslugowych w Polsce.

Zasady:
- Pisz WYLACZNIE po polsku
- ${platformConfig.format}
- Ton komunikacji: ${toneDesc}
- Maksymalna dlugosc posta: ${platformConfig.maxLength} znakow
${includeEmoji ? "- Uzywaj emoji aby post byl atrakcyjny wizualnie" : "- NIE uzywaj emoji"}
${includeHashtags ? `- ${platformConfig.hashtagGuide}` : "- NIE dodawaj hashtagow"}
- Post musi byc gotowy do opublikowania - nie dodawaj komentarzy, uwag ani instrukcji
- NIE dodawaj znakow [, ] ani placeholderow typu [nazwa salonu] - uzyj prawdziwych danych
- Post powinien byc naturalny, angazujacy i zachecac do interakcji
- Dostosuj jezyk do platformy ${platform}
- Jezeli dodajesz hashtagi, umiec je na samym koncu posta po pustej linii`;

  const userMessage = `Wygeneruj post na ${platform} dla nastepujacego kontekstu:

${contextParts.join("\n")}

Wygeneruj TYLKO tresc posta, bez zadnych dodatkowych komentarzy.`;

  try {
    const openrouter = createOpenRouter({ apiKey });

    const result = await generateText({
      model: openrouter(
        process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4"
      ),
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 1000,
    });

    const postContent = result.text.trim();

    if (!postContent) {
      return Response.json(
        { error: "AI nie wygenerowalo posta. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    // Extract hashtags from the generated content
    const hashtagRegex = new RegExp("#[\\w\\u00C0-\\u024F\\u0100-\\u017F]+", "g");
    const hashtags = postContent.match(hashtagRegex) || [];

    return Response.json({
      success: true,
      post: postContent,
      platform,
      postType,
      hashtags,
      characterCount: postContent.length,
      maxLength: platformConfig.maxLength,
    });
  } catch (error) {
    logger.error("[AI Content] Error generating social post", { error: error });
    return Response.json(
      { error: "Blad podczas generowania posta. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
