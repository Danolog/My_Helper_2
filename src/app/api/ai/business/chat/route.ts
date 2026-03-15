import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText, UIMessage, convertToModelMessages } from "ai";
import { z } from "zod";
import { isProPlan } from "@/lib/subscription";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
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

import { logger } from "@/lib/logger";
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

const INDUSTRY_CONTEXT: Record<
  string,
  {
    label: string;
    description: string;
    insights: string;
  }
> = {
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

ANALIZA KONKURENCJI - SALON FRYZJERSKI:
- Glowni konkurenci: inne salony fryzjerskie, barber shopy, salony kosmetyczne z oferta fryzjerska, mobilni fryzjerzy
- Platformy rezerwacyjne konkurencji: Booksy, Moment.pl, Fresha, Versum - sprawdz jakie salony w Twojej okolicy tam sa i jak sie prezentuja
- Srednie ceny rynkowe (Polska): strzyzenie damskie 60-120 PLN, meskie 30-60 PLN, koloryzacja 150-350 PLN, baleyage 200-500 PLN
- Sposoby wyroznenia sie: unikalna specjalizacja (np. kolor, loki, naturalne fryzury), ekologiczne produkty, programy lojalnosciowe, aktywny Instagram/TikTok
- Kluczowe przewagi do budowania: spersonalizowana obsluga, system rezerwacji online 24/7, niski wskaznik anulacji, krotki czas oczekiwania
- Zagrozenia konkurencyjne: salony niskobudzetowe (sieciowe), uslugi domowe, sieci franczyzowe (np. Jean Louis David)
- Akcje obronne: buduj spolecznosc (social media), rozwijaj program polecen, oferuj pakiety VIP, inwestuj w szkolenia zespolu
- Benchmarki branzowe: wskaznik powrotow klientow >60% to dobry wynik, anulacje <10% to norma, sredni bilet rosnie o 5-8% rocznie`,
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

ANALIZA KONKURENCJI - SALON KOSMETYCZNY:
- Glowni konkurenci: inne salony beauty, kliniki medycyny estetycznej, salony SPA, gabinety kosmetologiczne
- Platformy rezerwacyjne: Booksy, Fresha, Moment.pl, Versum - monitoruj oferty i ceny konkurencji w okolicy
- Srednie ceny rynkowe: oczyszczanie twarzy 100-200 PLN, mezoterapia 200-500 PLN, depilacja laserowa 100-400 PLN, makijaz permanentny 500-1500 PLN
- Sposoby wyroznenia sie: specjalizacja w konkretnym zabiegu (np. anti-aging, aparatura), certyfikaty i kwalifikacje, efekty before/after na social media
- Kluczowe przewagi: najnowsze technologie (laser, HIFU, RF), wysoko wykwalifikowany personel, higieniczne standardy premium
- Zagrozenia konkurencyjne: kliniki medycyny estetycznej z nizsza cena, szara strefa (zabiegi w domu), import tanich urzadzen
- Akcje obronne: buduj portfolio efektow zabiegow, zbieraj opinie, oferuj konsultacje bezplatne, wprowadz serie zabiegow z rabatem
- Benchmarki: sredni koszyk 150-300 PLN, powracalnosc klientek >50%, optymalna oblozentosc >70%`,
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
- Rekomendacje: system przypomnien o badaniach kontrolnych, pacjenci VIP, pakiety badan profilaktycznych
- Popularne uslugi: konsultacje, USG, badania laboratoryjne, zabiegi estetyczne pod nadzorem lekarskim

ANALIZA KONKURENCJI - GABINET MEDYCZNY:
- Glowni konkurenci: inne gabinety prywatne, przychodnie NFZ, telemedycyna, kliniki sieciowe (Medicover, Lux Med, Enel-Med)
- Platformy: ZnanyLekarz, Booksy (medycyna estetyczna), Doctolib - porownaj swoje oceny i ceny z konkurencja
- Srednie ceny: konsultacja specjalistyczna 150-300 PLN, USG 100-250 PLN, medycyna estetyczna 300-2000 PLN za zabieg
- Sposoby wyroznenia sie: specjalizacja niszowa, krotki czas oczekiwania, kompleksowa opieka, wyniki leczenia
- Kluczowe przewagi: doswiadczenie lekarzy, nowoczesny sprzet diagnostyczny, podejscie pacjento-centryczne
- Zagrozenia: kliniki sieciowe z duzym budzetem marketingowym, telemedycyna (nizsze ceny), NFZ (bezplatne wizyty)
- Akcje obronne: buduj reputacje na ZnanyLekarz, oferuj pakiety profilaktyczne, skracaj czas oczekiwania, rozwijaj teleporady
- Benchmarki: ocena na ZnanyLekarz >4.5 to dobry wynik, czas oczekiwania <7 dni, powracalnosc pacjentow >40%`,
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

ANALIZA KONKURENCJI - BARBER SHOP:
- Glowni konkurenci: inne barber shopy, salony fryzjerskie z oferta meska, mobilni fryzjerzy, sieciowe barbershopy
- Platformy rezerwacyjne: Booksy (dominuje w barber), Fresha, Google Maps - kluczowe dla widocznosci
- Srednie ceny rynkowe: strzyzenie meskie 40-80 PLN, broda 20-40 PLN, combo (strzyzenie+broda) 50-100 PLN, golenie brzywa 30-60 PLN
- Sposoby wyroznienia sie: klimat lokalu (industrial, vintage), wysoka jakosc obslugi, unikalne doswiadczenie (piwo, whisky, gry)
- Kluczowe przewagi: lojalnosc klientow (mezczyzni rzadziej zmieniaja fryzjera), regularne wizyty co 3-4 tyg, spolecznosc
- Zagrozenia: rosnaca konkurencja (boom na barbershopy), walka cenowa, utrata klientow do salonow unisex
- Akcje obronne: buduj spolecznosc (eventy, social media), program lojalnosciowy, produkty wlasnej marki, subskrypcja miesieczna
- Benchmarki: 8-12 klientow/dzien na barbera, powracalnosc >70%, sredni bilet 50-80 PLN`,
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

ANALIZA KONKURENCJI - SALON SPA:
- Glowni konkurenci: inne SPA, hotele wellness (np. Novotel, Marriott), centra fitness z SPA, termy i aquaparki
- Platformy: Booksy, Google Maps, TripAdvisor (turysci), Groupon (okazyjnie)
- Srednie ceny: masaz klasyczny 120-200 PLN/h, rytualy SPA 200-500 PLN, pakiety dzienne 300-800 PLN
- Sposoby wyroznenia sie: unikalne rytualy (wlasna marka), produkty premium (Thalgo, Dermalogica), klimat i design
- Kluczowe przewagi: doswiadczenie immersyjne, pakiety na prezent, programy czlonkowskie z rabatami
- Zagrozenia: hotele wellness z wiekszym budzetem, home SPA (DIY), Groupon obnizajacy postrzegana wartosc
- Akcje obronne: buduj marke premium, unikaj Groupona, rozwijaj sprzedaz voucherow, programy czlonkowskie
- Benchmarki: sredni koszyk 200-400 PLN, sprzedaz voucherow stanowi 15-25% obrotu, oblozentosc >60%`,
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

ANALIZA KONKURENCJI - SALON PAZNOKCI:
- Glowni konkurenci: inne salony paznokci, salony kosmetyczne z oferta manicure, mobilne stylizacje, salony azjatyckie (niskobudzetowe)
- Platformy: Booksy (bardzo popularne w nail), Instagram (portfolio prac), Google Maps
- Srednie ceny: manicure hybrydowy 80-140 PLN, pedicure hybrydowy 100-160 PLN, przedluzanie 120-250 PLN, nail art +20-60 PLN
- Sposoby wyroznenia sie: portfolio zdobien na Instagramie, szybkosc obslugi, higiena (sterylizacja, jednorazowe pilniki), produkty premium
- Kluczowe przewagi: regularne wizyty (co 2-4 tyg = staly dochod), niski prog wejscia, wysoka lojalnosc przy dobrej jakosci
- Zagrozenia: salony niskobudzetowe (50-70 PLN za manicure), praca na czarno, domowe zestawy do hybryd
- Akcje obronne: podkreslaj higiene i jakosc materialow, buduj portfolio na IG, wprowadz pakiety miesieczne, program polecen
- Benchmarki: 5-8 klientek/dzien na stanowisko, powracalnosc >65%, sredni bilet 100-150 PLN`,
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

ANALIZA KONKURENCJI - OGOLNA:
- Glowni konkurenci: inne salony uslugowe w okolicy, platformy rezerwacyjne (Booksy, Fresha, Moment.pl, Versum)
- Sposoby wyroznenia sie: specjalizacja, jakosc obslugi, system rezerwacji online, program lojalnosciowy
- Kluczowe przewagi do budowania: spersonalizowana obsluga, niski wskaznik anulacji, wysoka jakosc uslug
- Zagrozenia: sieci franczyzowe, uslugi domowe/mobilne, niskobudzetowa konkurencja
- Akcje obronne: buduj spolecznosc (social media), zbieraj opinie, oferuj programy lojalnosciowe, inwestuj w szkolenia
- Benchmarki branzowe: powracalnosc >50% to dobry wynik, anulacje <10%, srednia ocena >4.5/5`,
};

async function gatherSalonData(salonId: string): Promise<{
  data: string;
  industryType: string | null;
  salonName: string;
}> {
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
      .where(eq(salons.id, salonId))
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
        .where(eq(clients.salonId, salonId))
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(employees)
        .where(
          and(
            eq(employees.salonId, salonId),
            eq(employees.isActive, true),
          ),
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(services)
        .where(
          and(
            eq(services.salonId, salonId),
            eq(services.isActive, true),
          ),
        )
        .then((r) => r[0]?.count ?? 0),

      db
        .select({ count: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
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
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
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
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
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
            eq(appointments.salonId, salonId),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
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
            eq(reviews.salonId, salonId),
            sql`${reviews.rating} IS NOT NULL`,
          ),
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
            eq(products.salonId, salonId),
            sql`CAST(${products.quantity} AS numeric) <= COALESCE(CAST(${products.minQuantity} AS numeric), 5)`,
          ),
        )
        .limit(10),

      db
        .select({
          total:
            sql<string>`COALESCE(SUM(CAST(${services.basePrice} AS numeric)), 0)`,
        })
        .from(appointments)
        .innerJoin(services, eq(appointments.serviceId, services.id))
        .where(
          and(
            eq(appointments.salonId, salonId),
            eq(appointments.status, "completed"),
            gte(appointments.startTime, thirtyDaysAgo),
          ),
        )
        .then((r) => parseFloat(r[0]?.total ?? "0")),
    ]);

    // Build status breakdown string
    const statusMap: Record<string, number> = {};
    for (const s of appointmentsByStatus) {
      statusMap[s.status] = s.count;
    }
    const cancelledCount =
      (statusMap["cancelled"] ?? 0) + (statusMap["no_show"] ?? 0);
    const cancellationRate =
      recentAppointmentsCount > 0
        ? ((cancelledCount / recentAppointmentsCount) * 100).toFixed(1)
        : "0";

    const topServicesStr = topServicesList
      .map(
        (s, i) =>
          `  ${i + 1}. ${s.serviceName} - ${s.count} wizyt (${s.servicePrice} PLN)`,
      )
      .join("\n");

    const topEmployeesStr = topEmployeesList
      .map(
        (e, i) =>
          `  ${i + 1}. ${e.firstName} ${e.lastName} - ${e.count} wizyt`,
      )
      .join("\n");

    const lowStockStr =
      lowStockItems.length > 0
        ? lowStockItems
            .map(
              (p) =>
                `  - ${p.name}: ${p.quantity} ${p.unit || "szt."} (min: ${p.minQuantity || "5"})`,
            )
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
    logger.error("[AI Business] Error gathering salon data", { error: error });
    return {
      data: "Nie udalo sie pobrac danych salonu. Prosze sprobowac ponownie.",
      industryType: null,
      salonName: "Salon",
    };
  }
}

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

  // Gather real salon data for context (includes industry type)
  const {
    data: salonData,
    industryType,
    salonName,
  } = await gatherSalonData(salonId);

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
- Znasz specyfike branzy i potrafisz udzielic porad branzowych (sezonowosc, trendy, konkurencja, najlepsze praktyki)
- Gdy uzytkownik pyta o branze, trendy rynkowe lub porownania z konkurencja, korzystasz ze swojej wiedzy branzowej
- ANALIZA KONKURENCJI: Potrafisz analizowac pozycje salonu na tle konkurencji w branzy. Porownujesz ceny, uslugi, wskazniki z benchmarkami branzowymi. Identyfikujesz zagrozenia konkurencyjne i sugerujesz konkretne akcje obronne. Wskazujesz sposoby wyroznenia sie na rynku.

Zasady:
- Odpowiadaj TYLKO po polsku
- Bazuj na dostarczonych danych salonu - nie wymyslaj statystyk
- Mozesz jednak dzielic sie ogolna wiedza branzowa (trendy, benchmarki, najlepsze praktyki, analiza konkurencji) zaznaczajac ze to informacje ogolnobranzowe
- Jezeli dane sa ograniczone, powiedz o tym wprost
- Uzywaj konkretnych liczb z danych
- Formatuj odpowiedzi czytelnie (uzywaj naglowkow, list, pogrubien)
- Badz proaktywny - zwracaj uwage na potencjalne problemy i szanse
- Przy pytaniach o branze, dostarczaj kontekst rynkowy i porownania z branza
- Przy pytaniach o konkurencje, podawaj KONKRETNE i AKCJONALNE sugestie: co robic, jak sie wyrozniac, jakie platformy monitorowac, jakie ceny stosuja konkurenci, jakie benchmarki celowac

${industryCtx.insights}

${salonData}`;

  const result = streamText({
    model: openrouter(
      process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4",
    ),
    system: systemPrompt,
    messages: convertToModelMessages(messages),
    maxOutputTokens: 2000,
  });

  return (
    result as unknown as { toUIMessageStreamResponse: () => Response }
  ).toUIMessageStreamResponse();
}
