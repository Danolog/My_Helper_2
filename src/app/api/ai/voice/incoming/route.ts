import { NextResponse } from "next/server";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import {
  salons,
  services,
  employees,
  aiConversations,
  appointments,
  workSchedules,
  timeBlocks,
} from "@/lib/schema";
import { eq, and, gte, lt, not } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
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
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      {
        error: "Funkcje AI sa dostepne tylko w Planie Pro.",
        code: "PLAN_UPGRADE_REQUIRED",
      },
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
    return NextResponse.json(
      { error: "callerMessage is required" },
      { status: 400 }
    );
  }

  try {
    // Load voice AI config
    const salonRows = await db
      .select({
        settingsJson: salons.settingsJson,
        name: salons.name,
        phone: salons.phone,
      })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const salon = salonRows[0];
    if (!salon) {
      return NextResponse.json(
        { error: "Salon nie znaleziony" },
        { status: 404 }
      );
    }

    const settings = (salon.settingsJson || {}) as Record<string, unknown>;
    const config = settings.voiceAi as VoiceAiConfig | undefined;

    if (!config?.enabled) {
      return NextResponse.json(
        {
          error:
            "Asystent glosowy AI jest wylaczony. Wlacz go w ustawieniach.",
        },
        { status: 400 }
      );
    }

    // Get salon context: services and employees
    const [salonServices, salonEmployees] = await Promise.all([
      db
        .select({
          id: services.id,
          name: services.name,
          price: services.basePrice,
          duration: services.baseDuration,
        })
        .from(services)
        .where(
          and(
            eq(services.salonId, salonId),
            eq(services.isActive, true)
          )
        ),
      db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
        })
        .from(employees)
        .where(
          and(
            eq(employees.salonId, salonId),
            eq(employees.isActive, true)
          )
        ),
    ]);

    // Build AI response based on caller message and salon context
    const aiResponse = await generateVoiceResponse(
      body.callerMessage,
      config,
      salon.name || "Nasz salon",
      salonServices,
      salonEmployees
    );

    // Log the conversation in database
    const conversationRows = await db
      .insert(aiConversations)
      .values({
        salonId: salonId,
        channel: "voice",
        transcript: JSON.stringify({
          callerPhone: body.callerPhone || "symulacja",
          callerMessage: body.callerMessage,
          aiResponse: aiResponse.message,
          intent: aiResponse.intent,
          availabilityData: aiResponse.availabilityData ?? null,
          timestamp: new Date().toISOString(),
        }),
      })
      .returning();

    const conversation = conversationRows[0];

    return NextResponse.json({
      conversationId: conversation?.id ?? null,
      greeting: config.greeting,
      response: aiResponse.message,
      intent: aiResponse.intent,
      intentLabel: aiResponse.intentLabel,
      suggestedAction: aiResponse.suggestedAction,
      voiceStyle: config.voiceStyle,
      language: config.language,
      transferToHuman: aiResponse.transferToHuman,
      availabilityData: aiResponse.availabilityData ?? null,
      escalationReason: aiResponse.escalationReason ?? null,
      messageTaken: aiResponse.messageTaken ?? false,
    });
  } catch (error) {
    logger.error("[Voice AI Incoming] Error", { error: error });
    return NextResponse.json(
      { error: "Blad przetwarzania polaczenia" },
      { status: 500 }
    );
  }
}

type ServiceInfo = {
  id: string;
  name: string;
  price: string;
  duration: number;
};
type EmployeeInfo = { id: string; firstName: string; lastName: string };

type AvailabilitySlot = {
  time: string;
  available: boolean;
};

type AvailabilityData = {
  date: string;
  dateFormatted: string;
  employeeId: string;
  employeeName: string;
  serviceName: string | null;
  duration: number;
  dayOff: boolean;
  workStart: string | null;
  workEnd: string | null;
  availableSlots: AvailabilitySlot[];
  requestedTime: string | null;
  requestedTimeAvailable: boolean | null;
  alternativeTimes: string[];
};

type VoiceResponse = {
  message: string;
  intent: string;
  intentLabel: string;
  suggestedAction: string | null;
  transferToHuman: boolean;
  availabilityData?: AvailabilityData | undefined;
  escalationReason?: string; // Why AI decided to escalate to a human
  messageTaken?: boolean; // True when human transfer is unavailable and a message form should be shown
};

/**
 * Parse a date from the caller's message.
 * Supports Polish day names, "jutro", "dzisiaj", "pojutrze", and specific dates.
 */
function parseDateFromMessage(msg: string): {
  date: Date;
  dateLabel: string;
} | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Polish day name mappings (0=Sunday ... 6=Saturday)
  const dayNames: Record<string, number> = {
    niedziela: 0,
    niedziele: 0,
    poniedzialek: 1,
    poniedzial: 1,
    wtorek: 2,
    wtor: 2,
    sroda: 3,
    srod: 3,
    czwartek: 4,
    czwart: 4,
    piatek: 5,
    piat: 5,
    sobota: 6,
    sobot: 6,
    // English support
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  };

  const lowerMsg = msg.toLowerCase();

  // Check for "dzisiaj" / "today"
  if (lowerMsg.includes("dzisiaj") || lowerMsg.includes("today") || lowerMsg.includes("dzis")) {
    return { date: today, dateLabel: "dzisiaj" };
  }

  // Check for "jutro" / "tomorrow"
  if (lowerMsg.includes("jutro") || lowerMsg.includes("tomorrow")) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { date: tomorrow, dateLabel: "jutro" };
  }

  // Check for "pojutrze" / "day after tomorrow"
  if (lowerMsg.includes("pojutrze")) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return { date: dayAfter, dateLabel: "pojutrze" };
  }

  // Check for Polish day names - find the next occurrence of that weekday
  for (const [name, dayOfWeek] of Object.entries(dayNames)) {
    if (lowerMsg.includes(name)) {
      const result = new Date(today);
      const currentDay = result.getDay();
      let daysToAdd = dayOfWeek - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Get next occurrence
      result.setDate(result.getDate() + daysToAdd);

      const polishDayFull: Record<number, string> = {
        0: "niedziela",
        1: "poniedzialek",
        2: "wtorek",
        3: "sroda",
        4: "czwartek",
        5: "piatek",
        6: "sobota",
      };
      return {
        date: result,
        dateLabel: polishDayFull[dayOfWeek] || name,
      };
    }
  }

  // Try to match a date pattern like "20 lutego", "20.02", "2026-02-20"
  const datePatterns = [
    // YYYY-MM-DD
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
    // DD.MM.YYYY or DD.MM
    /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/,
    // DD/MM/YYYY or DD/MM
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/,
  ];

  for (const pattern of datePatterns) {
    const match = lowerMsg.match(pattern);
    if (match) {
      let year: number, month: number, day: number;
      if (pattern.source.startsWith("(\\d{4})")) {
        // YYYY-MM-DD format
        year = parseInt(match[1]!);
        month = parseInt(match[2]!) - 1;
        day = parseInt(match[3]!);
      } else {
        // DD.MM or DD/MM format
        day = parseInt(match[1]!);
        month = parseInt(match[2]!) - 1;
        year = match[3] ? parseInt(match[3]) : today.getFullYear();
      }
      const dateResult = new Date(year, month, day);
      if (!isNaN(dateResult.getTime())) {
        return {
          date: dateResult,
          dateLabel: `${day.toString().padStart(2, "0")}.${(month + 1).toString().padStart(2, "0")}.${year}`,
        };
      }
    }
  }

  // Check for Polish month names
  const monthNames: Record<string, number> = {
    stycznia: 0,
    stycz: 0,
    lutego: 1,
    lut: 1,
    marca: 2,
    mar: 2,
    kwietnia: 3,
    kwiet: 3,
    maja: 4,
    maj: 4,
    czerwca: 5,
    czerw: 5,
    lipca: 6,
    lip: 6,
    sierpnia: 7,
    sierp: 7,
    wrzesnia: 8,
    wrzesn: 8,
    pazdziernika: 9,
    pazdz: 9,
    listopada: 10,
    listop: 10,
    grudnia: 11,
    grudz: 11,
  };

  for (const [monthName, monthIndex] of Object.entries(monthNames)) {
    if (lowerMsg.includes(monthName)) {
      // Try to find a day number near the month name
      const dayMatch = lowerMsg.match(
        new RegExp(`(\\d{1,2})\\s*${monthName}|${monthName}\\s*(\\d{1,2})`)
      );
      if (dayMatch) {
        const day = parseInt(dayMatch[1] || dayMatch[2]!);
        const dateResult = new Date(today.getFullYear(), monthIndex, day);
        if (dateResult < today) {
          dateResult.setFullYear(dateResult.getFullYear() + 1);
        }
        return {
          date: dateResult,
          dateLabel: `${day} ${monthName}`,
        };
      }
    }
  }

  return null;
}

/**
 * Parse time from caller's message.
 * Supports formats like "o 15", "o 15:30", "na 10:00", "14:00", "o piatnastej"
 */
function parseTimeFromMessage(msg: string): string | null {
  const lowerMsg = msg.toLowerCase();

  // Match "o XX:XX", "na XX:XX", "XX:XX"
  const timeMatch = lowerMsg.match(
    /(?:o|na|godzin[aey]?)?\s*(\d{1,2}):(\d{2})/
  );
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]!);
    const mins = parseInt(timeMatch[2]!);
    if (hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59) {
      return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
    }
  }

  // Match "o 15", "na 10", "o godzinie 14"
  const hourOnlyMatch = lowerMsg.match(
    /(?:o|na|godzin[aey]?)\s+(\d{1,2})(?:\s|$|,|\.)/
  );
  if (hourOnlyMatch) {
    const hours = parseInt(hourOnlyMatch[1]!);
    if (hours >= 6 && hours <= 22) {
      return `${hours.toString().padStart(2, "0")}:00`;
    }
  }

  // Polish word numbers for hours
  const wordHours: Record<string, number> = {
    osmej: 8,
    osma: 8,
    dziewiatej: 9,
    dziewiata: 9,
    dziesiatej: 10,
    dziesiata: 10,
    jedenastej: 11,
    jedenasta: 11,
    dwunastej: 12,
    dwunasta: 12,
    trzynastej: 13,
    trzynasta: 13,
    czternastej: 14,
    czternasta: 14,
    piatnastej: 15,
    piatnasta: 15,
    szesnastej: 16,
    szesnasta: 16,
    siedemnastej: 17,
    siedemnasta: 17,
    osiemnastej: 18,
    osiemnasta: 18,
  };

  for (const [word, hour] of Object.entries(wordHours)) {
    if (lowerMsg.includes(word)) {
      return `${hour.toString().padStart(2, "0")}:00`;
    }
  }

  return null;
}

/**
 * Try to match a service name from the caller's message.
 */
function matchServiceFromMessage(
  msg: string,
  servicesList: ServiceInfo[]
): ServiceInfo | null {
  const lowerMsg = msg.toLowerCase();
  for (const service of servicesList) {
    const serviceLower = service.name.toLowerCase();
    // Check if any significant word from service name is in the message
    const words = serviceLower.split(/\s+/).filter((w) => w.length > 3);
    for (const word of words) {
      if (lowerMsg.includes(word)) {
        return service;
      }
    }
  }
  return null;
}

/**
 * Try to match an employee from the caller's message.
 */
function matchEmployeeFromMessage(
  msg: string,
  employeesList: EmployeeInfo[]
): EmployeeInfo | null {
  const lowerMsg = msg.toLowerCase();
  for (const emp of employeesList) {
    const firstName = emp.firstName.toLowerCase();
    const lastName = emp.lastName.toLowerCase();
    if (lowerMsg.includes(firstName) || lowerMsg.includes(lastName)) {
      return emp;
    }
  }
  return null;
}

/**
 * Query real availability for a given employee on a given date.
 */
async function queryAvailability(
  employeeId: string,
  date: string,
  duration: number
): Promise<{
  dayOff: boolean;
  workStart: string | null;
  workEnd: string | null;
  availableSlots: AvailabilitySlot[];
}> {
  const requestedDate = new Date(date + "T00:00:00");
  const dayOfWeek = requestedDate.getDay();

  // 1. Get employee work schedule for this day
  const schedules = await db
    .select()
    .from(workSchedules)
    .where(
      and(
        eq(workSchedules.employeeId, employeeId),
        eq(workSchedules.dayOfWeek, dayOfWeek)
      )
    );

  if (schedules.length === 0) {
    return {
      dayOff: true,
      workStart: null,
      workEnd: null,
      availableSlots: [],
    };
  }

  const schedule = schedules[0]!;
  const workStart = schedule.startTime;
  const workEnd = schedule.endTime;

  // 2. Get existing appointments
  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59");

  const existingAppointments = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.employeeId, employeeId),
        not(eq(appointments.status, "cancelled")),
        gte(appointments.startTime, dayStart),
        lt(appointments.startTime, dayEnd)
      )
    );

  // 3. Get time blocks (vacations, breaks)
  const existingBlocks = await db
    .select()
    .from(timeBlocks)
    .where(
      and(
        eq(timeBlocks.employeeId, employeeId),
        lt(timeBlocks.startTime, dayEnd),
        gte(timeBlocks.endTime, dayStart)
      )
    );

  // 4. Build blocked ranges
  interface TimeRange {
    start: number;
    end: number;
  }

  const blockedRanges: TimeRange[] = [];

  for (const appt of existingAppointments) {
    const apptStart = new Date(appt.startTime);
    const apptEnd = new Date(appt.endTime);
    blockedRanges.push({
      start: apptStart.getHours() * 60 + apptStart.getMinutes(),
      end: apptEnd.getHours() * 60 + apptEnd.getMinutes(),
    });
  }

  for (const block of existingBlocks) {
    const blockStart = new Date(block.startTime);
    const blockEnd = new Date(block.endTime);
    const startMinutes =
      blockStart.toDateString() === requestedDate.toDateString()
        ? blockStart.getHours() * 60 + blockStart.getMinutes()
        : 0;
    const endMinutes =
      blockEnd.toDateString() === requestedDate.toDateString()
        ? blockEnd.getHours() * 60 + blockEnd.getMinutes()
        : 24 * 60;
    blockedRanges.push({ start: startMinutes, end: endMinutes });
  }

  // 5. Generate available slots
  const SLOT_INTERVAL = 15;
  const workStartParts = workStart.split(":").map(Number);
  const workEndParts = workEnd.split(":").map(Number);
  const workStartMinutes = (workStartParts[0] ?? 0) * 60 + (workStartParts[1] ?? 0);
  const workEndMinutes = (workEndParts[0] ?? 0) * 60 + (workEndParts[1] ?? 0);

  const slots: AvailabilitySlot[] = [];

  for (
    let slotStart = workStartMinutes;
    slotStart + duration <= workEndMinutes;
    slotStart += SLOT_INTERVAL
  ) {
    const slotEnd = slotStart + duration;
    const isBlocked = blockedRanges.some(
      (range) => slotStart < range.end && slotEnd > range.start
    );

    const hours = Math.floor(slotStart / 60);
    const mins = slotStart % 60;
    const timeStr = `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;

    slots.push({ time: timeStr, available: !isBlocked });
  }

  return {
    dayOff: false,
    workStart,
    workEnd,
    availableSlots: slots,
  };
}

async function generateVoiceResponse(
  callerMessage: string,
  config: VoiceAiConfig,
  salonName: string,
  servicesList: ServiceInfo[],
  employeesList: EmployeeInfo[]
): Promise<VoiceResponse> {
  const msg = callerMessage.toLowerCase();

  // --- Escalation detection: complex requests the AI cannot handle ---

  // Complaints and issues
  const isComplaint = matchesIntent(msg, [
    "reklamacj",
    "skarg",
    "problem",
    "zly",
    "zle",
    "niezadowolon",
    "zwrot",
    "odszkodowan",
    "complaint",
  ]);

  // Medical or health concerns
  const isMedical = matchesIntent(msg, [
    "alergi",
    "uczulen",
    "podrazn",
    "bol",
    "zranien",
    "krew",
    "medical",
  ]);

  // Financial disputes
  const isFinancial = matchesIntent(msg, [
    "faktur",
    "rachun",
    "rozliczen",
    "blad platnosci",
    "nadplat",
    "refund",
  ]);

  // Legal or complex data privacy requests
  const isLegal = matchesIntent(msg, [
    "prawnik",
    "umow",
    "regulamin",
    "rodo",
    "ochrona danych",
    "dane osobowe",
  ]);

  // Multi-intent complex: detect when the message contains multiple distinct intents
  // Note: "termin" alone could be booking or rescheduling, so we exclude it from booking
  // when "zmienic" is also present to avoid false multi-intent detection.
  const hasRescheduleTermin = matchesIntent(msg, ["zmienic termin", "przeniesc", "przesun", "przeloz", "reschedule", "inny termin"]);
  const intentSignals = [
    !hasRescheduleTermin && matchesIntent(msg, ["umowic", "wizyta", "rezerwac", "termin", "zarezerwow"]),
    matchesIntent(msg, ["odwolac", "anulowac", "rezygnuj"]),
    matchesIntent(msg, ["cena", "ceny", "cennik", "ile kosztuje", "koszt"]),
    matchesIntent(msg, ["reklamacj", "skarg", "problem"]),
    matchesIntent(msg, ["faktur", "rachun"]),
    hasRescheduleTermin,
  ];
  const detectedIntentCount = intentSignals.filter(Boolean).length;
  const isMultiIntent = detectedIntentCount >= 2;

  if (isComplaint || isMedical || isFinancial || isLegal || isMultiIntent) {
    let escalationReason: string;
    let responseMessage: string;

    if (isMedical) {
      escalationReason = "Zgloszenie dotyczace zdrowia lub reakcji alergicznej";
      responseMessage =
        "Bardzo przepraszam i rozumiem Pana/Pani niepokoj. Kwestie zdrowotne sa dla nas priorytetem. Ta sprawa wymaga bezposredniej rozmowy z naszym specjalista.";
    } else if (isComplaint) {
      escalationReason = "Reklamacja lub skarga klienta";
      responseMessage =
        "Przepraszam za niedogodnosci. Chce sie upewnic, ze Pana/Pani sprawa zostanie odpowiednio rozpatrzona. Przekazuje do osoby, ktora bedzie mogla pomoc.";
    } else if (isFinancial) {
      escalationReason = "Sprawa finansowa wymagajaca weryfikacji";
      responseMessage =
        "Rozumiem, ze chodzi o kwestie finansowa. Tego typu sprawy wymagaja dostepu do systemu rozliczen. Lacze z osoba, ktora bedzie mogla to sprawdzic.";
    } else if (isLegal) {
      escalationReason = "Kwestia prawna lub ochrony danych osobowych";
      responseMessage =
        "Rozumiem. Kwestie prawne i dotyczace ochrony danych wymagaja kontaktu z upowaznionym pracownikiem.";
    } else {
      escalationReason = "Zlozony wniosek obejmujacy wiele spraw jednoczesnie";
      responseMessage =
        "Widze, ze Pana/Pani zapytanie dotyczy kilku spraw naraz. Aby sprawnie wszystko zalatwic, najlepiej bedzie polaczyc Pana/Pania z naszym pracownikiem.";
    }

    if (config.transferToHumanEnabled) {
      responseMessage += config.transferPhoneNumber
        ? ` Przekierowuje do recepcji... Numer: ${config.transferPhoneNumber}.`
        : " Przekierowuje do recepcji...";

      return {
        message: responseMessage,
        intent: "escalate_to_human",
        intentLabel: "Eskalacja do czlowieka",
        suggestedAction: "transfer_call",
        transferToHuman: true,
        escalationReason,
      };
    } else {
      responseMessage +=
        " Niestety, w tej chwili nie moge polaczyc z pracownikiem. Prosze zostawic wiadomosc, a skontaktujemy sie z Panem/Pania najszybciej jak to mozliwe.";

      return {
        message: responseMessage,
        intent: "escalate_to_human",
        intentLabel: "Eskalacja do czlowieka",
        suggestedAction: "take_message",
        transferToHuman: false,
        escalationReason,
        messageTaken: true,
      };
    }
  }

  // Detect intent - reschedule (MUST come before booking to avoid false matches on "termin"/"wizyta")
  if (
    matchesIntent(msg, [
      "przeniesc",
      "zmienic termin",
      "przesun",
      "reschedule",
      "inny termin",
      "przeloz",
    ])
  ) {
    if (!config.capabilities.rescheduleAppointments) {
      return {
        message:
          "Rozumiem, ze chce Pan/Pani zmienic termin wizyty. Prosze skontaktowac sie bezposrednio z salonem.",
        intent: "reschedule",
        intentLabel: "Zmiana terminu",
        suggestedAction: null,
        transferToHuman: config.transferToHumanEnabled,
      };
    }

    // Try to detect new preferred date/time from the message
    const parsedDate = parseDateFromMessage(msg);
    const parsedTime = parseTimeFromMessage(msg);
    const matchedEmployee = matchEmployeeFromMessage(msg, employeesList);

    // If we have a date, offer availability for the new time
    if (parsedDate && matchedEmployee) {
      const dateStr = parsedDate.date.toISOString().split("T")[0]!;
      const duration = 60; // Default duration, will be overridden in actual reschedule

      const availability = await queryAvailability(
        matchedEmployee.id,
        dateStr,
        duration
      );

      const empName = `${matchedEmployee.firstName} ${matchedEmployee.lastName}`;
      const availableOnly = availability.availableSlots.filter(
        (s) => s.available
      );

      if (availability.dayOff) {
        return {
          message: `Chce Pan/Pani zmienic termin wizyty. Niestety, ${empName} nie pracuje w dniu ${parsedDate.dateLabel}. Prosze podac inny dzien.`,
          intent: "reschedule",
          intentLabel: "Zmiana terminu",
          suggestedAction: "check_availability",
          transferToHuman: false,
          availabilityData: {
            date: dateStr,
            dateFormatted: parsedDate.dateLabel,
            employeeId: matchedEmployee.id,
            employeeName: empName,
            serviceName: null,
            duration,
            dayOff: true,
            workStart: null,
            workEnd: null,
            availableSlots: [],
            requestedTime: parsedTime,
            requestedTimeAvailable: null,
            alternativeTimes: [],
          },
        };
      }

      if (parsedTime) {
        const requestedSlot = availability.availableSlots.find(
          (s) => s.time === parsedTime
        );

        if (requestedSlot && requestedSlot.available) {
          return {
            message: `Swietnie! Termin ${parsedDate.dateLabel} o ${parsedTime} u ${empName} jest dostepny. Czy potwierdzam zmiane terminu wizyty na ten termin?`,
            intent: "reschedule",
            intentLabel: "Zmiana terminu",
            suggestedAction: "confirm_reschedule",
            transferToHuman: false,
            availabilityData: {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: matchedEmployee.id,
              employeeName: empName,
              serviceName: null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: true,
              alternativeTimes: [],
            },
          };
        } else {
          const alternatives = availableOnly
            .filter((s) => {
              const reqMinutes =
                parseInt(parsedTime.split(":")[0]!) * 60 +
                parseInt(parsedTime.split(":")[1]!);
              const slotMinutes =
                parseInt(s.time.split(":")[0]!) * 60 +
                parseInt(s.time.split(":")[1]!);
              return Math.abs(slotMinutes - reqMinutes) <= 120;
            })
            .slice(0, 5)
            .map((s) => s.time);

          const altText =
            alternatives.length > 0
              ? `Moge zaproponowac: ${alternatives.join(", ")}.`
              : availableOnly.length > 0
                ? `Dostepne godziny: ${availableOnly.slice(0, 6).map((s) => s.time).join(", ")}.`
                : "Niestety, tego dnia nie ma juz wolnych terminow.";

          return {
            message: `Chce Pan/Pani przeniesc wizyte na ${parsedDate.dateLabel} o ${parsedTime}. Niestety, ten termin u ${empName} jest zajety. ${altText}`,
            intent: "reschedule",
            intentLabel: "Zmiana terminu",
            suggestedAction: "suggest_alternatives",
            transferToHuman: false,
            availabilityData: {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: matchedEmployee.id,
              employeeName: empName,
              serviceName: null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: false,
              alternativeTimes: alternatives,
            },
          };
        }
      } else {
        // Have date and employee but no time
        const slotsText =
          availableOnly.length > 0
            ? availableOnly
                .slice(0, 8)
                .map((s) => s.time)
                .join(", ")
            : "brak wolnych terminow";

        return {
          message: `Rozumiem, chce Pan/Pani zmienic termin wizyty na ${parsedDate.dateLabel} u ${empName}. Dostepne godziny: ${slotsText}. O ktorej godzinie Pan/Pani preferuje?`,
          intent: "reschedule",
          intentLabel: "Zmiana terminu",
          suggestedAction: "show_available_slots",
          transferToHuman: false,
          availabilityData: {
            date: dateStr,
            dateFormatted: parsedDate.dateLabel,
            employeeId: matchedEmployee.id,
            employeeName: empName,
            serviceName: null,
            duration,
            dayOff: false,
            workStart: availability.workStart,
            workEnd: availability.workEnd,
            availableSlots: availability.availableSlots,
            requestedTime: null,
            requestedTimeAvailable: null,
            alternativeTimes: [],
          },
        };
      }
    }

    if (parsedDate && employeesList.length > 0) {
      const dateStr = parsedDate.date.toISOString().split("T")[0]!;
      const defaultEmp = employeesList[0]!;
      const availability = await queryAvailability(defaultEmp.id, dateStr, 60);
      const empName = `${defaultEmp.firstName} ${defaultEmp.lastName}`;
      const availableOnly = availability.availableSlots.filter(
        (s) => s.available
      );

      const employeesText = employeesList
        .slice(0, 5)
        .map((e) => `${e.firstName} ${e.lastName}`)
        .join(", ");

      let slotsInfo = "";
      if (!availability.dayOff && availableOnly.length > 0) {
        slotsInfo = ` U ${empName} dostepne: ${availableOnly.slice(0, 5).map((s) => s.time).join(", ")}.`;
      }

      return {
        message: `Rozumiem, chce Pan/Pani przeniesc wizyte na ${parsedDate.dateLabel}. Nasi pracownicy: ${employeesText}.${slotsInfo} Prosze podac preferowanego pracownika i godzine.`,
        intent: "reschedule",
        intentLabel: "Zmiana terminu",
        suggestedAction: "show_available_slots",
        transferToHuman: false,
        availabilityData: availability.dayOff
          ? undefined
          : {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: defaultEmp.id,
              employeeName: empName,
              serviceName: null,
              duration: 60,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: null,
              alternativeTimes: [],
            },
      };
    }

    return {
      message:
        "Oczywiscie! Pomoge zmienic termin wizyty. Prosze podac swoje dane oraz preferowany nowy termin (dzien i godzine), a sprawdze dostepnosc.",
      intent: "reschedule",
      intentLabel: "Zmiana terminu",
      suggestedAction: "check_availability",
      transferToHuman: false,
    };
  }

  // Detect intent - booking / appointment
  if (
    matchesIntent(msg, [
      "umowic",
      "wizyta",
      "rezerwac",
      "termin",
      "zarezerwow",
      "booking",
      "book",
      "appointment",
      "zapisac",
      "haircut",
      "strzyz",
      "fryzj",
      "koloryz",
      "manicure",
      "pedicure",
      "masaz",
      "zabieg",
    ])
  ) {
    if (!config.capabilities.bookAppointments) {
      return {
        message: `Rozumiem, ze chcialby/chcialaby Pan/Pani umowic wizyte. Niestety, rezerwacja przez telefon nie jest teraz dostepna. Prosze odwiedzic nasza strone internetowa lub zadzwonic ponownie w godzinach pracy.`,
        intent: "book_appointment",
        intentLabel: "Rezerwacja wizyty",
        suggestedAction: "redirect_website",
        transferToHuman: false,
      };
    }

    // Try to detect date/time/service/employee in the booking request
    const parsedDate = parseDateFromMessage(msg);
    const parsedTime = parseTimeFromMessage(msg);
    const matchedService = matchServiceFromMessage(msg, servicesList);
    const matchedEmployee = matchEmployeeFromMessage(msg, employeesList);

    // If we have enough info (date + at least one employee), check availability
    if (parsedDate && matchedEmployee) {
      const dateStr = parsedDate.date.toISOString().split("T")[0]!;
      const duration = matchedService ? matchedService.duration : 60;

      const availability = await queryAvailability(
        matchedEmployee.id,
        dateStr,
        duration
      );

      const empName = `${matchedEmployee.firstName} ${matchedEmployee.lastName}`;
      const availableOnly = availability.availableSlots.filter(
        (s) => s.available
      );

      if (availability.dayOff) {
        // Employee doesn't work that day - suggest alternatives
        return {
          message: `Niestety, ${empName} nie pracuje w dniu ${parsedDate.dateLabel}. Prosze sprobowac inny dzien lub innego pracownika.`,
          intent: "book_appointment",
          intentLabel: "Rezerwacja wizyty",
          suggestedAction: "check_availability",
          transferToHuman: false,
          availabilityData: {
            date: dateStr,
            dateFormatted: parsedDate.dateLabel,
            employeeId: matchedEmployee.id,
            employeeName: empName,
            serviceName: matchedService?.name || null,
            duration,
            dayOff: true,
            workStart: null,
            workEnd: null,
            availableSlots: [],
            requestedTime: parsedTime,
            requestedTimeAvailable: null,
            alternativeTimes: [],
          },
        };
      }

      if (parsedTime) {
        // Check if the specific requested time is available
        const requestedSlot = availability.availableSlots.find(
          (s) => s.time === parsedTime
        );

        if (requestedSlot && requestedSlot.available) {
          // Requested time is available!
          return {
            message: `Swietnie! Termin ${parsedDate.dateLabel} o godzinie ${parsedTime} u ${empName}${matchedService ? ` na ${matchedService.name}` : ""} jest dostepny! Czy potwierdzam rezerwacje?`,
            intent: "check_availability",
            intentLabel: "Sprawdzanie dostepnosci",
            suggestedAction: "confirm_booking",
            transferToHuman: false,
            availabilityData: {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: matchedEmployee.id,
              employeeName: empName,
              serviceName: matchedService?.name || null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: true,
              alternativeTimes: [],
            },
          };
        } else {
          // Requested time is NOT available - suggest alternatives
          const alternatives = availableOnly
            .filter((s) => {
              // Find slots close to the requested time
              const reqMinutes =
                parseInt(parsedTime.split(":")[0]!) * 60 +
                parseInt(parsedTime.split(":")[1]!);
              const slotMinutes =
                parseInt(s.time.split(":")[0]!) * 60 +
                parseInt(s.time.split(":")[1]!);
              return Math.abs(slotMinutes - reqMinutes) <= 120; // Within 2 hours
            })
            .slice(0, 5)
            .map((s) => s.time);

          const altText =
            alternatives.length > 0
              ? `Moge zaproponowac nastepujace terminy: ${alternatives.join(", ")}.`
              : availableOnly.length > 0
                ? `Dostepne godziny tego dnia to: ${availableOnly.slice(0, 6).map((s) => s.time).join(", ")}.`
                : "Niestety, tego dnia nie ma juz wolnych terminow.";

          return {
            message: `Niestety, termin ${parsedDate.dateLabel} o godzinie ${parsedTime} u ${empName} nie jest dostepny. ${altText} Ktory termin Panu/Pani odpowiada?`,
            intent: "check_availability",
            intentLabel: "Sprawdzanie dostepnosci",
            suggestedAction: "suggest_alternatives",
            transferToHuman: false,
            availabilityData: {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: matchedEmployee.id,
              employeeName: empName,
              serviceName: matchedService?.name || null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: false,
              alternativeTimes: alternatives,
            },
          };
        }
      } else {
        // Have date and employee but no specific time - show available slots
        const slotsText =
          availableOnly.length > 0
            ? `Dostepne terminy ${parsedDate.dateLabel} u ${empName}: ${availableOnly.slice(0, 8).map((s) => s.time).join(", ")}${availableOnly.length > 8 ? ` i ${availableOnly.length - 8} wiecej` : ""}.`
            : `Niestety, ${empName} nie ma juz wolnych terminow w dniu ${parsedDate.dateLabel}.`;

        return {
          message: `${slotsText} O ktorej godzinie chcialby/chcialaby Pan/Pani umowic wizyte?`,
          intent: "book_appointment",
          intentLabel: "Rezerwacja wizyty",
          suggestedAction: "show_available_slots",
          transferToHuman: false,
          availabilityData: {
            date: dateStr,
            dateFormatted: parsedDate.dateLabel,
            employeeId: matchedEmployee.id,
            employeeName: empName,
            serviceName: matchedService?.name || null,
            duration,
            dayOff: false,
            workStart: availability.workStart,
            workEnd: availability.workEnd,
            availableSlots: availability.availableSlots,
            requestedTime: null,
            requestedTimeAvailable: null,
            alternativeTimes: [],
          },
        };
      }
    }

    // If we have date but no employee, check availability for ALL employees
    if (parsedDate && employeesList.length > 0) {
      const dateStr = parsedDate.date.toISOString().split("T")[0]!;
      const duration = matchedService ? matchedService.duration : 60;

      // Check availability for first employee as default
      const defaultEmployee = employeesList[0]!;
      const availability = await queryAvailability(
        defaultEmployee.id,
        dateStr,
        duration
      );

      const availableOnly = availability.availableSlots.filter(
        (s) => s.available
      );
      const empName = `${defaultEmployee.firstName} ${defaultEmployee.lastName}`;

      const servicesText =
        servicesList.length > 0
          ? servicesList
              .slice(0, 5)
              .map((s) => `${s.name} (${s.price} PLN, ${s.duration} min)`)
              .join(", ")
          : "Prosze zapytac o szczegoly";

      const employeesText = employeesList
        .slice(0, 5)
        .map((e) => `${e.firstName} ${e.lastName}`)
        .join(", ");

      let slotsInfo = "";
      if (!availability.dayOff && availableOnly.length > 0) {
        slotsInfo = ` U ${empName} dostepne godziny: ${availableOnly.slice(0, 6).map((s) => s.time).join(", ")}.`;
      }

      return {
        message: `Oczywiscie! Na ${parsedDate.dateLabel} chetnie pomoge umowic wizyte w ${salonName}. Nasi pracownicy: ${employeesText}. Oferujemy: ${servicesText}.${slotsInfo} Prosze podac preferowanego pracownika${parsedTime ? "" : " i godzine"}.`,
        intent: "book_appointment",
        intentLabel: "Rezerwacja wizyty",
        suggestedAction: "show_services",
        transferToHuman: false,
        availabilityData: availability.dayOff
          ? undefined
          : {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: defaultEmployee.id,
              employeeName: empName,
              serviceName: matchedService?.name || null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: null,
              alternativeTimes: [],
            },
      };
    }

    // Generic booking response - no date/time detected
    const servicesText =
      servicesList.length > 0
        ? servicesList
            .slice(0, 5)
            .map((s) => `${s.name} (${s.price} PLN, ${s.duration} min)`)
            .join(", ")
        : "Prosze zapytac o szczegoly";

    return {
      message: `Oczywiscie! Chetnie pomoge umowic wizyte w ${salonName}. Oferujemy nastepujace uslugi: ${servicesText}. Ktora usluge Pan/Pani wybiera? Prosze tez podac preferowany dzien i godzine, a sprawdze dostepne terminy.`,
      intent: "book_appointment",
      intentLabel: "Rezerwacja wizyty",
      suggestedAction: "show_services",
      transferToHuman: false,
    };
  }

  if (
    matchesIntent(msg, [
      "odwolac",
      "anulowac",
      "cancel",
      "odwolanie",
      "rezygnuj",
    ])
  ) {
    if (!config.capabilities.cancelAppointments) {
      return {
        message:
          "Rozumiem, ze chce Pan/Pani odwolac wizyte. Prosze skontaktowac sie bezposrednio z salonem w godzinach pracy.",
        intent: "cancel_appointment",
        intentLabel: "Odwolanie wizyty",
        suggestedAction: null,
        transferToHuman: config.transferToHumanEnabled,
      };
    }

    // Try to identify context from the cancellation message
    const cancelEmployee = matchEmployeeFromMessage(msg, employeesList);
    const cancelDate = parseDateFromMessage(msg);

    let contextInfo = "";
    if (cancelEmployee && cancelDate) {
      contextInfo = ` Czy chodzi o wizyte u ${cancelEmployee.firstName} ${cancelEmployee.lastName} w dniu ${cancelDate.dateLabel}?`;
    } else if (cancelEmployee) {
      contextInfo = ` Czy chodzi o wizyte u ${cancelEmployee.firstName} ${cancelEmployee.lastName}?`;
    } else if (cancelDate) {
      contextInfo = ` Czy chodzi o wizyte w dniu ${cancelDate.dateLabel}?`;
    }

    return {
      message:
        `Rozumiem, ze chce Pan/Pani odwolac wizyte.${contextInfo} Prosze podac numer telefonu, a znajde najblizszа wizyte w systemie i przeprowadze proces anulacji. Informuje, ze w przypadku anulacji mniej niz 24 godziny przed wizyta, wplacony zadatek nie podlega zwrotowi.`,
      intent: "cancel_appointment",
      intentLabel: "Odwolanie wizyty",
      suggestedAction: "lookup_appointment",
      transferToHuman: false,
    };
  }

  // Check availability intent - now with real calendar checking
  if (
    matchesIntent(msg, [
      "kiedy",
      "dostepn",
      "wolny termin",
      "godziny",
      "availability",
      "open",
      "otwar",
      "czy jest",
    ])
  ) {
    if (!config.capabilities.checkAvailability) {
      return {
        message:
          "Informacje o dostepnosci mozna sprawdzic na naszej stronie internetowej lub dzwoniac w godzinach pracy salonu.",
        intent: "check_availability",
        intentLabel: "Sprawdzanie dostepnosci",
        suggestedAction: null,
        transferToHuman: false,
      };
    }

    // Try to detect date, time, and employee from the message
    const parsedDate = parseDateFromMessage(msg);
    const parsedTime = parseTimeFromMessage(msg);
    const matchedEmployee = matchEmployeeFromMessage(msg, employeesList);
    const matchedService = matchServiceFromMessage(msg, servicesList);

    if (parsedDate && matchedEmployee) {
      // We have a specific date and employee - query real availability
      const dateStr = parsedDate.date.toISOString().split("T")[0]!;
      const duration = matchedService ? matchedService.duration : 60;

      const availability = await queryAvailability(
        matchedEmployee.id,
        dateStr,
        duration
      );

      const empName = `${matchedEmployee.firstName} ${matchedEmployee.lastName}`;
      const availableOnly = availability.availableSlots.filter(
        (s) => s.available
      );

      if (availability.dayOff) {
        return {
          message: `${empName} nie pracuje w dniu ${parsedDate.dateLabel}. Prosze wybrac inny dzien lub innego pracownika.`,
          intent: "check_availability",
          intentLabel: "Sprawdzanie dostepnosci",
          suggestedAction: "suggest_other_day",
          transferToHuman: false,
          availabilityData: {
            date: dateStr,
            dateFormatted: parsedDate.dateLabel,
            employeeId: matchedEmployee.id,
            employeeName: empName,
            serviceName: matchedService?.name || null,
            duration,
            dayOff: true,
            workStart: null,
            workEnd: null,
            availableSlots: [],
            requestedTime: parsedTime,
            requestedTimeAvailable: null,
            alternativeTimes: [],
          },
        };
      }

      if (parsedTime) {
        // Check specific time
        const requestedSlot = availability.availableSlots.find(
          (s) => s.time === parsedTime
        );

        if (requestedSlot && requestedSlot.available) {
          return {
            message: `Tak! Termin ${parsedDate.dateLabel} o ${parsedTime} u ${empName} jest wolny${matchedService ? ` na ${matchedService.name}` : ""}. Czy chcialby/chcialaby Pan/Pani zarezerwowac ten termin?`,
            intent: "check_availability",
            intentLabel: "Sprawdzanie dostepnosci",
            suggestedAction: "confirm_booking",
            transferToHuman: false,
            availabilityData: {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: matchedEmployee.id,
              employeeName: empName,
              serviceName: matchedService?.name || null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: true,
              alternativeTimes: [],
            },
          };
        } else {
          // Not available - suggest alternatives
          const alternatives = availableOnly
            .filter((s) => {
              const reqMinutes =
                parseInt(parsedTime.split(":")[0]!) * 60 +
                parseInt(parsedTime.split(":")[1]!);
              const slotMinutes =
                parseInt(s.time.split(":")[0]!) * 60 +
                parseInt(s.time.split(":")[1]!);
              return Math.abs(slotMinutes - reqMinutes) <= 120;
            })
            .slice(0, 5)
            .map((s) => s.time);

          const altText =
            alternatives.length > 0
              ? `Najblizsze wolne terminy: ${alternatives.join(", ")}.`
              : availableOnly.length > 0
                ? `Dostepne godziny: ${availableOnly.slice(0, 6).map((s) => s.time).join(", ")}.`
                : "Tego dnia nie ma juz wolnych terminow.";

          return {
            message: `Niestety, ${parsedTime} u ${empName} w dniu ${parsedDate.dateLabel} jest juz zajete. ${altText}`,
            intent: "check_availability",
            intentLabel: "Sprawdzanie dostepnosci",
            suggestedAction: "suggest_alternatives",
            transferToHuman: false,
            availabilityData: {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: matchedEmployee.id,
              employeeName: empName,
              serviceName: matchedService?.name || null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: false,
              alternativeTimes: alternatives,
            },
          };
        }
      }

      // Date + employee but no time - list available slots
      const slotsText =
        availableOnly.length > 0
          ? availableOnly
              .slice(0, 8)
              .map((s) => s.time)
              .join(", ") +
            (availableOnly.length > 8
              ? ` (i ${availableOnly.length - 8} wiecej)`
              : "")
          : "brak wolnych terminow";

      return {
        message: `Sprawdzam kalendarz ${empName} na ${parsedDate.dateLabel}... Dostepne godziny: ${slotsText}. O ktorej godzinie chcialby/chcialaby Pan/Pani sie umowic?`,
        intent: "check_availability",
        intentLabel: "Sprawdzanie dostepnosci",
        suggestedAction: "show_available_slots",
        transferToHuman: false,
        availabilityData: {
          date: dateStr,
          dateFormatted: parsedDate.dateLabel,
          employeeId: matchedEmployee.id,
          employeeName: empName,
          serviceName: matchedService?.name || null,
          duration,
          dayOff: false,
          workStart: availability.workStart,
          workEnd: availability.workEnd,
          availableSlots: availability.availableSlots,
          requestedTime: null,
          requestedTimeAvailable: null,
          alternativeTimes: [],
        },
      };
    }

    if (parsedDate && employeesList.length > 0) {
      // Date specified but no employee - check first employee as sample
      const dateStr = parsedDate.date.toISOString().split("T")[0]!;
      const duration = matchedService ? matchedService.duration : 60;
      const defaultEmp = employeesList[0]!;

      const availability = await queryAvailability(
        defaultEmp.id,
        dateStr,
        duration
      );

      const empName = `${defaultEmp.firstName} ${defaultEmp.lastName}`;
      const availableOnly = availability.availableSlots.filter(
        (s) => s.available
      );
      const employeesText = employeesList
        .slice(0, 5)
        .map((e) => `${e.firstName} ${e.lastName}`)
        .join(", ");

      let slotsInfo = "";
      if (!availability.dayOff && availableOnly.length > 0) {
        slotsInfo = ` Na przyklad u ${empName}: ${availableOnly.slice(0, 5).map((s) => s.time).join(", ")}.`;
      } else if (availability.dayOff) {
        slotsInfo = ` ${empName} nie pracuje w tym dniu.`;
      }

      return {
        message: `Sprawdzam dostepnosc na ${parsedDate.dateLabel}. Nasi pracownicy: ${employeesText}.${slotsInfo} Ktorego pracownika Pan/Pani preferuje?`,
        intent: "check_availability",
        intentLabel: "Sprawdzanie dostepnosci",
        suggestedAction: "show_calendar",
        transferToHuman: false,
        availabilityData: availability.dayOff
          ? undefined
          : {
              date: dateStr,
              dateFormatted: parsedDate.dateLabel,
              employeeId: defaultEmp.id,
              employeeName: empName,
              serviceName: matchedService?.name || null,
              duration,
              dayOff: false,
              workStart: availability.workStart,
              workEnd: availability.workEnd,
              availableSlots: availability.availableSlots,
              requestedTime: parsedTime,
              requestedTimeAvailable: null,
              alternativeTimes: [],
            },
      };
    }

    // No date detected - generic response
    const employeesText =
      employeesList.length > 0
        ? employeesList
            .slice(0, 5)
            .map((e) => `${e.firstName} ${e.lastName}`)
            .join(", ")
        : "nasi specjalisci";

    return {
      message: `Chetnie sprawdze dostepnosc! W ${salonName} pracuja: ${employeesText}. Na kiedy chcialby/chcialaby Pan/Pani umowic wizyte? Prosze podac dzien (np. jutro, piatek, 20 lutego) i ewentualnie preferowanego pracownika, a sprawdze wolne terminy w kalendarzu.`,
      intent: "check_availability",
      intentLabel: "Sprawdzanie dostepnosci",
      suggestedAction: "show_calendar",
      transferToHuman: false,
    };
  }

  if (
    matchesIntent(msg, [
      "cena",
      "ceny",
      "cennik",
      "ile kosztuje",
      "koszt",
      "price",
      "promocj",
      "rabat",
    ])
  ) {
    const servicesText =
      servicesList.length > 0
        ? servicesList
            .slice(0, 8)
            .map((s) => `${s.name}: ${s.price} PLN`)
            .join("; ")
        : "Prosze zapytac o szczegoly uslug";

    return {
      message: `Oto nasz cennik: ${servicesText}. Czy ktoras z tych uslug Pana/Pania interesuje? Moge podac wiecej szczegolow lub pomoc umowic wizyte.`,
      intent: "pricing_inquiry",
      intentLabel: "Pytanie o ceny",
      suggestedAction: "show_pricing",
      transferToHuman: false,
    };
  }

  if (
    matchesIntent(msg, [
      "czlowiek",
      "osoba",
      "recepcj",
      "manager",
      "kierownik",
      "pracownik",
      "polacz mnie",
      "human",
      "real person",
    ])
  ) {
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
