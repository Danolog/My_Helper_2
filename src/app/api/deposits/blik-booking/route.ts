import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { parseBody, blikBookingSchema } from "@/lib/api-validation";
import {
  appointmentConflictWhere,
  isAppointmentSlotTaken,
  overlapsRange,
} from "@/lib/appointment-overlap";
import { calculateExpectedDeposit } from "@/lib/deposit-calculation";
import {
  DEPOSIT_CHECK_UNAVAILABLE_MESSAGE,
  DEPOSIT_NOT_APPLICABLE_CODE,
  depositDecision,
} from "@/lib/deposit-guard";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext } from "@/lib/salon-context";
import { assertSalonRefs } from "@/lib/salon-refs";
import { appointments, clients, employees, salons, serviceVariants, services, timeBlocks } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { getOptionalSession } from "@/lib/session";
import {
  SMS_PROVIDER_UNAVAILABLE_ERROR,
  SMS_SEND_FAILED_ERROR,
  sendBlikDepositBookingSms,
  type SmsResult,
} from "@/lib/sms";

/**
 * POST /api/deposits/blik-booking — publiczna rezerwacja z zadatkiem płatnym
 * BLIK-iem na telefon salonu (gość albo zalogowany klient portalu).
 *
 * Wizyta powstaje jako `scheduled` z `depositPaid=false` i kwotą zadatku
 * wyliczoną przez serwer (kwota z body jest tylko porównywana). Trasa NIE
 * tworzy wiersza `deposit_payments` i nie dotyka Stripe: pieniądze idą
 * przelewem BLIK na telefon salonu, a wpłatę oznacza salon ręcznie. Dzięki
 * temu ani webhook, ani cron sprzątający płatności oczekujące, ani zwroty
 * Stripe nie obejmują tej wizyty.
 *
 * Numer BLIK salonu (`settingsJson.deposits.blikPhone`) to dane osobowe
 * właściciela. Trafia wyłącznie do odpowiedzi 201 i do SMS do klienta (wraz
 * z treścią SMS do tabeli notifications salonu), czyli po utworzeniu wizyty —
 * nigdy do błędów ani do logów. Format numeru sprawdza
 * zapis ustawień, tu liczy się tylko to, że jest niepustym napisem.
 *
 * Termin: początek wcześniejszy niż 5 minut przed chwilą serwera → 400.
 * Długość wizyty (koniec − początek) musi być równa długości usługi z wariantem
 * zapisanej w bazie (`baseDuration` + `durationModifier`, odczyt razem z
 * salonem); inna długość → 400, zanim trasa sprawdzi kalendarz.
 *
 * SMS: po zapisie, przed odpowiedzią 201, klient (telefon gościa albo telefon
 * z kartoteki) dostaje SMS z numerem BLIK, kwotą i tytułem przelewu — tymi
 * samymi wartościami co w odpowiedzi, bez drugiego odczytu numeru. Wynik
 * wysyłki nie zmienia odpowiedzi; nieudana wysyłka i pominięcie trafiają do
 * logu z id wizyty i powodem z zamkniętej listy (bez numerów i treści). Przy
 * 4xx/5xx SMS nie wychodzi. Treść SMS zapisuje `sendSms` w tabeli
 * `notifications` salonu (jak każdy SMS transakcyjny).
 *
 * Izolacja salonów: `salonId` z body to cel rezerwacji. Przynależność
 * pracownika, usługi, wariantu i klienta do tego salonu sprawdza
 * `assertSalonRefs` (przez `forSalon`). Wyliczenie kwoty (`calculateExpectedDeposit`)
 * i zapytania samej trasy idą przez `forSalon(salonId)` (kontekst RLS) z jawną
 * listą kolumn i jawnym `eq(salonId)` tam, gdzie tabela ma `salon_id`; wariant
 * usługi zawęża sprawdzona usługa, blok czasu — pracownik.
 */

const SLOT_TAKEN_MESSAGE = "Wybrany termin jest juz zajety. Wybierz inny termin.";
const EMPLOYEE_UNAVAILABLE_MESSAGE = "Pracownik nie jest dostepny w wybranym terminie.";

const DEPOSIT_BLIK_NOT_CONFIGURED_CODE = "DEPOSIT_BLIK_NOT_CONFIGURED";
const BLIK_NOT_CONFIGURED_MESSAGE = "Ten salon nie przyjmuje teraz rezerwacji online z zadatkiem.";

const SERVICE_UNAVAILABLE_MESSAGE = "Wybrana usluga nie jest juz dostepna. Odswiez strone i wybierz ponownie.";
const VARIANT_UNAVAILABLE_MESSAGE =
  "Wybrany wariant uslugi nie jest juz dostepny. Odswiez strone i wybierz ponownie.";
const SALON_UNAVAILABLE_MESSAGE = "Nie znaleziono salonu.";

/**
 * Tolerancja dla terminu tuż przed chwilą serwera: klient wybiera slot chwilę
 * przed jego godziną, a wysłanie formularza może trwać.
 */
const PAST_START_TOLERANCE_MS = 5 * 60_000;
const PAST_START_MESSAGE = "Wybrany termin juz minal. Wybierz inny termin.";

const BOOKING_DURATION_MISMATCH_CODE = "BOOKING_DURATION_MISMATCH";
const BOOKING_DURATION_MISMATCH_MESSAGE =
  "Czas wizyty nie zgadza sie z wybrana usluga. Odswiez strone i sprobuj ponownie.";

const MS_PER_MINUTE = 60_000;

/** Tytuł przelewu, po którym salon rozpozna wpłatę: pierwsze 6 znaków id wizyty. */
const BLIK_TITLE_ID_LENGTH = 6;

function blikTransferTitle(appointmentId: string): string {
  return `Zadatek MH-${appointmentId.slice(0, BLIK_TITLE_ID_LENGTH).toUpperCase()}`;
}

/**
 * Komunikat 409 przy braku numeru BLIK. Telefon salonu (`salons.phone`, dane
 * kontaktowe firmy) dopisujemy, żeby klient mógł umówić się telefonicznie.
 * Numeru BLIK tu nie ma.
 */
function blikNotConfiguredResponse(salonPhone: string | null) {
  const phone = salonPhone?.trim();
  return NextResponse.json(
    {
      success: false,
      code: DEPOSIT_BLIK_NOT_CONFIGURED_CODE,
      error: phone ? `${BLIK_NOT_CONFIGURED_MESSAGE} Zadzwoń: ${phone}` : BLIK_NOT_CONFIGURED_MESSAGE,
    },
    { status: 409 }
  );
}

/** Niepusty napis albo null — `settingsJson` może mieć dowolny kształt. */
function toBlikPhone(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

interface BookingSmsInput {
  salonId: string;
  appointmentId: string;
  clientId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  appointmentDate: Date;
  salonName: string;
  /** Ten sam numer, który trafia do odpowiedzi 201. */
  blikPhone: string;
  amount: number;
  /** Ten sam tytuł, który trafia do odpowiedzi 201. */
  title: string;
}

type BookingSmsFailureReason = "test_phone" | "provider_unavailable" | "send_failed" | "rejected";

/**
 * Powód nieudanej wysyłki z zamkniętej listy. `result.error` nie idzie do logu:
 * błąd złego numeru niesie (zamaskowany) numer klienta.
 */
function bookingSmsFailureReason(result: SmsResult): BookingSmsFailureReason {
  if (result.skipped === "test_phone") return "test_phone";
  if (result.error === SMS_PROVIDER_UNAVAILABLE_ERROR) return "provider_unavailable";
  if (result.error === SMS_SEND_FAILED_ERROR) return "send_failed";
  return "rejected";
}

/**
 * SMS do klienta z numerem BLIK, kwotą i tytułem przelewu. Best-effort: błąd
 * odczytu szczegółów albo wysyłki nie zmienia odpowiedzi 201 — wizyta już
 * istnieje, a dane przelewu klient ma na ekranie. Do logu tylko id wizyty
 * oraz tożsamość błędu albo powód z zamkniętej listy: treść błędu może nieść
 * numer BLIK albo telefon klienta.
 */
async function sendBookingSms(input: BookingSmsInput): Promise<void> {
  try {
    // RLS: appointments, clients, services i employees mają politykę tenant_isolation
    // po salon_id, więc pod forSalon widać tylko wiersze tego salonu; jawne
    // eq(appointments.salonId) zawęża wizytę niezależnie od RLS.
    const [details] = await forSalon(input.salonId).raw((tx) =>
      tx
        .select({
          clientFirstName: clients.firstName,
          clientPhone: clients.phone,
          serviceName: services.name,
          employeeFirstName: employees.firstName,
          employeeLastName: employees.lastName,
        })
        .from(appointments)
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .innerJoin(employees, eq(appointments.employeeId, employees.id))
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.salonId, input.salonId)))
        .limit(1)
    );

    // Klient z kartoteki (wybrany przez personel) ma pierwszeństwo przed
    // polami gościa. Bez telefonu nie ma SMS.
    const phone = details?.clientPhone || input.guestPhone;
    if (!details || !phone) {
      logger.info("[BlikBooking API] Booking SMS skipped", {
        appointmentId: input.appointmentId,
        reason: details ? "no_phone" : "no_details",
      });
      return;
    }

    const result = await sendBlikDepositBookingSms({
      clientPhone: phone,
      clientName: details.clientFirstName || input.guestName || "",
      serviceName: details.serviceName || "",
      employeeName: `${details.employeeFirstName} ${details.employeeLastName}`,
      appointmentDate: input.appointmentDate,
      salonName: input.salonName,
      salonId: input.salonId,
      ...(input.clientId ? { clientId: input.clientId } : {}),
      blikPhone: input.blikPhone,
      amount: input.amount,
      title: input.title,
    });
    // `?.` i ścisłe `=== false`: atrapa bez wyniku (`undefined`) nie jest
    // nieudaną wysyłką i nie może sięgać po stałe błędów.
    if (result?.success === false) {
      logger.warn("[BlikBooking API] Booking SMS not sent", {
        appointmentId: input.appointmentId,
        reason: bookingSmsFailureReason(result),
      });
    }
  } catch (error) {
    logger.warn("[BlikBooking API] Booking SMS failed", {
      appointmentId: input.appointmentId,
      ...toErrorIdentity(error),
    });
  }
}

export async function POST(request: Request) {
  // Limit po IP przed czymkolwiek: trasa publiczna, która blokuje termin
  // pracownika bez płatności online.
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Nieprawidlowe dane zadania", code: "VALIDATION_FAILED" },
      { status: 400 }
    );
  }

  const parsed = parseBody(blikBookingSchema, body);
  if (!parsed.ok) {
    // Do logu same nazwy pól: komunikaty i wartości mogą nieść dane gościa.
    logger.warn("[BlikBooking API] Validation failed", { fields: Object.keys(parsed.error.details) });
    const firstMessage = Object.values(parsed.error.details)[0];
    return NextResponse.json(
      { ...parsed.error, error: firstMessage ?? parsed.error.error, code: "VALIDATION_FAILED" },
      { status: 400 }
    );
  }

  const {
    salonId,
    clientId: bodyClientId,
    employeeId,
    serviceId,
    variantId,
    startTime,
    endTime,
    notes,
    depositAmount: requestedAmount,
    guestName,
    guestPhone,
    guestEmail,
  } = parsed.data;
  const start = new Date(startTime);
  const end = new Date(endTime);

  // Schemat wymaga ISO ze strefą, więc `start` to jednoznaczna chwila —
  // porównanie z zegarem serwera w ms, bez przeliczania stref.
  if (start.getTime() < Date.now() - PAST_START_TOLERANCE_MS) {
    logger.warn("[BlikBooking API] Validation failed", { fields: ["startTime"] });
    return NextResponse.json(
      {
        success: false,
        error: PAST_START_MESSAGE,
        code: "VALIDATION_FAILED",
        details: { startTime: PAST_START_MESSAGE },
      },
      { status: 400 }
    );
  }

  try {
    const session = await getOptionalSession();
    const bookedByUserId = session?.user?.id ?? null;

    // Gość: imię i telefon obowiązkowe (format sprawdził schemat).
    if (!session) {
      if (!guestName) {
        return NextResponse.json(
          { success: false, error: "Imię i nazwisko jest wymagane (min. 2 znaki)" },
          { status: 400 }
        );
      }
      if (!guestPhone) {
        return NextResponse.json(
          { success: false, error: "Podaj prawidłowy numer telefonu (9 cyfr)" },
          { status: 400 }
        );
      }
    }

    // clientId wybiera wyłącznie personel TEGO salonu. Gość i klient portalu
    // nie podpinają kartoteki klienta — opisują go pola guest*.
    const staffCtx = session ? await getSalonContext() : null;
    const isSalonStaff = staffCtx?.salonId === salonId;
    const clientId: string | null = isSalonStaff && bodyClientId ? bodyClientId : null;
    if (!isSalonStaff && bodyClientId) {
      logger.warn("[BlikBooking API] Ignored client-supplied clientId (non-staff booking)", { salonId });
    }

    // Pracownik, usługa, wariant i klient muszą należeć do salonu — przed
    // wyliczeniem kwoty, odczytem ustawień salonu i sprawdzeniem kalendarza.
    const refsError = await assertSalonRefs(salonId, {
      clientId,
      employeeId,
      serviceId,
      variantId: variantId ?? null,
    });
    if (refsError) return refsError;

    // Kwota liczona przez serwer. Błąd wyliczenia = 503, nic nie zapisane.
    let expected: Awaited<ReturnType<typeof calculateExpectedDeposit>>;
    try {
      expected = await calculateExpectedDeposit({
        salonId,
        serviceId,
        variantId: variantId ?? null,
        startTime: start,
        sessionUser: session?.user ?? null,
        guestEmail: guestEmail ?? null,
      });
    } catch (error) {
      logger.error("[BlikBooking API] Deposit calculation failed", { salonId, serviceId, ...toErrorIdentity(error) });
      return NextResponse.json(
        { success: false, error: DEPOSIT_CHECK_UNAVAILABLE_MESSAGE },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    if (!expected.ok) {
      return NextResponse.json(
        {
          success: false,
          error: expected.error === "service_not_found" ? SERVICE_UNAVAILABLE_MESSAGE : VARIANT_UNAVAILABLE_MESSAGE,
        },
        { status: 404 }
      );
    }

    // Ta sama reguła co strażnik /api/appointments i create-session.
    // "none": ta trasa jest wyłącznie dla rezerwacji z zadatkiem.
    const decision = depositDecision(expected, { salonId, serviceId, variantId: variantId ?? null });
    if (decision.kind === "error") {
      return NextResponse.json(
        { success: false, error: DEPOSIT_CHECK_UNAVAILABLE_MESSAGE },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    if (decision.kind === "none") {
      return NextResponse.json(
        {
          success: false,
          error: "Zadatek nie jest wymagany dla tej rezerwacji",
          code: DEPOSIT_NOT_APPLICABLE_CODE,
        },
        { status: 400 }
      );
    }

    if (Math.abs(requestedAmount - decision.amount) > 0.01) {
      logger.warn("[BlikBooking API] Deposit amount mismatch — request rejected", {
        salonId,
        serviceId,
        requestedAmount,
        expectedAmount: decision.amount,
      });
      return NextResponse.json(
        { success: false, error: "Nieprawidlowa kwota zadatku. Odswiez strone i sprobuj ponownie." },
        { status: 400 }
      );
    }
    const depositAmount = decision.amount;

    const salonDb = forSalon(salonId);

    // Numer BLIK i dane odbiorcy. Czytamy tylko poddrzewo ustawień zadatku.
    // W tym samym odczycie długość usługi i modyfikator wariantu (bez nowej
    // transakcji). RLS: services ma politykę po salon_id, a jawne
    // eq(services.salonId) zawęża usługę do salonu; wariant zawęża usługa.
    // Bez wariantu w body join wariantu jest pusty (`false`).
    const [salon] = await salonDb.raw((tx) =>
      tx
        .select({
          name: salons.name,
          phone: salons.phone,
          blikPhone: sql<unknown>`${salons.settingsJson} -> 'deposits' -> 'blikPhone'`,
          serviceDuration: services.baseDuration,
          variantRowId: serviceVariants.id,
          variantDurationModifier: serviceVariants.durationModifier,
        })
        .from(salons)
        .leftJoin(services, and(eq(services.id, serviceId), eq(services.salonId, salons.id)))
        .leftJoin(
          serviceVariants,
          variantId
            ? and(eq(serviceVariants.id, variantId), eq(serviceVariants.serviceId, services.id))
            : sql`false`
        )
        .where(eq(salons.id, salonId))
        .limit(1)
    );
    if (!salon) {
      return NextResponse.json({ success: false, error: SALON_UNAVAILABLE_MESSAGE }, { status: 404 });
    }
    if (salon.serviceDuration == null) {
      return NextResponse.json({ success: false, error: SERVICE_UNAVAILABLE_MESSAGE }, { status: 404 });
    }
    if (variantId && salon.variantRowId == null) {
      return NextResponse.json({ success: false, error: VARIANT_UNAVAILABLE_MESSAGE }, { status: 404 });
    }

    // Równość, nie „≤”: krótsza wizyta też rozjeżdża kalendarz z usługą.
    // Modyfikator liczy się tylko przy znalezionym wariancie (null = 0).
    const expectedMinutes = salon.serviceDuration + (variantId ? (salon.variantDurationModifier ?? 0) : 0);
    const requestedMs = end.getTime() - start.getTime();
    if (requestedMs !== expectedMinutes * MS_PER_MINUTE) {
      logger.warn("[BlikBooking API] Booking duration mismatch — request rejected", {
        salonId,
        serviceId,
        requestedMinutes: requestedMs / MS_PER_MINUTE,
        expectedMinutes,
      });
      return NextResponse.json(
        { success: false, error: BOOKING_DURATION_MISMATCH_MESSAGE, code: BOOKING_DURATION_MISMATCH_CODE },
        { status: 400 }
      );
    }

    const blikPhone = toBlikPhone(salon.blikPhone);
    if (!blikPhone) {
      logger.warn("[BlikBooking API] Deposit booking refused — salon has no BLIK number", { salonId, serviceId });
      return blikNotConfiguredResponse(salon.phone);
    }

    // Kolizja, blokady czasu i zapis w jednej transakcji z kontekstem salonu.
    // Wyścig, którego SELECT nie złapie, odrzuca EXCLUDE w bazie (catch → 409).
    const outcome = await salonDb.raw(async (tx) => {
      const overlapping = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(appointmentConflictWhere({ salonId, employeeId, start, end }));
      if (overlapping.length > 0) return { kind: "slot_taken" as const };

      // time_blocks nie ma salon_id — zawężenie do salonu przez pracownika.
      const conflictingBlocks = await tx
        .select({ id: timeBlocks.id })
        .from(timeBlocks)
        .innerJoin(employees, eq(timeBlocks.employeeId, employees.id))
        .where(
          and(
            eq(timeBlocks.employeeId, employeeId),
            eq(employees.salonId, salonId),
            overlapsRange(timeBlocks.startTime, timeBlocks.endTime, start, end)
          )
        );
      if (conflictingBlocks.length > 0) return { kind: "employee_unavailable" as const };

      const [created] = await tx
        .insert(appointments)
        .values({
          salonId,
          clientId,
          employeeId,
          serviceId,
          variantId: variantId ?? null,
          bookedByUserId,
          startTime: start,
          endTime: end,
          notes: notes ?? null,
          depositAmount: String(depositAmount),
          depositPaid: false,
          status: "scheduled",
          guestName: guestName ?? null,
          guestPhone: guestPhone ?? null,
          guestEmail: guestEmail ?? null,
        })
        .returning({
          id: appointments.id,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          status: appointments.status,
          depositPaid: appointments.depositPaid,
        });
      return created ? { kind: "created" as const, appointment: created } : { kind: "not_created" as const };
    });

    if (outcome.kind === "slot_taken") {
      return NextResponse.json({ success: false, error: SLOT_TAKEN_MESSAGE }, { status: 409 });
    }
    if (outcome.kind === "employee_unavailable") {
      return NextResponse.json({ success: false, error: EMPLOYEE_UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    if (outcome.kind === "not_created") {
      logger.error("[BlikBooking API] Appointment insert returned no row", { salonId });
      return NextResponse.json({ success: false, error: "Nie udalo sie utworzyc rezerwacji" }, { status: 500 });
    }

    const { appointment } = outcome;
    logger.info("[BlikBooking API] Deposit booking created (BLIK to salon)", {
      salonId,
      appointmentId: appointment.id,
      amount: depositAmount,
    });

    const blikTitle = blikTransferTitle(appointment.id);

    // SMS z danymi przelewu: te same `blikPhone` i `blikTitle`, które idą do
    // odpowiedzi — bez drugiego odczytu numeru, więc zmiana numeru przez
    // właściciela w trakcie żądania nie rozjedzie SMS i ekranu.
    await sendBookingSms({
      salonId,
      appointmentId: appointment.id,
      clientId,
      guestName: guestName ?? null,
      guestPhone: guestPhone ?? null,
      appointmentDate: appointment.startTime,
      salonName: salon.name,
      blikPhone,
      amount: depositAmount,
      title: blikTitle,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          appointmentId: appointment.id,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          depositAmount,
          blik: {
            phone: blikPhone,
            recipient: salon.name,
            title: blikTitle,
          },
          status: appointment.status,
          depositPaid: appointment.depositPaid,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    // Równoległy zapis zajął termin: EXCLUDE (23P01) albo zakleszczenie przy
    // jego sprawdzaniu (40P01). Transakcja wycofana, nic nie zapisane.
    if (isAppointmentSlotTaken(error)) {
      return NextResponse.json({ success: false, error: SLOT_TAKEN_MESSAGE }, { status: 409 });
    }
    // Sama tożsamość błędu: treść błędu bazy niesie parametry zapytania (dane gościa).
    logger.error("[BlikBooking API] Deposit booking failed", { salonId, ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie utworzyc rezerwacji" },
      { status: 500 }
    );
  }
}
