import { headers } from "next/headers";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, UIMessage, convertToModelMessages } from "ai";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import {
  appointments,
  clients,
  employees,
  services,
  reviews,
  products,
} from "@/lib/schema";
import { eq, and, gte, sql, count, desc } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

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

async function gatherSalonData(): Promise<string> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const [
      totalClients,
      totalEmployees,
      activeServices,
      recentAppointmentsCount,
      appointmentsByStatus,
      topServicesList,
      topEmployeesList,
      avgRatingResult,
      lowStockItems,
      revenueResult,
    ] = await Promise.all([
      db
        .select({ count: count() })
        .from(clients)
        .where(eq(clients.salonId, DEMO_SALON_ID))
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(employees)
        .where(
          and(
            eq(employees.salonId, DEMO_SALON_ID),
            eq(employees.isActive, true)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(services)
        .where(
          and(
            eq(services.salonId, DEMO_SALON_ID),
            eq(services.isActive, true)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({
          status: appointments.status,
          count: count(),
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(appointments.status),

      db
        .select({
          serviceName: services.name,
          servicePrice: services.basePrice,
          count: count(),
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(services.name, services.basePrice)
        .orderBy(desc(count()))
        .limit(5),

      db
        .select({
          firstName: employees.firstName,
          lastName: employees.lastName,
          count: count(),
        })
        .from(appointments)
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .groupBy(employees.firstName, employees.lastName)
        .orderBy(desc(count()))
        .limit(5),

      db
        .select({
          avg: sql<string>`COALESCE(AVG(${reviews.rating}), 0)`,
          count: count(),
        })
        .from(reviews)
        .where(
          and(
            eq(reviews.salonId, DEMO_SALON_ID),
            sql`${reviews.rating} IS NOT NULL`
          )
        )
        .then((r) => ({
          average: parseFloat(r[0]?.avg ?? "0").toFixed(1),
          total: r[0]?.count ?? 0,
        })),

      db
        .select({
          name: products.name,
          quantity: products.quantity,
          minQuantity: products.minQuantity,
          unit: products.unit,
        })
        .from(products)
        .where(
          and(
            eq(products.salonId, DEMO_SALON_ID),
            sql`CAST(${products.quantity} AS numeric) <= COALESCE(CAST(${products.minQuantity} AS numeric), 5)`
          )
        )
        .limit(10),

      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, DEMO_SALON_ID),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, thirtyDaysAgo)
          )
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),
    ]);

    // Build status breakdown string
    const statusMap: Record<string, number> = {};
    for (const s of appointmentsByStatus) {
      statusMap[s.status] = s.count;
    }
    const cancelledCount = (statusMap["cancelled"] ?? 0) + (statusMap["no_show"] ?? 0);
    const cancellationRate = recentAppointmentsCount > 0
      ? ((cancelledCount / recentAppointmentsCount) * 100).toFixed(1)
      : "0";

    const topServicesStr = topServicesList
      .map((s, i) => `  ${i + 1}. ${s.serviceName} - ${s.count} wizyt (${s.servicePrice} PLN)`)
      .join("\n");

    const topEmployeesStr = topEmployeesList
      .map((e, i) => `  ${i + 1}. ${e.firstName} ${e.lastName} - ${e.count} wizyt`)
      .join("\n");

    const lowStockStr = lowStockItems.length > 0
      ? lowStockItems
          .map((p) => `  - ${p.name}: ${p.quantity} ${p.unit || "szt."} (min: ${p.minQuantity || "5"})`)
          .join("\n")
      : "  Brak produktow z niskim stanem magazynowym.";

    const statusBreakdown = Object.entries(statusMap)
      .map(([status, cnt]) => `  - ${status}: ${cnt}`)
      .join("\n");

    return `
DANE SALONU (aktualizacja: ${now.toLocaleDateString("pl-PL")}):

PODSUMOWANIE:
- Liczba klientow: ${totalClients}
- Aktywni pracownicy: ${totalEmployees}
- Aktywne uslugi: ${activeServices}

WIZYTY (ostatnie 30 dni):
- Laczna liczba wizyt: ${recentAppointmentsCount}
- Przychod z ukonczonych wizyt: ${revenueResult.toFixed(2)} PLN
- Wskaznik anulacji: ${cancellationRate}%
- Status wizyt:
${statusBreakdown}

NAJPOPULARNIEJSZE USLUGI (ostatnie 30 dni):
${topServicesStr || "  Brak danych"}

NAJBARDZIEJ AKTYWNI PRACOWNICY (ostatnie 30 dni):
${topEmployeesStr || "  Brak danych"}

OPINIE KLIENTOW:
- Srednia ocena: ${avgRatingResult.average}/5.0 (${avgRatingResult.total} opinii)

MAGAZYN - NISKI STAN:
${lowStockStr}
`.trim();
  } catch (error) {
    console.error("[AI Business] Error gathering salon data:", error);
    return "Nie udalo sie pobrac danych salonu. Prosze sprobowac ponownie.";
  }
}

export async function POST(req: Request) {
  // Verify user is authenticated
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check Pro plan requirement
  const hasPro = await isProPlan();
  if (!hasPro) {
    return new Response(
      JSON.stringify({
        error: "Funkcje AI sa dostepne tylko w Planie Pro. Przejdz na Plan Pro, aby korzystac z asystenta AI.",
        code: "PLAN_UPGRADE_REQUIRED",
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
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
      }
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
      }
    );
  }

  // Gather real salon data for context
  const salonData = await gatherSalonData();

  const openrouter = createOpenRouter({ apiKey });

  const systemPrompt = `Jestes inteligentnym asystentem biznesowym salonu kosmetycznego/fryzjerskiego "MyHelper". Pomagasz wlascicielowi analizowac dane i podejmowac lepsze decyzje biznesowe.

Twoje mozliwosci:
- Analizujesz dane dotyczace wizyt, przychodow, klientow i pracownikow
- Sugerujesz usprawnienia i optymalizacje
- Pomagasz identyfikowac trendy i wzorce
- Ostrzegasz o potencjalnych problemach (np. niski stan magazynowy, wysoki wskaznik anulacji)
- Dajesz rekomendacje dotyczace marketingu, cenowania i obslugi klienta

Zasady:
- Odpowiadaj TYLKO po polsku
- Bazuj WYLACZNIE na dostarczonych danych - nie wymyslaj statystyk
- Jezeli dane sa ograniczone, powiedz o tym wprost
- Uzywaj konkretnych liczb z danych
- Formatuj odpowiedzi czytelnie (uzywaj naglowkow, list, pogubien)
- Badz proaktywny - zwracaj uwage na potencjalne problemy i szanse

${salonData}`;

  const result = streamText({
    model: openrouter(
      process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-5-20250929"
    ),
    system: systemPrompt,
    messages: convertToModelMessages(messages),
  });

  return (
    result as unknown as { toUIMessageStreamResponse: () => Response }
  ).toUIMessageStreamResponse();
}
