import { createElevenLabsClient } from "@/lib/ai/elevenlabs";
import {
  requireProAI,
  isProAIError,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";

/** Maximum allowed audio file size (25 MB). */
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/**
 * POST /api/ai/voice/stt
 *
 * Transcribes an audio file to text using ElevenLabs Scribe.
 * Expects a multipart/form-data request with an "audio" field.
 * Requires Pro plan subscription.
 */
export async function POST(req: Request) {
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;

  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return Response.json(
        { error: "Brak pliku audio" },
        { status: 400 },
      );
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return Response.json(
        { error: "Plik audio zbyt duzy (max 25MB)" },
        { status: 400 },
      );
    }

    const client = createElevenLabsClient();

    // Convert the Blob to a File so the ElevenLabs SDK can process it.
    // Preserve the original MIME type if available, falling back to audio/webm.
    const file = new File(
      [audioFile],
      "audio.webm",
      { type: audioFile.type || "audio/webm" },
    );

    const result = await client.speechToText.convert({
      file,
      model_id: "scribe_v1",
      language_code: "pol", // Polish
    });

    return Response.json({
      success: true,
      text: result.text,
      language: result.language_code,
    });
  } catch (error) {
    logger.error("[AI Voice] STT error", { error });
    return Response.json(
      { error: "Blad podczas rozpoznawania mowy. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
