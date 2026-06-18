import { eq, and } from "drizzle-orm";
import { checkVideoStatus } from "@/lib/ai/google-veo";
import {
  requireProAI,
  isProAIError,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";
import { aiGeneratedMedia } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

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
  const [task] = await forSalon(salonId).raw((tx) =>
    tx
      .select()
      .from(aiGeneratedMedia)
      .where(
        and(
          eq(aiGeneratedMedia.id, taskId),
          eq(aiGeneratedMedia.salonId, salonId),
        ),
      )
      .limit(1)
  );

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
        // Mark as completed in DB (jawne eq(salonId) — obowiazek warstwy raw())
        await forSalon(salonId).raw((tx) =>
          tx
            .update(aiGeneratedMedia)
            .set({
              status: "completed",
              resultUrl: result.videoUrl,
            })
            .where(
              and(
                eq(aiGeneratedMedia.id, taskId),
                eq(aiGeneratedMedia.salonId, salonId),
              ),
            )
        );

        return Response.json({
          success: true,
          status: "completed",
          videoUrl: result.videoUrl,
        });
      } else {
        // Mark as failed in DB (jawne eq(salonId) — obowiazek warstwy raw())
        const errorMessage = result.error ?? "Nieznany blad generowania wideo";
        await forSalon(salonId).raw((tx) =>
          tx
            .update(aiGeneratedMedia)
            .set({
              status: "failed",
              errorMessage,
            })
            .where(
              and(
                eq(aiGeneratedMedia.id, taskId),
                eq(aiGeneratedMedia.salonId, salonId),
              ),
            )
        );

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
