import { eq, and } from "drizzle-orm";
import { checkVideoStatus } from "@/lib/ai/google-veo";
import {
  requireProAI,
  isProAIError,
} from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { aiGeneratedMedia } from "@/lib/schema";

// ────────────────────────────────────────────────────────────
// GET /api/ai/video/status/[taskId]
// ────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  // Auth + Pro plan check
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;
  const { salonId } = proResult;

  const { taskId } = await params;

  // Fetch the task from DB, scoped to the current salon
  const [task] = await db
    .select()
    .from(aiGeneratedMedia)
    .where(
      and(
        eq(aiGeneratedMedia.id, taskId),
        eq(aiGeneratedMedia.salonId, salonId),
      ),
    )
    .limit(1);

  if (!task) {
    return Response.json(
      { error: "Zadanie nie znalezione" },
      { status: 404 },
    );
  }

  // If already completed or failed, return the cached result
  if (task.status === "completed") {
    return Response.json({
      success: true,
      status: "completed",
      videoUrl: task.resultUrl,
    });
  }

  if (task.status === "failed") {
    return Response.json({
      success: true,
      status: "failed",
      error: task.errorMessage,
    });
  }

  // Validate that we have an operation name to poll
  if (!task.taskId) {
    return Response.json({
      success: true,
      status: "failed",
      error: "Brak ID operacji Veo",
    });
  }

  // Poll the Veo API for current status
  try {
    const result = await checkVideoStatus(task.taskId);

    if (result.done) {
      if (result.videoUrl) {
        // Mark as completed in DB
        await db
          .update(aiGeneratedMedia)
          .set({
            status: "completed",
            resultUrl: result.videoUrl,
          })
          .where(eq(aiGeneratedMedia.id, taskId));

        return Response.json({
          success: true,
          status: "completed",
          videoUrl: result.videoUrl,
        });
      } else {
        // Mark as failed in DB
        const errorMessage = result.error ?? "Nieznany blad generowania wideo";
        await db
          .update(aiGeneratedMedia)
          .set({
            status: "failed",
            errorMessage,
          })
          .where(eq(aiGeneratedMedia.id, taskId));

        return Response.json({
          success: true,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    // Still processing
    return Response.json({
      success: true,
      status: "processing",
    });
  } catch (error) {
    logger.error("[AI Video] Status check error", { error, taskId });
    // Don't mark as failed on transient errors — let the client retry
    return Response.json({
      success: true,
      status: "processing",
    });
  }
}
