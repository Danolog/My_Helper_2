import { createGoogleAIClient } from "@/lib/ai/google-imagen";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// Google Veo — video generation provider abstraction
// ────────────────────────────────────────────────────────────

/** Veo model for short promotional video clips */
export const VEO_MODEL = "veo-3.1-generate-preview";

/** Maximum prompt length accepted by the Veo API */
const MAX_PROMPT_LENGTH = 480;

export interface VideoGenerationConfig {
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  durationSeconds?: 4 | 6 | 8;
}

/**
 * Start an async video generation task with Google Veo.
 *
 * Returns the serialised operation name (string) for later polling,
 * because the full operation object cannot be persisted in the DB.
 */
export async function startVideoGeneration(
  prompt: string,
  config: VideoGenerationConfig = {},
): Promise<{ operationName: string }> {
  const client = createGoogleAIClient();

  // Truncate prompt to the API maximum to avoid silent failures
  const safePrompt = prompt.slice(0, MAX_PROMPT_LENGTH);

  try {
    const operation = await client.models.generateVideos({
      model: VEO_MODEL,
      prompt: safePrompt,
      config: {
        numberOfVideos: 1,
        aspectRatio: config.aspectRatio ?? "16:9",
        durationSeconds: config.durationSeconds ?? 6,
        resolution: config.resolution ?? "720p",
        personGeneration: "allow_adult",
      },
    });

    const operationName = operation.name;
    if (!operationName) {
      throw new Error("No operation name returned from Veo API");
    }

    logger.info("[AI Video] Generation started", { operationName });
    return { operationName };
  } catch (error) {
    logger.error("[AI Video] Veo generation start error", { error });
    throw error;
  }
}

/**
 * Check the current status of a video generation operation.
 *
 * Returns `done: true` with `videoUrl` when the video is ready,
 * `done: true` with `error` on failure, or `done: false` while
 * still processing.
 */
export async function checkVideoStatus(operationName: string): Promise<{
  done: boolean;
  videoUrl?: string;
  error?: string;
}> {
  const client = createGoogleAIClient();

  try {
    // Build a minimal operation object the SDK can use for polling.
    // The getVideosOperation method needs an object with at least a `name`.
    const operation = await client.operations.getVideosOperation({
      operation: { name: operationName } as Parameters<
        typeof client.operations.getVideosOperation
      >[0]["operation"],
    });

    if (operation.done) {
      // Check for API-level errors first
      if (operation.error) {
        const errorMsg =
          typeof operation.error === "object"
            ? JSON.stringify(operation.error)
            : String(operation.error);
        logger.warn("[AI Video] Operation completed with error", {
          operationName,
          error: errorMsg,
        });
        return { done: true, error: errorMsg };
      }

      // Extract video URL from the response
      const video = operation.response?.generatedVideos?.[0];
      const videoUrl = video?.video?.uri;

      if (videoUrl) {
        logger.info("[AI Video] Generation completed", {
          operationName,
          videoUrl,
        });
        return { done: true, videoUrl };
      }

      // Check if content was filtered by safety policies
      const filteredCount = operation.response?.raiMediaFilteredCount ?? 0;
      if (filteredCount > 0) {
        const reasons =
          operation.response?.raiMediaFilteredReasons?.join(", ") ??
          "content policy violation";
        return {
          done: true,
          error: `Wideo odrzucone przez filtr bezpieczenstwa: ${reasons}`,
        };
      }

      return { done: true, error: "Wideo wygenerowane, ale brak URL" };
    }

    return { done: false };
  } catch (error) {
    logger.error("[AI Video] Status check error", {
      operationName,
      error,
    });
    // Return as not-done so the caller retries; transient network errors
    // should not mark the task as permanently failed.
    return { done: false };
  }
}
