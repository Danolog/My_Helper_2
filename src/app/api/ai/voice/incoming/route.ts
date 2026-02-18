import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { salons, services, employees, aiConversations } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

type VoiceAiConfig = {
  enabled: boolean;
  greeting: string;
  businessHoursOnly: boolean;
  language: string;
  voiceStyle: string;
  maxCallDuration: number;
  transferToHumanEnabled: boolean;
  transferPhoneNumber: string;
  capabilities: {
    bookAppointments: boolean;
    checkAvailability: boolean;
    cancelAppointments: boolean;
    rescheduleAppointments: boolean;
    answerFaq: boolean;
  };
};

/**
 * POST /api/ai/voice/incoming
 * Simulates an incoming phone call handled by Voice AI.
 * In production, this would integrate with a telephony provider (e.g., Twilio).
 * For now, it simulates the voice AI processing a caller's message.
 */
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  let body: { callerMessage: string; callerPhone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.callerMessage || typeof body.callerMessage !== "string") {
    return NextResponse.json({ error: "callerMessage is required" }, { status: 400 });
  }

  try {
    // Load voice AI config
    const salonRows = await db
      .select({ settingsJson: salons.settingsJson, name: salons.name, phone: salons.phone })
      .from(salons)
      .where(eq(salons.id, DEMO_SALON_ID))
      .limit(1);

    const salon = salonRows[0];
    if (!salon) {
      return NextResponse.json({ error: "Salon nie znaleziony" }, { status: 404 });
    }

    const settings = (salon.settingsJson || {}) as Record<string, unknown>;
    const config = settings.voiceAi as VoiceAiConfig | undefined;

    if (!config?.enabled) {
      return NextResponse.json(
        { error: "Asystent glosowy AI jest wylaczony. Wlacz go w ustawieniach." },
        { status: 400 }
      );
    }

    // Get salon context: services and employees
    const [salonServices, salonEmployees] = await Promise.all([
      db
        .select({ id: services.id, name: services.name, price: services.basePrice, duration: services.baseDuration })
        .from(services)
        .where(and(eq(services.salonId, DEMO_SALON_ID), eq(services.isActive, true))),
      db
        .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
        .from(employees)
        .where(and(eq(employees.salonId, DEMO_SALON_ID), eq(employees.isActive, true))),
    ]);

    // Build AI response based on caller message and salon context
    const aiResponse = generateVoiceResponse(
      body.callerMessage,
      config,
      salon.name || "Nasz salon",
      salonServices,
      salonEmployees
    );

    // Log the conversation in database
    const [conversation] = await db
      .insert(aiConversations)
      .values({
        salonId: DEMO_SALON_ID,
        channel: "voice",
        transcript: JSON.stringify({
          callerPhone: body.callerPhone || "symulacja",
          callerMessage: body.callerMessage,
          aiResponse: aiResponse.message,
          intent: aiResponse.intent,
          timestamp: new Date().toISOString(),
        }),
      })
      .returning();

    return NextResponse.json({
      conversationId: conversation.id,
      greeting: config.greeting,
      response: aiResponse.message,
      intent: aiResponse.intent,
      intentLabel: aiResponse.intentLabel,
      suggestedAction: aiResponse.suggestedAction,
      voiceStyle: config.voiceStyle,
      language: config.language,
      transferToHuman: aiResponse.transferToHuman,
    });
  } catch (error) {
    console.error("[Voice AI Incoming] Error:", error);
    return NextResponse.json({ error: "Blad przetwarzania polaczenia" }, { status: 500 });
  }
}

type ServiceInfo = { id: string; name: string; price: string; duration: number };
type EmployeeInfo = { id: string; firstName: string; lastName: string };

type VoiceResponse = {
  message: string;
  intent: string;
  intentLabel: string;
  suggestedAction: string | null;
  transferToHuman: boolean;
};

function generateVoiceResponse(
  callerMessage: string,
  config: VoiceAiConfig,
  salonName: string,
  servicesList: ServiceInfo[],
  employeesList: EmployeeInfo[]
): VoiceResponse {
  const msg = callerMessage.toLowerCase();

  // Detect intent - booking / appointment
  if (matchesIntent(msg, ["umowic", "wizyta", "rezerwac", "termin", "zarezerwow", "booking", "book", "appointment", "zapisac", "haircut", "strzyz", "fryzj", "koloryz", "manicure", "pedicure", "masaz", "zabieg"])) {
    if (!config.capabilities.bookAppointments) {
      return {
        message: `Rozumiem, ze chcialby/chcialaby Pan/Pani umowic wizyte. Niestety, rezerwacja przez telefon nie jest teraz dostepna. Prosze odwiedzic nasza strone internetowa lub zadzwonic ponownie w godzinach pracy.`,
        intent: "book_appointment",
        intentLabel: "Rezerwacja wizyty",
        suggestedAction: "redirect_website",
        transferToHuman: false,
      };
    }

    const servicesText = servicesList.length > 0
      ? servicesList.slice(0, 5).map(s => `${s.name} (${s.price} PLN, ${s.duration} min)`).join(", ")
      : "Prosze zapytac o szczegoly";

    return {
      message: `Oczywiscie! Chetnie pomoge umowic wizyte w ${salonName}. Oferujemy nastepujace uslugi: ${servicesText}. Ktora usluge Pan/Pani wybiera? Prosze tez podac preferowany dzien i godzine, a sprawdze dostepne terminy.`,
      intent: "book_appointment",
      intentLabel: "Rezerwacja wizyty",
      suggestedAction: "show_services",
      transferToHuman: false,
    };
  }

  if (matchesIntent(msg, ["odwolac", "anulowac", "cancel", "odwolanie", "rezygnuj"])) {
    if (!config.capabilities.cancelAppointments) {
      return {
        message: "Rozumiem, ze chce Pan/Pani odwolac wizyte. Prosze skontaktowac sie bezposrednio z salonem w godzinach pracy.",
        intent: "cancel_appointment",
        intentLabel: "Odwolanie wizyty",
        suggestedAction: null,
        transferToHuman: config.transferToHumanEnabled,
      };
    }

    return {
      message: "Rozumiem, ze chce Pan/Pani odwolac wizyte. Prosze podac imie i nazwisko oraz przyblizony termin wizyty, a sprawdze to w systemie.",
      intent: "cancel_appointment",
      intentLabel: "Odwolanie wizyty",
      suggestedAction: "lookup_appointment",
      transferToHuman: false,
    };
  }

  if (matchesIntent(msg, ["przeniesc", "zmienic termin", "przesun", "reschedule", "inny termin", "przeloz"])) {
    if (!config.capabilities.rescheduleAppointments) {
      return {
        message: "Rozumiem, ze chce Pan/Pani zmienic termin wizyty. Prosze skontaktowac sie bezposrednio z salonem.",
        intent: "reschedule",
        intentLabel: "Zmiana terminu",
        suggestedAction: null,
        transferToHuman: config.transferToHumanEnabled,
      };
    }

    return {
      message: "Oczywiscie! Pomoge zmienic termin wizyty. Prosze podac swoje dane oraz preferowany nowy termin, a sprawdze dostepnosc.",
      intent: "reschedule",
      intentLabel: "Zmiana terminu",
      suggestedAction: "check_availability",
      transferToHuman: false,
    };
  }

  if (matchesIntent(msg, ["kiedy", "dostepn", "wolny termin", "godziny", "availability", "open", "otwar", "czy jest"])) {
    if (!config.capabilities.checkAvailability) {
      return {
        message: "Informacje o dostepnosci mozna sprawdzic na naszej stronie internetowej lub dzwoniac w godzinach pracy salonu.",
        intent: "check_availability",
        intentLabel: "Sprawdzanie dostepnosci",
        suggestedAction: null,
        transferToHuman: false,
      };
    }

    const employeesText = employeesList.length > 0
      ? employeesList.slice(0, 5).map(e => `${e.firstName} ${e.lastName}`).join(", ")
      : "nasi specjalisci";

    return {
      message: `Chetnie sprawdze dostepnosc! W ${salonName} pracuja: ${employeesText}. Na kiedy chcialby/chcialaby Pan/Pani umowic wizyte? Moge sprawdzic wolne terminy na kazdy dzien.`,
      intent: "check_availability",
      intentLabel: "Sprawdzanie dostepnosci",
      suggestedAction: "show_calendar",
      transferToHuman: false,
    };
  }

  if (matchesIntent(msg, ["cena", "ceny", "cennik", "ile kosztuje", "koszt", "price", "promocj", "rabat"])) {
    const servicesText = servicesList.length > 0
      ? servicesList.slice(0, 8).map(s => `${s.name}: ${s.price} PLN`).join("; ")
      : "Prosze zapytac o szczegoly uslug";

    return {
      message: `Oto nasz cennik: ${servicesText}. Czy ktoraś z tych uslug Pana/Pania interesuje? Moge podac wiecej szczegolow lub pomoc umowic wizyte.`,
      intent: "pricing_inquiry",
      intentLabel: "Pytanie o ceny",
      suggestedAction: "show_pricing",
      transferToHuman: false,
    };
  }

  if (matchesIntent(msg, ["czlowiek", "osoba", "recepcj", "manager", "kierownik", "pracownik", "polacz mnie", "human", "real person"])) {
    return {
      message: config.transferToHumanEnabled
        ? `Rozumiem, ze chce Pan/Pani porozmawiac z pracownikiem salonu. Lacze z recepcja...${config.transferPhoneNumber ? ` Numer do recepcji: ${config.transferPhoneNumber}` : ""}`
        : "Niestety, w tej chwili nie moge polaczyc z pracownikiem. Prosze sprobowac ponownie w godzinach pracy salonu lub zostawic wiadomosc.",
      intent: "transfer_to_human",
      intentLabel: "Przekierowanie do czlowieka",
      suggestedAction: config.transferToHumanEnabled ? "transfer_call" : null,
      transferToHuman: config.transferToHumanEnabled,
    };
  }

  // FAQ / General inquiry
  if (config.capabilities.answerFaq) {
    return {
      message: `Dziekuje za kontakt z ${salonName}! Jestem asystentem AI i chetnie pomoge. Moge pomoc w: rezerwacji wizyty, sprawdzeniu dostepnych terminow, informacji o cenach uslug, lub zmianie/odwolaniu wizyty. W czym moge pomoc?`,
      intent: "general_inquiry",
      intentLabel: "Zapytanie ogolne",
      suggestedAction: "show_options",
      transferToHuman: false,
    };
  }

  return {
    message: `Dziekuje za telefon do ${salonName}. Niestety, nie jestem w stanie pomoc z tym zapytaniem. Prosze sprobowac polaczyc sie z nami w godzinach pracy.`,
    intent: "unknown",
    intentLabel: "Nierozpoznane",
    suggestedAction: null,
    transferToHuman: config.transferToHumanEnabled,
  };
}

function matchesIntent(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => message.includes(keyword));
}
