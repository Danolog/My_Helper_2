import { ElevenLabsClient } from "elevenlabs";

/**
 * Create an ElevenLabs client. Throws if ELEVENLABS_API_KEY is not set.
 */
export function createElevenLabsClient() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured");
  }
  return new ElevenLabsClient({ apiKey });
}

// Default voice for Polish TTS ("Rachel" - change to preferred Polish voice)
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

// Default TTS model — multilingual v2 supports Polish
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
