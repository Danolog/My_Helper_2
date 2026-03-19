import { z } from "zod";
import {
  createElevenLabsClient,
  DEFAULT_VOICE_ID,
  DEFAULT_TTS_MODEL,
} from "@/lib/ai/elevenlabs";
import {
  requireProAI,
  isProAIError,
} from "@/lib/ai/openrouter";
import { logger } from "@/lib/logger";

const requestSchema = z.object({
  text: z.string().min(1, "Tekst jest wymagany").max(5000, "Tekst zbyt dlugi"),
  voiceId: z.string().optional(),
});

/**
 * POST /api/ai/voice/tts
 *
 * Converts text to speech using ElevenLabs and returns an MP3 audio stream.
 * Requires Pro plan subscription.
 */
export async function POST(req: Request) {
  const proResult = await requireProAI();
  if (isProAIError(proResult)) return proResult;

  // Parse and validate request body
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

  const { text, voiceId } = parsed.data;

  try {
    const client = createElevenLabsClient();

    // ElevenLabs SDK returns a Node.js Readable stream
    const audioStream = await client.textToSpeech.convert(
      voiceId || DEFAULT_VOICE_ID,
      {
        text,
        model_id: DEFAULT_TTS_MODEL,
        output_format: "mp3_44100_128",
      },
    );

    // Bridge the Node.js Readable stream into a Web ReadableStream
    // so it can be returned as a standard Response body.
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of audioStream) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    logger.error("[AI Voice] TTS error", { error });
    return Response.json(
      { error: "Blad podczas generowania mowy. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
