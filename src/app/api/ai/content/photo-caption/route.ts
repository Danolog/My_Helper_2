import { generateText } from "ai";
import { eq } from "drizzle-orm";
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
import { galleryPhotos, employees, services } from "@/lib/schema";

const requestSchema = z.object({
  photoId: z.string().uuid("Nieprawidlowy format ID zdjecia"),
  platform: z.enum(["instagram", "facebook", "tiktok"]),
  tone: z
    .enum(["professional", "casual", "fun", "luxurious", "educational"])
    .default("professional"),
  includeEmoji: z.boolean().default(true),
  includeHashtags: z.boolean().default(true),
});

const PLATFORM_CONSTRAINTS: Record<
  string,
  { maxLength: number; hashtagGuide: string; format: string }
> = {
  instagram: {
    maxLength: 2200,
    hashtagGuide: "Dodaj 15-20 trafnych hashtagow na koncu podpisu",
    format:
      "Podpis na Instagram - z emoji, emocjonalny, wizualny jezyk, zacheta do interakcji i komentarzy",
  },
  facebook: {
    maxLength: 1500,
    hashtagGuide: "Dodaj 3-5 kluczowych hashtagow na koncu podpisu",
    format:
      "Podpis na Facebook - bardziej opisowy, opowiadajacy historie, z call-to-action",
  },
  tiktok: {
    maxLength: 500,
    hashtagGuide: "Dodaj 5-8 trendowych hashtagow na koncu podpisu",
    format:
      "Podpis na TikTok - krotki, dynamiczny, z hookiem na poczatku, trendowy jezyk",
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
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { photoId, platform, tone, includeEmoji, includeHashtags } =
    parsed.data;

  // Fetch the gallery photo with related data
  let photo: {
    id: string;
    description: string | null;
    productsUsed: string | null;
    techniques: string | null;
    duration: number | null;
    beforePhotoUrl: string | null;
    afterPhotoUrl: string | null;
    employeeFirstName: string | null;
    employeeLastName: string | null;
    serviceName: string | null;
  } | null = null;

  try {
    const result = await db
      .select({
        id: galleryPhotos.id,
        description: galleryPhotos.description,
        productsUsed: galleryPhotos.productsUsed,
        techniques: galleryPhotos.techniques,
        duration: galleryPhotos.duration,
        beforePhotoUrl: galleryPhotos.beforePhotoUrl,
        afterPhotoUrl: galleryPhotos.afterPhotoUrl,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        serviceName: services.name,
      })
      .from(galleryPhotos)
      .leftJoin(employees, eq(galleryPhotos.employeeId, employees.id))
      .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(eq(galleryPhotos.id, photoId))
      .then((r) => r[0] ?? null);

    photo = result;
  } catch (error) {
    logger.error("[AI Content] Error fetching gallery photo", { error: error });
    return Response.json(
      { error: "Blad podczas pobierania danych zdjecia." },
      { status: 500 }
    );
  }

  if (!photo) {
    return Response.json(
      { error: "Nie znaleziono zdjecia o podanym ID." },
      { status: 404 }
    );
  }

  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Build photo context for the prompt
  const isBeforeAfter = Boolean(photo.beforePhotoUrl && photo.afterPhotoUrl);
  const employeeName =
    photo.employeeFirstName && photo.employeeLastName
      ? `${photo.employeeFirstName} ${photo.employeeLastName}`
      : null;

  const photoContextParts: string[] = [];
  photoContextParts.push(`Salon: "${salonName}" (${industryLabel})`);

  if (photo.serviceName) {
    photoContextParts.push(`Wykonana usluga: ${photo.serviceName}`);
  }
  if (photo.techniques) {
    photoContextParts.push(`Zastosowane techniki: ${photo.techniques}`);
  }
  if (photo.productsUsed) {
    photoContextParts.push(`Uzyte produkty: ${photo.productsUsed}`);
  }
  if (employeeName) {
    photoContextParts.push(`Wykonawca: ${employeeName}`);
  }
  if (photo.description) {
    photoContextParts.push(`Opis zdjecia: ${photo.description}`);
  }
  if (photo.duration) {
    photoContextParts.push(`Czas zabiegu: ${photo.duration} minut`);
  }
  if (isBeforeAfter) {
    photoContextParts.push(
      "Typ zdjecia: para przed/po (metamorfoza / transformacja)"
    );
  }

  // Platform is validated by zod enum - always present in constraints
  const platformConfig = PLATFORM_CONSTRAINTS[platform]!;
  const toneDesc = TONE_DESCRIPTIONS[tone] ?? "profesjonalny";

  const systemPrompt = `Jestes ekspertem od social media marketingu specjalizujacym sie w branzy beauty, wellness i medycznej. Tworzysz angazujace podpisy do zdjec (captions) dla salonow uslugowych w Polsce.

Zasady:
- Pisz WYLACZNIE po polsku
- ${platformConfig.format}
- Ton komunikacji: ${toneDesc}
- Maksymalna dlugosc podpisu: ${platformConfig.maxLength} znakow
${includeEmoji ? "- Uzywaj emoji aby podpis byl atrakcyjny wizualnie" : "- NIE uzywaj emoji"}
${includeHashtags ? `- ${platformConfig.hashtagGuide}` : "- NIE dodawaj hashtagow"}
- Podpis musi byc gotowy do skopiowania i wklejenia - nie dodawaj komentarzy, uwag ani instrukcji
- NIE dodawaj znakow [, ] ani placeholderow typu [nazwa salonu] - uzyj prawdziwych danych
- Podpis powinien naturalnie nawiazywac do wykonanej uslugi i zastosowanych technik
- Jezeli to zdjecie przed/po, podkresl metamorfoze i efekt koncowy
- Jezeli podano produkty lub techniki, wspomnij o nich naturalnie w tekscie (nie jako sucha lista)
- Podpis powinien zachecac do umowienia wizyty lub kontaktu z salonem
- Dostosuj jezyk i styl do platformy ${platform}
- Jezeli dodajesz hashtagi, umiec je na samym koncu podpisu po pustej linii`;

  const userMessage = `Wygeneruj podpis do zdjecia z galerii salonu na platforme ${platform} dla nastepujacego kontekstu:

${photoContextParts.join("\n")}

Wygeneruj TYLKO tresc podpisu, bez zadnych dodatkowych komentarzy.`;

  try {
    const openrouter = createAIClient();

    const result = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: 1000,
    });

    const caption = result.text.trim();

    if (!caption) {
      return Response.json(
        { error: "AI nie wygenerowalo podpisu. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    // Extract hashtags from the generated content
    const hashtagRegex = new RegExp(
      "#[\\w\\u00C0-\\u024F\\u0100-\\u017F]+",
      "g"
    );
    const hashtags = caption.match(hashtagRegex) || [];

    void trackAIUsage(salonId, "photo_caption");

    return Response.json({
      success: true,
      caption,
      platform,
      hashtags,
      characterCount: caption.length,
    });
  } catch (error) {
    logger.error("[AI Content] Error generating photo caption", { error: error });
    return Response.json(
      { error: "Blad podczas generowania podpisu. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}
