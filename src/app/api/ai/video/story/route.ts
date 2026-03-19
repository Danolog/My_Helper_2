import { generateText } from "ai";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { startVideoGeneration } from "@/lib/ai/google-veo";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
  getSalonContext,
} from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { aiGeneratedMedia, galleryPhotos, services } from "@/lib/schema";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  /** Optional gallery photo ID to use as reference context for the story */
  photoId: z.string().uuid().optional(),
  /** User-provided description/context for the story */
  prompt: z.string().min(1, "Opis story jest wymagany").max(500),
  /** Story template type — guides the AI prompt style */
  template: z
    .enum([
      "promotion",
      "new_service",
      "transformation",
      "behind_scenes",
      "seasonal",
    ])
    .default("promotion"),
  /** Video duration in seconds */
  duration: z.enum(["4", "6", "8"]).default("6"),
});

// ────────────────────────────────────────────────────────────
// Template descriptions for AI prompt enhancement
// ────────────────────────────────────────────────────────────

const STORY_TEMPLATES: Record<string, string> = {
  promotion:
    "promotional story showcasing a special offer or discount with eye-catching text overlays",
  new_service:
    "announcement of a new service with elegant presentation and smooth reveal",
  transformation:
    "dramatic before/after transformation reveal with cinematic transition",
  behind_scenes:
    "authentic behind-the-scenes look at the salon with natural movement",
  seasonal:
    "seasonal or holiday themed story with festive elements and warm atmosphere",
};

// ────────────────────────────────────────────────────────────
// POST /api/ai/video/story
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth + Pro plan check
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

  const { photoId, prompt, template, duration } = parsed.data;

  // Fetch salon context for prompt enrichment
  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Optionally fetch gallery photo context to inform the AI prompt
  let photoContext = "";
  if (photoId) {
    const [photo] = await db
      .select({
        description: galleryPhotos.description,
        techniques: galleryPhotos.techniques,
        serviceName: services.name,
      })
      .from(galleryPhotos)
      .leftJoin(services, eq(galleryPhotos.serviceId, services.id))
      .where(
        and(
          eq(galleryPhotos.id, photoId),
          eq(galleryPhotos.salonId, salonId),
        ),
      )
      .limit(1);

    if (photo) {
      const parts = [
        photo.description ? `Description: ${photo.description}` : "",
        photo.serviceName ? `Service: ${photo.serviceName}` : "",
        photo.techniques ? `Techniques: ${photo.techniques}` : "",
      ].filter(Boolean);

      if (parts.length > 0) {
        photoContext = `Photo context: ${parts.join(". ")}.`;
      }
    }
  }

  // Enhance the user prompt via OpenRouter LLM for optimal Veo results
  let videoPrompt: string;
  try {
    const templateDesc =
      STORY_TEMPLATES[template] ?? STORY_TEMPLATES.promotion;
    const openrouter = createAIClient();

    const enhanceResult = await generateText({
      model: openrouter(getAIModel()),
      system: `You create short, cinematic video generation prompts for Instagram Stories (9:16 vertical format) for a ${industryLabel} called "${salonName}". Focus on: smooth camera movement, professional lighting, elegant transitions, vertical framing optimized for mobile viewing. Return ONLY the English prompt, max 60 words. No quotation marks.`,
      prompt: `Create a ${templateDesc}. User description: "${prompt}". ${photoContext}`.trim(),
      maxOutputTokens: 120,
    });

    const enhanced = enhanceResult.text.trim();
    if (enhanced) {
      videoPrompt = enhanced;
    } else {
      videoPrompt = `Elegant vertical ${industryLabel} story, cinematic quality, smooth motion, professional lighting`;
    }
  } catch (error) {
    logger.warn("[AI Video] Story prompt enhancement failed, using fallback", {
      error,
    });
    videoPrompt = `Elegant vertical beauty salon story, cinematic quality, professional lighting, smooth camera movement, 9:16 vertical format`;
  }

  try {
    const durationSeconds = parseInt(duration) as 4 | 6 | 8;

    const { operationName } = await startVideoGeneration(videoPrompt, {
      aspectRatio: "9:16",
      durationSeconds,
    });

    // Persist the task to the DB for status tracking via the shared status endpoint
    const rows = await db
      .insert(aiGeneratedMedia)
      .values({
        salonId,
        type: "video",
        sourceUrl: photoId ?? null,
        provider: "google_veo",
        prompt: videoPrompt,
        status: "processing",
        taskId: operationName,
        metadata: {
          template,
          duration: durationSeconds,
          originalPrompt: prompt,
          photoId: photoId ?? null,
          format: "story_9x16",
        },
      })
      .returning();

    const media = rows[0];
    if (!media) {
      throw new Error("Failed to persist story generation task");
    }

    return Response.json({
      success: true,
      taskId: media.id,
      status: "processing",
      template,
    });
  } catch (error) {
    logger.error("[AI Video] Story generation error", { error, salonId });
    return Response.json(
      {
        error:
          "Blad podczas generowania story. Sprobuj ponownie.",
      },
      { status: 500 },
    );
  }
}
