import { z } from "zod";
import {
  requireProAI,
  isProAIError,
  trackAIUsage,
} from "@/lib/ai/openrouter";
import {
  parseSearchIntent,
  searchByIntent,
  type SearchResultGroup,
} from "@/lib/ai/search";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  query: z.string().min(1, "Zapytanie jest wymagane").max(500),
});

// ────────────────────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Combined auth + salon + Pro plan check
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

  const { query } = parsed.data;

  try {
    // Ask AI to parse the natural language query into a structured intent
    const parsedIntent = await parseSearchIntent(query);
    if (!parsedIntent) {
      return Response.json(
        { error: "Nie udalo sie zinterpretowac zapytania. Sprobuj inaczej sformulowac." },
        { status: 422 },
      );
    }

    // Execute the safe DB query based on the parsed entity type
    const results: SearchResultGroup[] | null = await searchByIntent(
      salonId,
      parsedIntent,
    );
    if (!results) {
      return Response.json(
        { error: "Nieznany typ encji" },
        { status: 400 },
      );
    }

    void trackAIUsage(salonId, "search");

    return Response.json({
      success: true,
      results,
      description: parsedIntent.description,
    });
  } catch (error) {
    logger.error("[AI Search] Error processing search query", { error });
    return Response.json(
      { error: "Blad podczas wyszukiwania. Sprobuj ponownie." },
      { status: 500 },
    );
  }
}
