import { NextResponse } from "next/server";
import twilio from "twilio";
import { logger } from "@/lib/logger";

const { VoiceResponse } = twilio.twiml;

// ────────────────────────────────────────────────────────────
// Constants for Polish TTS voice and speech recognition
// ────────────────────────────────────────────────────────────

/** Polish Neural voice (Amazon Polly via Twilio) */
const POLISH_VOICE = "Polly.Ola-Neural" as const;
const POLISH_LANGUAGE = "pl-PL" as const;

/** Maximum AI response tokens — keep voice replies concise */
const MAX_AI_TOKENS = 200;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Build a TwiML <Say> with Polish voice and language.
 */
function polishSay(
  twiml: InstanceType<typeof VoiceResponse>,
  text: string,
): void {
  twiml.say({ language: POLISH_LANGUAGE, voice: POLISH_VOICE }, text);
}

/**
 * Build a TwiML <Gather> configured for Polish speech input.
 * The caller speaks; Twilio posts the transcript back to our webhook.
 */
function polishGather(
  twiml: InstanceType<typeof VoiceResponse>,
  prompt: string,
): void {
  const gather = twiml.gather({
    input: ["speech"],
    language: POLISH_LANGUAGE,
    speechTimeout: "auto",
    action: "/api/ai/voice/twilio/webhook",
  });
  gather.say({ language: POLISH_LANGUAGE, voice: POLISH_VOICE }, prompt);
}

/**
 * Extract the JSON object from an AI response that may contain markdown
 * fences or surrounding prose. Returns null if parsing fails.
 */
function extractJSON(text: string): { intent?: string; response?: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match?.[0]) return null;
  try {
    return JSON.parse(match[0]) as { intent?: string; response?: string };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// POST /api/ai/voice/twilio/webhook
//
// Twilio sends a POST here when:
//   1. A new inbound call arrives (no SpeechResult)
//   2. The caller spoke and Twilio transcribed it (SpeechResult present)
//
// NOTE: This endpoint is NOT authenticated via requireProAI because
// it is called directly by Twilio servers, not by a browser session.
// In production, validate the Twilio request signature (X-Twilio-Signature).
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const from = formData.get("From") as string | null;
    const to = formData.get("To") as string | null;
    const callSid = formData.get("CallSid") as string | null;
    const speechResult = formData.get("SpeechResult") as string | null;

    logger.info("[Twilio] Incoming call webhook", { from, to, callSid });

    const response = new VoiceResponse();

    if (!speechResult) {
      // ── Initial greeting ─────────────────────────────────
      // No speech yet — greet the caller and listen for their request.
      polishGather(
        response,
        "Witamy w salonie. Jak moge pomoc? " +
          "Mozesz umowic wizyte, odwolac wizyte lub zapytac o dostepne uslugi.",
      );

      // Fallback if no speech detected within timeout
      polishSay(response, "Nie uslyszalam. Prosze sprobowac ponownie.");
      response.redirect("/api/ai/voice/twilio/webhook");
    } else {
      // ── Interpret speech via AI ──────────────────────────
      logger.info("[Twilio] Speech result", { callSid, speechResult });

      const aiResponse = await interpretSpeech(speechResult);

      polishSay(response, aiResponse);

      // Continue the conversation — ask if there is anything else
      polishGather(response, "Czy moge w czyms jeszcze pomoc?");

      // End call if no further input
      polishSay(response, "Dziekuje za polaczenie. Do widzenia!");
      response.hangup();
    }

    return new NextResponse(response.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    logger.error("[Twilio] Webhook error", { error });

    // Return a graceful error TwiML so the caller hears something
    const errorResponse = new VoiceResponse();
    polishSay(errorResponse, "Przepraszam, wystapil blad techniczny.");
    errorResponse.hangup();

    return new NextResponse(errorResponse.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  }
}

// ────────────────────────────────────────────────────────────
// AI intent interpretation
// ────────────────────────────────────────────────────────────

const FALLBACK_RESPONSE =
  "Przepraszam, nie rozumiem. Czy mogę w czymś innym pomóc?";

/**
 * Use OpenRouter AI to interpret the caller's speech and produce a
 * short Polish response. Dynamic imports keep the cold-start fast
 * when the webhook is first loaded by Twilio.
 */
async function interpretSpeech(transcript: string): Promise<string> {
  try {
    const { createAIClient, getAIModel } = await import(
      "@/lib/ai/openrouter"
    );
    const { generateText } = await import("ai");

    const openrouter = createAIClient();

    const result = await generateText({
      model: openrouter(getAIModel()),
      system: `Jestes asystentem glosowym salonu kosmetycznego. Interpretuj co chce dzwoniacy klient.
Zwroc JSON: { "intent": "book" | "cancel" | "info" | "hours" | "unknown", "response": "odpowiedz po polsku max 2 zdania" }
Odpowiadaj krotko i konkretnie — klient slucha przez telefon.`,
      prompt: transcript,
      maxOutputTokens: MAX_AI_TOKENS,
    });

    const parsed = extractJSON(result.text);
    return parsed?.response ?? FALLBACK_RESPONSE;
  } catch (error) {
    logger.error("[Twilio] AI interpretation error", { error });
    return FALLBACK_RESPONSE;
  }
}
