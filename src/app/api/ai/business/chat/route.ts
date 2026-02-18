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
  salons,
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

// ────────────────────────────────────────────────────────────
// Industry-specific context for AI assistant
// ────────────────────────────────────────────────────────────

const INDUSTRY_CONTEXT: Record<string, {
  label: string;
  description: string;
  insights: string;
}> = {
  hair_salon: {
    label: "Salon fryzjerski",
    description: "salon specjalizujacy sie w uslugach fryzjerskich",
    insights: `KONTEKST BRANZOWY - SALON FRYZJERSKI:
- Kluczowe trendy: koloryzacja, baleyage, keratynowe prostowanie, regeneracja wlosow
- Sezonowosc: wzmozony ruch przed swietami, sylwestrem, sezonem slubnym (maj-wrzesien)
- Sredni czas wizyty: 30-120 min w zaleznosci od uslugi
- Kluczowe wskazniki: sredni przychod na fotel, wskaznik powrotow klientow, zuzycie produktow koloryzacyjnych
- Typowe wyzwania: wysoka rotacja pracownikow, zarzadzanie czasem przy zlozonych zabiegach, sezonowe spadki
- Rekomendacje: cross-selling (odzywki, szampony), pakiety lojalnosciowe, rezerwacje online redukuja no-show
- Popularne dodatkowe uslugi: stylizacja brody, zabiegi regeneracyjne, konsultacje kolorystyczne
- Konkurencja: inne salony fryzjerskie, barber shopy, salony kosmetyczne z oferta fryzjerska`,
  },
  beauty_salon: {
    label: "Salon kosmetyczny / beauty",
    description: "salon kosmetyczny oferujacy zabiegi pielegnacyjne i upieksajace",
    insights: `KONTEKST BRANZOWY - SALON KOSMETYCZNY:
- Kluczowe trendy: zabiegi anti-aging, lifting bezigowy, kwas hialuronowy, mezoterapia igowa, peeling chemiczny
- Sezonowosc: wiosna (przygotowanie do lata), jesien (regeneracja po lecie), przedswiateczny boom
- Sredni czas wizyty: 30-90 min
- Kluczowe wskazniki: przychod na stanowisko, srednia wartosc koszyka, wskaznik powrotow, zuzycie materialow zabiegowych
- Typowe wyzwania: koniecznosc ciagego szkolenia (nowe technologie), koszt sprzetu, regulacje prawne, sezonowe wahania
- Rekomendacje: programy pielegnacyjne (serie zabiegow), pakiety prezentowe, sprzedaz kosmetykow profesjonalnych
- Popularne zabiegi: oczyszczanie twarzy, manicure/pedicure, depilacja laserowa, makijaz permanentny
- Konkurencja: inne salony beauty, kliniki medycyny estetycznej, salony SPA`,
  },
  medical: {
    label: "Gabinet medyczny / klinika",
    description: "gabinet medyczny lub klinika medycyny estetycznej",
    insights: `KONTEKST BRANZOWY - GABINET MEDYCZNY / KLINIKA:
- Kluczowe trendy: medycyna estetyczna, telemedycyna, diagnostyka, medycyna prewencyjna
- Sezonowosc: mniejsze wahania niz w branzy beauty, ale wiecej wizyt sezonowych (alergie wiosna, przeziebienia zima)
- Sredni czas wizyty: 15-60 min w zaleznosci od specjalizacji
- Kluczowe wskazniki: liczba pacjentow dziennie, sredni czas oczekiwania, wskaznik powrotow, zgodnosc z regulacjami
- Typowe wyzwania: regulacje prawne, RODO, dokumentacja medyczna, ubezpieczenia, kolejki
- Rekomendacje: system przypomnien o badaniach kontrolnych, pacjenci VIP, pakiety badań profilaktycznych
- Popularne uslugi: konsultacje, USG, badania laboratoryjne, zabiegi estetyczne pod nadzorem lekarskim
- Konkurencja: inne gabinety prywatne, przychodnie NFZ, telemedycyna`,
  },
  barber: {
    label: "Barber shop",
    description: "barber shop specjalizujacy sie w meskiej stylizacji",
    insights: `KONTEKST BRANZOWY - BARBER SHOP:
- Kluczowe trendy: fade, undercut, stylizacja brody, golenie brzywa, pielegnacja meska
- Sezonowosc: stabilniejszy ruch niz salony damskie, lekki wzrost przed swietami i eventami
- Sredni czas wizyty: 20-45 min
- Kluczowe wskazniki: liczba klientow dziennie, sredni bilet, lojalnosc klientow, obroty na stanowisko
- Typowe wyzwania: budowanie spolecznosci, utrzymanie jakosci przy duzym ruchu, konkurencja cenowa
- Rekomendacje: karta lojalnosciowa, produkty do stylizacji w sprzedazy, social media (Instagram, TikTok)
- Popularne uslugi: strzyzenie + broda, golenie brzywa, pielegnacja twarzy, farbowanie
- Konkurencja: inne barber shopy, salony fryzjerskie, mobilni fryzjerzy`,
  },
  spa: {
    label: "Salon SPA / Wellness",
    description: "salon SPA i wellness z zabiegami relaksacyjnymi",
    insights: `KONTEKST BRANZOWY - SALON SPA / WELLNESS:
- Kluczowe trendy: holistyczne podejscie do zdrowia, masaze orientalne, aromaterapia, sauna, krioterapia
- Sezonowosc: zimowe miesiace (relaks), wiosna (detox), przed swietami (vouchery prezentowe)
- Sredni czas wizyty: 60-180 min
- Kluczowe wskazniki: przychod na klienta, sprzedaz voucherow, wskaznik powrotow, zuzycie olejkow/kosmetykow
- Typowe wyzwania: utrzymanie atmosfery premium, koszt utrzymania infrastruktury (sauna, jacuzzi), sezonowe wahania
- Rekomendacje: vouchery prezentowe, pakiety wellness, programy czlonkowskie, cross-selling z hotelem/restauracja
- Popularne uslugi: masaz relaksacyjny, zabieg na twarz, rytualy SPA, sauna, basen
- Konkurencja: inne SPA, hotele wellness, centra fitness z SPA`,
  },
  nail_salon: {
    label: "Salon paznokci / manicure",
    description: "salon specjalizujacy sie w stylizacji paznokci",
    insights: `KONTEKST BRANZOWY - SALON PAZNOKCI:
- Kluczowe trendy: manicure hybrydowy, zelowy, akrylowy, nail art, paznokcie press-on
- Sezonowosc: wiosna-lato (pedicure), przed swietami i sylwestrem, sezon slubny
- Sredni czas wizyty: 30-90 min
- Kluczowe wskazniki: liczba klientek dziennie, zuzycie materialow, wskaznik powrotow (co 2-4 tygodnie)
- Typowe wyzwania: konkurencja cenowa, higiena i sterylizacja, rotacja klientek miedzy salonami
- Rekomendacje: subskrypcja miesieczna, pakiety (manicure + pedicure), sprzedaz odzywek i olejkow
- Popularne uslugi: manicure hybrydowy, pedicure, przedluzanie paznokci, zdobienia
- Konkurencja: inne salony paznokci, salony kosmetyczne, mobilne stylizacje`,
  },
};

const DEFAULT_INDUSTRY_CONTEXT = {
  label: "Salon uslugowy",
  description: "salon uslugowy z branzy beauty/wellness/medycznej",
  insights: `KONTEKST BRANZOWY - OGOLNY SALON USLUGOWY:
- Kluczowe wskazniki: przychod miesieczny, liczba wizyt, wskaznik powrotow klientow, wskaznik anulacji
- Typowe wyzwania: pozyskiwanie nowych klientow, utrzymanie stalych, zarzadzanie grafikiem, no-show
- Rekomendacje: system rezerwacji online, programy lojalnosciowe, marketing w social media
- Sezonowosc: zwroc uwage na wzorce sezonowe w danych i dostosuj strategie
- Konkurencja: monitoruj lokalna konkurencje i oferuj unikalne wartosci`,
};

async function gatherSalonData(): Promise<{ data: string; industryType: string | null; salonName: string }> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    // Fetch salon info first
    const salonInfo = await db
      .select({
        name: salons.name,
        industryType: salons.industryType,
      })
      .from(salons)
      .where(eq(salons.id, DEMO_SALON_ID))
      .then((r) => r[0] ?? { name: "Salon", industryType: null });

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

    const dataStr = `
DANE SALONU "${salonInfo.name}" (aktualizacja: ${now.toLocaleDateString("pl-PL")}):
Typ dzialalnosci: ${salonInfo.industryType ? (INDUSTRY_CONTEXT[salonInfo.industryType]?.label ?? salonInfo.industryType) : "Nie okreslono"}

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

    return {
      data: dataStr,
      industryType: salonInfo.industryType,
      salonName: salonInfo.name,
    };
  } catch (error) {
    console.error("[AI Business] Error gathering salon data:", error);
    return {
      data: "Nie udalo sie pobrac danych salonu. Prosze sprobowac ponownie.",
      industryType: null,
      salonName: "Salon",
    };
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

  // Gather real salon data for context (includes industry type)
  const { data: salonData, industryType, salonName } = await gatherSalonData();

  // Get industry-specific context
  const industryCtx = industryType
    ? (INDUSTRY_CONTEXT[industryType] ?? DEFAULT_INDUSTRY_CONTEXT)
    : DEFAULT_INDUSTRY_CONTEXT;

  const openrouter = createOpenRouter({ apiKey });

  const systemPrompt = `Jestes inteligentnym asystentem biznesowym dla "${salonName}" - ${industryCtx.description}. Dzialasz w ramach platformy "MyHelper". Pomagasz wlascicielowi analizowac dane i podejmowac lepsze decyzje biznesowe, wykorzystujac swoja wiedze o specyfice branzy.

Twoje mozliwosci:
- Analizujesz dane dotyczace wizyt, przychodow, klientow i pracownikow
- Sugerujesz usprawnienia i optymalizacje DOSTOSOWANE do typu dzialalnosci (${industryCtx.label})
- Pomagasz identyfikowac trendy i wzorce specyficzne dla branzy
- Ostrzegasz o potencjalnych problemach (np. niski stan magazynowy, wysoki wskaznik anulacji)
- Dajesz rekomendacje dotyczace marketingu, cenowania i obslugi klienta w kontekscie branzy
- Znasz specyfike branzy i potrafisz udzielic porad branżowych (sezonowosc, trendy, konkurencja, najlepsze praktyki)
- Gdy uzytkownik pyta o branże, trendy rynkowe lub porownania z konkurencja, korzystasz ze swojej wiedzy branzowej

Zasady:
- Odpowiadaj TYLKO po polsku
- Bazuj na dostarczonych danych salonu - nie wymyslaj statystyk
- Mozesz jednak dzielic sie ogolna wiedza branzowa (trendy, benchmarki, najlepsze praktyki) zaznaczajac ze to informacje ogolnobrazowe
- Jezeli dane sa ograniczone, powiedz o tym wprost
- Uzywaj konkretnych liczb z danych
- Formatuj odpowiedzi czytelnie (uzywaj naglowkow, list, pogrubien)
- Badz proaktywny - zwracaj uwage na potencjalne problemy i szanse
- Przy pytaniach o branże, dostarczaj kontekst rynkowy i porownania z branza

${industryCtx.insights}

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
