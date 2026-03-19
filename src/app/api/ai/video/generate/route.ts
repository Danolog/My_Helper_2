import { generateText } from "ai";
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
import { aiGeneratedMedia } from "@/lib/schema";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  prompt: z.string().min(1, "Opis wideo jest wymagany").max(500),
  aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
  duration: z.enum(["4", "6", "8"]).default("6"),
  autoPrompt: z.boolean().default(true),
});

// ────────────────────────────────────────────────────────────
// POST /api/ai/video/generate
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

  const { prompt, aspectRatio, duration, autoPrompt } = parsed.data;

  // Fetch salon context for prompt enrichment
  const { salonName, industryLabel } = await getSalonContext(salonId);

  // Optionally enhance the prompt via OpenRouter LLM
  let finalPrompt = prompt;
  if (autoPrompt) {
    try {
      const openrouter = createAIClient();
      const enhanceResult = await generateText({
        model: openrouter(getAIModel()),
        system: `You create short video generation prompts for promotional clips of a ${industryLabel} called "${salonName}". Focus on cinematic, smooth camera motion, professional lighting, and high production quality. The video will be ${duration} seconds long. Return ONLY the English prompt text, max 50 words. No quotation marks.`,
        prompt,
        maxOutputTokens: 100,
      });
      const enhanced = enhanceResult.text.trim();
      if (enhanced) {
        finalPrompt = enhanced;
      }
    } catch (error) {
      logger.warn("[AI Video] Auto-prompt enhancement failed, using original", {
        error,
      });
      // Fall through — use the original prompt
    }
  }

  try {
    const durationSeconds = parseInt(duration) as 4 | 6 | 8;

    const { operationName } = await startVideoGeneration(finalPrompt, {
      aspectRatio,
      durationSeconds,
    });

    // Persist the task to the DB for status tracking
    const rows = await db
      .insert(aiGeneratedMedia)
      .values({
        salonId,
        type: "video",
        provider: "google_veo",
        prompt: finalPrompt,
        status: "processing",
        taskId: operationName,
        metadata: {
          aspectRatio,
          duration: durationSeconds,
          originalPrompt: prompt,
        },
      })
      .returning();

    const media = rows[0];
    if (!media) {
      throw new Error("Failed to persist video generation task");
    }

    return Response.json({
      success: true,
      taskId: media.id,
      status: "processing",
    });
  } catch (error) {
    logger.error("[AI Video] Generation start error", { error, salonId });
    return Response.json(
      {
        error:
          "Blad podczas rozpoczynania generowania wideo. Sprobuj ponownie.",
      },
      { status: 500 },
    );
  }
}
