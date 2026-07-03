import { UIMessage } from "ai";
import { z } from "zod";
import { streamBusinessChat } from "@/lib/ai/business/chat";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { getUserSalonId } from "@/lib/get-user-salon";
import { isProPlan } from "@/lib/subscription";
// Zod schema for message validation
const messagePartSchema = z.object({
  type: z.string(),
  text: z.string().max(10000, "Message text too long").optional(),
});

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(messagePartSchema).optional(),
  content: z.union([z.string(), z.array(messagePartSchema)]).optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(messageSchema).max(100, "Too many messages"),
});

export async function POST(req: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  // Verify authentication and resolve salon
  const salonId = await getUserSalonId();
  if (!salonId) {
    return new Response(JSON.stringify({ error: "Salon not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check Pro plan requirement
  const hasPro = await isProPlan();
  if (!hasPro) {
    return new Response(
      JSON.stringify({
        error:
          "Funkcje AI sa dostepne tylko w Planie Pro. Przejdz na Plan Pro, aby korzystac z asystenta AI.",
        code: "PLAN_UPGRADE_REQUIRED",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

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

  // Gather salon data, build the industry-aware prompt and stream the answer
  return streamBusinessChat({ salonId, apiKey, messages });
}
