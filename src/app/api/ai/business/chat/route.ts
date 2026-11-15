import { UIMessage } from "ai";
import { z } from "zod";
import { streamBusinessChat } from "@/lib/ai/business/chat";
import { isProAIError, requireProAI, trackAIUsage } from "@/lib/ai/openrouter";
// Limity wejścia
const MAX_PART_TEXT = 10_000;
const MAX_PARTS = 20;
const MAX_CONTENT = 10_000;
const MAX_MESSAGES = 100;
/** Górna granica tekstu w jednym zapytaniu (suma wszystkich wiadomości). */
const MAX_TOTAL_CHARS = 60_000;

const messagePartSchema = z.object({
  type: z.string().max(64),
  text: z.string().max(MAX_PART_TEXT, "Message text too long").optional(),
});

const messageSchema = z.object({
  id: z.string().max(128).optional(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(messagePartSchema).max(MAX_PARTS).optional(),
  content: z
    .union([
      z.string().max(MAX_CONTENT),
      z.array(messagePartSchema).max(MAX_PARTS),
    ])
    .optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).max(MAX_MESSAGES, "Too many messages"),
});

type ChatMessage = z.infer<typeof messageSchema>;

function totalChars(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    for (const p of m.parts ?? []) n += p.text?.length ?? 0;
    if (typeof m.content === "string") n += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const p of m.content) n += p.text?.length ?? 0;
    }
  }
  return n;
}

export async function POST(req: Request) {
  const gate = await requireProAI({ op: "text" });
  if (isProAIError(gate)) return gate;
  const { salonId } = gate;

  // Parse and validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Limit łączny — przed wywołaniem modelu i przed zapisem zużycia
  if (totalChars(parsed.data.messages) > MAX_TOTAL_CHARS) {
    return Response.json(
      {
        error: "Rozmowa jest zbyt dluga. Rozpocznij nowa rozmowe.",
        code: "INPUT_TOO_LONG",
      },
      { status: 400 },
    );
  }

  const { messages }: { messages: UIMessage[] } = parsed.data as {
    messages: UIMessage[];
  };

  // Initialize OpenRouter with API key
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OpenRouter API key not configured" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Fire-and-forget: liczy sie w /dashboard/ai-usage i budzecie AI (UAT B-9)
  void trackAIUsage(salonId, "business_chat", {
    messageCount: messages.length,
  });

  // Gather salon data, build the industry-aware prompt and stream the answer
  return streamBusinessChat({ salonId, apiKey, messages });
}
