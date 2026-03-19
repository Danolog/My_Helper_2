import { generateText } from "ai";
import { eq, and, ilike, sql, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  createAIClient,
  getAIModel,
  requireProAI,
  isProAIError,
} from "@/lib/ai/openrouter";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  clients,
  appointments,
  employees,
  services,
  products,
} from "@/lib/schema";

// ────────────────────────────────────────────────────────────
// Request validation
// ────────────────────────────────────────────────────────────

const requestSchema = z.object({
  query: z.string().min(1, "Zapytanie jest wymagane").max(500),
});

// ────────────────────────────────────────────────────────────
// AI intent schema — the structured filter AI must produce
// ────────────────────────────────────────────────────────────

const aiIntentSchema = z.object({
  entity: z.enum(["clients", "appointments", "services", "employees", "products"]),
  filters: z.object({
    nameContains: z.string().nullable().optional(),
    status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).nullable().optional(),
    dateFrom: z.string().nullable().optional(),
    dateTo: z.string().nullable().optional(),
  }),
  sort: z.enum(["name", "date", "price"]).nullable().optional(),
  limit: z.number().min(1).max(10).default(10),
  description: z.string(),
});

type AIIntent = z.infer<typeof aiIntentSchema>;

// ────────────────────────────────────────────────────────────
// Result item shape — uniform across all entity types
// ────────────────────────────────────────────────────────────

interface SearchResultItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchResultGroup {
  type: string;
  label: string;
  items: SearchResultItem[];
}

// ────────────────────────────────────────────────────────────
// Entity labels for response grouping
// ────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<string, string> = {
  clients: "Klienci",
  appointments: "Wizyty",
  services: "Uslugi",
  employees: "Pracownicy",
  products: "Produkty",
};

// ────────────────────────────────────────────────────────────
// Safe date parser — returns Date or null for invalid strings
// ────────────────────────────────────────────────────────────

function parseSafeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date;
}

// ────────────────────────────────────────────────────────────
// Query executors — one per entity type
// ────────────────────────────────────────────────────────────

async function searchClients(
  salonId: string,
  intent: AIIntent,
): Promise<SearchResultItem[]> {
  const conditions = [eq(clients.salonId, salonId)];

  if (intent.filters.nameContains) {
    const term = `%${intent.filters.nameContains}%`;
    conditions.push(
      sql`(${ilike(clients.firstName, term)} OR ${ilike(clients.lastName, term)} OR ${ilike(sql`CONCAT(${clients.firstName}, ' ', ${clients.lastName})`, term)})`,
    );
  }

  const rows = await db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
      phone: clients.phone,
      email: clients.email,
    })
    .from(clients)
    .where(and(...conditions))
    .orderBy(desc(clients.updatedAt))
    .limit(intent.limit);

  return rows.map((r) => ({
    id: r.id,
    title: `${r.firstName} ${r.lastName}`,
    subtitle: r.phone ? `tel: ${r.phone}` : r.email ?? "",
    href: `/dashboard/clients/${r.id}`,
  }));
}

async function searchAppointments(
  salonId: string,
  intent: AIIntent,
): Promise<SearchResultItem[]> {
  const conditions = [eq(appointments.salonId, salonId)];

  if (intent.filters.status) {
    conditions.push(eq(appointments.status, intent.filters.status));
  }

  const dateFrom = parseSafeDate(intent.filters.dateFrom);
  const dateTo = parseSafeDate(intent.filters.dateTo);

  if (dateFrom) {
    conditions.push(gte(appointments.startTime, dateFrom));
  }
  if (dateTo) {
    // Include the entire day by setting to end of day
    const endOfDay = new Date(dateTo);
    endOfDay.setHours(23, 59, 59, 999);
    conditions.push(lte(appointments.startTime, endOfDay));
  }

  // Sort by date (default: most recent first)
  const orderBy = intent.sort === "date"
    ? desc(appointments.startTime)
    : desc(appointments.startTime);

  const rows = await db
    .select({
      id: appointments.id,
      startTime: appointments.startTime,
      status: appointments.status,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      serviceName: services.name,
      guestName: appointments.guestName,
    })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(services, eq(appointments.serviceId, services.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(intent.limit);

  return rows.map((r) => {
    const clientName = r.clientFirstName
      ? `${r.clientFirstName} ${r.clientLastName ?? ""}`.trim()
      : r.guestName ?? "Brak klienta";
    const serviceName = r.serviceName ?? "Brak uslugi";
    const dateStr = r.startTime.toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timeStr = r.startTime.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      id: r.id,
      title: `${clientName} - ${serviceName}`,
      subtitle: `${dateStr} ${timeStr}`,
      href: `/dashboard/appointments/${r.id}`,
    };
  });
}

async function searchServices(
  salonId: string,
  intent: AIIntent,
): Promise<SearchResultItem[]> {
  const conditions = [
    eq(services.salonId, salonId),
    eq(services.isActive, true),
  ];

  if (intent.filters.nameContains) {
    conditions.push(ilike(services.name, `%${intent.filters.nameContains}%`));
  }

  // Sort by price descending when requested, otherwise by name
  const orderBy = intent.sort === "price"
    ? desc(sql`CAST(${services.basePrice} AS numeric)`)
    : services.name;

  const rows = await db
    .select({
      id: services.id,
      name: services.name,
      basePrice: services.basePrice,
      baseDuration: services.baseDuration,
    })
    .from(services)
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(intent.limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    subtitle: `${r.basePrice} PLN, ${r.baseDuration} min`,
    href: "/dashboard/services",
  }));
}

async function searchEmployees(
  salonId: string,
  intent: AIIntent,
): Promise<SearchResultItem[]> {
  const conditions = [
    eq(employees.salonId, salonId),
    eq(employees.isActive, true),
  ];

  if (intent.filters.nameContains) {
    const term = `%${intent.filters.nameContains}%`;
    conditions.push(
      sql`(${ilike(employees.firstName, term)} OR ${ilike(employees.lastName, term)} OR ${ilike(sql`CONCAT(${employees.firstName}, ' ', ${employees.lastName})`, term)})`,
    );
  }

  const rows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      role: employees.role,
    })
    .from(employees)
    .where(and(...conditions))
    .orderBy(employees.firstName)
    .limit(intent.limit);

  return rows.map((r) => ({
    id: r.id,
    title: `${r.firstName} ${r.lastName}`,
    subtitle: r.role === "owner" ? "wlasciciel" : r.role === "receptionist" ? "recepcjonista" : "pracownik",
    href: "/dashboard/employees",
  }));
}

async function searchProducts(
  salonId: string,
  intent: AIIntent,
): Promise<SearchResultItem[]> {
  const conditions = [eq(products.salonId, salonId)];

  if (intent.filters.nameContains) {
    conditions.push(ilike(products.name, `%${intent.filters.nameContains}%`));
  }

  // If the query is about low stock, filter for items at or below minimum
  const queryLower = intent.description.toLowerCase();
  const isLowStock = queryLower.includes("niski stan") ||
    queryLower.includes("konczy sie") ||
    queryLower.includes("brakuje") ||
    queryLower.includes("low stock");

  if (isLowStock) {
    conditions.push(
      sql`CAST(${products.quantity} AS numeric) <= COALESCE(CAST(${products.minQuantity} AS numeric), 5)`,
    );
  }

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      quantity: products.quantity,
      unit: products.unit,
    })
    .from(products)
    .where(and(...conditions))
    .orderBy(products.name)
    .limit(intent.limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.name,
    subtitle: `${r.quantity ?? "0"} ${r.unit ?? "szt."}`,
    href: "/dashboard/products",
  }));
}

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
    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `Jestes parserem zapytan wyszukiwania dla systemu zarzadzania salonem kosmetycznym/fryzjerskim.

Zwroc TYLKO JSON (bez dodatkowego tekstu):
{
  "entity": "clients" | "appointments" | "services" | "employees" | "products",
  "filters": {
    "nameContains": "tekst" | null,
    "status": "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show" | null,
    "dateFrom": "YYYY-MM-DD" | null,
    "dateTo": "YYYY-MM-DD" | null
  },
  "sort": "name" | "date" | "price" | null,
  "limit": 10,
  "description": "krotki opis po polsku co szukamy"
}

Przyklady:
- "klienci ktorzy nie byli 3 miesiace" -> entity: "clients", dateFrom: null, dateTo: 3 miesiace temu, description: "Klienci bez wizyty od 3 miesiecy"
- "wizyty jutro" -> entity: "appointments", dateFrom: jutro, dateTo: jutro, description: "Wizyty na jutro"
- "wizyty na ten tydzien" -> entity: "appointments", dateFrom: dzis, dateTo: koniec tygodnia
- "najdrozsze uslugi" -> entity: "services", sort: "price", description: "Najdrozsze uslugi"
- "Anna Kowalska" -> entity: "clients", filters.nameContains: "Anna Kowalska"
- "produkty z niskim stanem" -> entity: "products", description: "Produkty z niskim stanem magazynowym"
- "anulowane wizyty w tym miesiacu" -> entity: "appointments", status: "cancelled", dateFrom: poczatek miesiaca, dateTo: dzis

Dzisiejsza data: ${today}
Odpowiadaj TYLKO po polsku w polu description.`;

    const openrouter = createAIClient();
    const aiResult = await generateText({
      model: openrouter(getAIModel()),
      system: systemPrompt,
      prompt: query,
      maxOutputTokens: 300,
    });

    const responseText = aiResult.text.trim();

    // Parse JSON from AI response, with fallback for malformed output
    let parsedIntent: AIIntent;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in AI response");
      const raw = JSON.parse(jsonMatch[0]);
      const validated = aiIntentSchema.safeParse(raw);
      if (!validated.success) {
        throw new Error(`Invalid AI intent: ${validated.error.message}`);
      }
      parsedIntent = validated.data;
    } catch (parseError) {
      logger.warn("[AI Search] Failed to parse AI response", {
        responseText,
        error: parseError instanceof Error ? parseError.message : String(parseError),
      });
      return Response.json(
        { error: "Nie udalo sie zinterpretowac zapytania. Sprobuj inaczej sformulowac." },
        { status: 422 },
      );
    }

    // Execute the safe DB query based on the parsed entity type
    const queryExecutors: Record<string, (sId: string, intent: AIIntent) => Promise<SearchResultItem[]>> = {
      clients: searchClients,
      appointments: searchAppointments,
      services: searchServices,
      employees: searchEmployees,
      products: searchProducts,
    };

    const executor = queryExecutors[parsedIntent.entity];
    if (!executor) {
      return Response.json(
        { error: "Nieznany typ encji" },
        { status: 400 },
      );
    }

    const items = await executor(salonId, parsedIntent);

    const results: SearchResultGroup[] = [
      {
        type: parsedIntent.entity,
        label: ENTITY_LABELS[parsedIntent.entity] ?? parsedIntent.entity,
        items,
      },
    ];

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
