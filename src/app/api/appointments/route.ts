import { NextResponse } from "next/server";
import { eq, and, gte, lte, or, not, lt, gt, sql } from "drizzle-orm";
import { validateBody, createAppointmentSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// ADR-001 R2b: POST to świadomie publiczny booking (gość bez sesji salonu) — świadomie surowe db; GET idzie przez forSalon
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { checkPromotionApplicable, computePromoDiscount, type PromotionRejection } from "@/lib/promo-discount";
import { strictRateLimit, apiRateLimit, getClientIp } from "@/lib/rate-limit";
import { getSalonContext } from "@/lib/salon-context";
import { assertSalonRefs } from "@/lib/salon-refs";
import { appointments, clients, employees, salons, services, timeBlocks, promoCodes, promotions } from "@/lib/schema";
import { sendBookingConfirmationSms } from "@/lib/sms";
import { forSalon } from "@/lib/server/repository";
import { getOptionalSession } from "@/lib/session";
import { isValidUuid, isValidDateString } from "@/lib/validations";
// GET /api/appointments - List appointments with optional date range filter
export async function GET(request: Request) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    // Tenant isolation: derive the salon from the session, never trust a
    // client-supplied salonId in the query string (IDOR risk).
    // Faza 3 (role): owner/receptionist widzą pełną listę salonu,
    // employee tylko własne wizyty (filtr niżej).
    const ctx = await getSalonContext();
    if (!ctx) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }
    const salonId = ctx.salonId;

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const employeeId = searchParams.get("employeeId");

    logger.info("[Appointments API] GET with params", { startDate, endDate, salonId, employeeId });

    // Validate date parameters
    if (startDate && !isValidDateString(startDate)) {
      return NextResponse.json(
        { success: false, error: "Invalid startDate format. Use ISO 8601 format (e.g., 2026-01-15T00:00:00Z)" },
        { status: 400 }
      );
    }
    if (endDate && !isValidDateString(endDate)) {
      return NextResponse.json(
        { success: false, error: "Invalid endDate format. Use ISO 8601 format (e.g., 2026-01-15T23:59:59Z)" },
        { status: 400 }
      );
    }

    // Validate UUID parameters
    if (employeeId && !isValidUuid(employeeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid employeeId format" },
        { status: 400 }
      );
    }

    // Rola employee: wynik ograniczony do WŁASNYCH wizyt (spec Fazy 3).
    // Konto pracownicze bez rekordu employees => pusta lista (fail-closed).
    if (ctx.role === "employee" && !ctx.employeeId) {
      return NextResponse.json({ success: true, data: [], count: 0 });
    }

    const conditions = [eq(appointments.salonId, salonId)];

    if (ctx.role === "employee" && ctx.employeeId) {
      conditions.push(eq(appointments.employeeId, ctx.employeeId));
    }

    if (employeeId) {
      conditions.push(eq(appointments.employeeId, employeeId));
    }
    if (startDate && endDate) {
      // Overlap query: appointment overlaps with [startDate, endDate] range
      // when appointment.startTime < endDate AND appointment.endTime > startDate
      conditions.push(lt(appointments.startTime, new Date(endDate)));
      conditions.push(gt(appointments.endTime, new Date(startDate)));
    } else if (startDate) {
      conditions.push(gte(appointments.startTime, new Date(startDate)));
    } else if (endDate) {
      conditions.push(lte(appointments.endTime, new Date(endDate)));
    }

    const result = await forSalon(salonId).raw((tx) =>
      tx.select({
        appointment: appointments,
        client: clients,
        employee: employees,
        service: services,
      })
      .from(appointments)
      .leftJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(employees, eq(appointments.employeeId, employees.id))
      .leftJoin(services, eq(appointments.serviceId, services.id))
      .where(and(...conditions))
      // Bez filtra dat zapytanie zwracaloby cala historie salonu — twardy cap
      // chroni baze; kalendarz i listy zawsze przekazuja zakres dat
      .limit(2000)
    );
    logger.info(`[Appointments API] Query returned ${result.length} rows`);

    // Transform result to a cleaner format
    const formattedAppointments = result.map((row) => ({
      ...row.appointment,
      client: row.client,
      employee: row.employee,
      service: row.service,
    }));

    return NextResponse.json({
      success: true,
      data: formattedAppointments,
      count: formattedAppointments.length,
    });
  } catch (error) {
    logger.error("[Appointments API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointments" },
      { status: 500 }
    );
  }
}

// POST /api/appointments - Create a new appointment
// Auth is optional: logged-in users book with their session, guests provide contact info.
export async function POST(request: Request) {
  try {
    const session = await getOptionalSession();

    // Rate limit by role (UAT S-1): zalogowany wlasciciel/recepcja zapelniajacy
    // kalendarz uzywa ogolnego limitu (60/min); goscie portalu — scislego (5/min)
    // anty-abuse. Wczesniej strict blokowal takze panel po 5 wizytach na minute.
    const ip = getClientIp(request);
    const limiter = session ? apiRateLimit : strictRateLimit;
    const rateLimitResult = limiter.check(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
      );
    }

    const body = await request.json();
    const { salonId, clientId: bodyClientId, employeeId, serviceId, startTime, endTime, notes, depositAmount: bodyDepositAmount, bookedByUserId: bodyUserId, promoCodeId, guestName, guestPhone, guestEmail } = body;

    // bookedByUserId WYLACZNIE z sesji (null dla goscia). Wartosc z body jest
    // ignorowana: pozwalala przypisac wizyte do cudzego konta (portal klienta,
    // odwolanie, opinia, przypomnienia push). Zaden front jej nie wysyla.
    const bookedByUserId: string | null = session?.user?.id || null;
    if (bodyUserId && bodyUserId !== bookedByUserId) {
      logger.warn("[Appointments API] Ignored client-supplied bookedByUserId", {
        sessionUserId: bookedByUserId,
      });
    }

    // Server-side validation with Zod schema
    const validationError = validateBody(createAppointmentSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    // UAT X-1: personel salonu (owner/employee/recepcja) tworzy wizyty tylko
    // we wlasnym salonie. Gosc/klient portalu bez kontekstu salonu bookuje jak
    // dotad. Wczesniej salonId z body byl ufany bez sprawdzenia -> zapis cross-tenant.
    let isStaff = false;
    if (session) {
      const staffCtx = await getSalonContext();
      if (staffCtx && salonId !== staffCtx.salonId) {
        return NextResponse.json(
          { success: false, error: "Brak dostepu do tego salonu" },
          { status: 403 }
        );
      }
      isStaff = !!staffCtx;
    }

    // P1 (Ryan): clientId wybiera WYLACZNIE personel salonu (panel). Gosc i
    // klient portalu nie podpinaja rekordu klienta — gosc jest opisany przez
    // guestName/guestPhone/guestEmail na wizycie (zaden front portalu nie
    // wysyla clientId). Wczesniej dowolny clientId z body: dane klienta w GET
    // wizyty, SMS z nazwa salonu na telefon obcej osoby.
    // "none" to sentinel panelu (brak klienta).
    const clientId: string | null =
      isStaff && bodyClientId && bodyClientId !== "none" ? bodyClientId : null;
    if (!isStaff && bodyClientId && bodyClientId !== "none") {
      logger.warn("[Appointments API] Ignored client-supplied clientId (non-staff booking)", { salonId });
    }

    // P1 (Ryan): depositAmount z body jest ignorowany. Ta trasa nie tworzy
    // platnosci zadatku — wizyta z zadatkiem powstaje w
    // /api/deposits/create-session (kwota liczona serwerowo, deposit-calculation).
    // Kwota z body tylko wylaczala SMS potwierdzenia i udawala zadatek bez platnosci.
    if (bodyDepositAmount) {
      logger.warn("[Appointments API] Ignored client-supplied depositAmount", { salonId });
    }

    // UAT X-2: walidacja formatu identyfikatorow — malformed UUID leci jako
    // 500 z bazy ("invalid input syntax for type uuid"). Zwracamy 400.
    if (!isValidUuid(employeeId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidlowy identyfikator pracownika" },
        { status: 400 }
      );
    }
    if (serviceId && !isValidUuid(serviceId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidlowy identyfikator uslugi" },
        { status: 400 }
      );
    }
    if (clientId && !isValidUuid(clientId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidlowy identyfikator klienta" },
        { status: 400 }
      );
    }

    // Guest validation: require name and phone when not logged in
    if (!session) {
      if (!guestName?.trim() || guestName.trim().length < 2) {
        return NextResponse.json(
          { success: false, error: "Imię i nazwisko jest wymagane (min. 2 znaki)" },
          { status: 400 }
        );
      }
      if (!guestPhone?.trim() || !/^(\+48)?[0-9]{9}$/.test(guestPhone.trim().replace(/[\s\-()]/g, ""))) {
        return NextResponse.json(
          { success: false, error: "Podaj prawidłowy numer telefonu (9 cyfr)" },
          { status: 400 }
        );
      }
    }

    // P1 (Ryan): klient, pracownik i usluga musza nalezec do salonu wizyty —
    // przed sprawdzeniem kolizji (obcy employeeId nie moze nawet sondowac
    // kalendarza innego salonu). Jeden, niezdradzajacy komunikat 400.
    const refsError = await assertSalonRefs(salonId, { clientId, employeeId, serviceId });
    if (refsError) return refsError;

    // Check for overlapping appointments for this employee (only need id for existence check)
    const overlapping = await db.select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, employeeId),
          not(eq(appointments.status, "cancelled")),
          or(
            and(
              lte(appointments.startTime, new Date(startTime)),
              gte(appointments.endTime, new Date(startTime))
            ),
            and(
              lte(appointments.startTime, new Date(endTime)),
              gte(appointments.endTime, new Date(endTime))
            ),
            and(
              gte(appointments.startTime, new Date(startTime)),
              lte(appointments.endTime, new Date(endTime))
            )
          )
        )
      );

    if (overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: "Termin koliduje z istniejaca wizyta. Wybierz inna godzine" },
        { status: 409 }
      );
    }

    // Check for vacation/time blocks that overlap with the requested time
    // Need blockType and reason for the user-facing error message
    const conflictingBlocks = await db.select({
      id: timeBlocks.id,
      blockType: timeBlocks.blockType,
      reason: timeBlocks.reason,
    })
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.employeeId, employeeId),
          // Time block overlaps with requested appointment time
          lt(timeBlocks.startTime, new Date(endTime)),
          gt(timeBlocks.endTime, new Date(startTime))
        )
      );

    if (conflictingBlocks.length > 0) {
      const block = conflictingBlocks[0];
      const blockTypeLabels: Record<string, string> = {
        vacation: "urlop",
        holiday: "dzien wolny",
        break: "przerwa",
        personal: "czas osobisty",
        other: "blokada czasu",
      };
      const label = block ? (blockTypeLabels[block.blockType] || block.blockType) : "blokada czasu";
      return NextResponse.json(
        { success: false, error: `Pracownik ma ${label} w tym terminie${block?.reason ? ` (${block.reason})` : ""}` },
        { status: 409 }
      );
    }

    // Validate promo code if provided. Kwote rabatu liczy serwer z promocji
    // zawezonej do salonu wizyty; discountAmount z zadania jest ignorowany
    // (P1: klient mogl sam ustawic rabat, ktory obniza punkty lojalnosciowe
    // i statystyki przychodu).
    let validatedPromoCodeId: string | null = null;
    let validatedDiscountAmount: string | null = null;

    if (promoCodeId) {
      // Verify the promo code exists, is valid and belongs to this salon
      const [promoCode] = await db
        .select({
          promoCode: promoCodes,
          promotion: promotions,
        })
        .from(promoCodes)
        .leftJoin(promotions, eq(promoCodes.promotionId, promotions.id))
        .where(and(eq(promoCodes.id, promoCodeId), eq(promoCodes.salonId, salonId)))
        .limit(1);

      // Kod (lub promocja) innego salonu traktujemy jak nieistniejacy —
      // nie zdradzamy, ze taki identyfikator istnieje gdzie indziej.
      if (
        !promoCode ||
        promoCode.promoCode.salonId !== salonId ||
        (promoCode.promotion && promoCode.promotion.salonId !== salonId)
      ) {
        return NextResponse.json(
          { success: false, error: "Nieprawidlowy kod promocyjny" },
          { status: 400 }
        );
      }

      const now = new Date();
      const pc = promoCode.promoCode;

      // Check expiry
      if (pc.expiresAt && new Date(pc.expiresAt) < now) {
        return NextResponse.json(
          { success: false, error: "Kod promocyjny wygasl" },
          { status: 400 }
        );
      }

      // Check usage limit
      if (pc.usageLimit != null && pc.usedCount != null && pc.usedCount >= pc.usageLimit) {
        return NextResponse.json(
          { success: false, error: "Limit uzycia kodu promocyjnego zostal wyczerpany" },
          { status: 400 }
        );
      }

      // Check linked promotion: active, within its dates, applicable to the service
      if (promoCode.promotion) {
        const rejection = checkPromotionApplicable(promoCode.promotion, serviceId ?? "", now);
        if (rejection) {
          const messages: Record<PromotionRejection, string> = {
            inactive: "Promocja powiazana z kodem jest nieaktywna",
            not_started: "Promocja powiazana z kodem jeszcze sie nie rozpoczela",
            ended: "Promocja powiazana z kodem juz sie zakonczyla",
            service_not_applicable: "Kod promocyjny nie dotyczy wybranej uslugi",
          };
          return NextResponse.json(
            { success: false, error: messages[rejection] },
            { status: 400 }
          );
        }
      }

      // Rabat liczymy od ceny uslugi z tego salonu — bez uslugi nie ma od czego.
      if (!serviceId) {
        return NextResponse.json(
          { success: false, error: "Kod promocyjny wymaga wybranej uslugi" },
          { status: 400 }
        );
      }
      const [service] = await db
        .select({ basePrice: services.basePrice })
        .from(services)
        .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)))
        .limit(1);
      if (!service) {
        return NextResponse.json(
          { success: false, error: "Nieprawidlowa usluga dla tego salonu" },
          { status: 400 }
        );
      }

      const discount = promoCode.promotion
        ? computePromoDiscount(service.basePrice, promoCode.promotion)
        : 0;

      validatedPromoCodeId = pc.id;
      validatedDiscountAmount = discount > 0 ? discount.toFixed(2) : null;
    }

    logger.info(`[Appointments API] Creating appointment for employee ${employeeId}, bookedBy: ${bookedByUserId}, promoCode: ${validatedPromoCodeId}`);
    const [newAppointment] = await db
      .insert(appointments)
      .values({
        salonId,
        clientId,
        employeeId,
        serviceId: serviceId || null,
        bookedByUserId,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        notes: notes || null,
        depositAmount: null,
        promoCodeId: validatedPromoCodeId,
        discountAmount: validatedDiscountAmount,
        guestName: guestName || null,
        guestPhone: guestPhone || null,
        guestEmail: guestEmail || null,
        status: "scheduled",
      })
      .returning();

    // Increment promo code usage count
    if (validatedPromoCodeId) {
      await db
        .update(promoCodes)
        .set({ usedCount: sql`COALESCE(${promoCodes.usedCount}, 0) + 1` })
        .where(eq(promoCodes.id, validatedPromoCodeId));
      logger.info(`[Appointments API] Incremented usage count for promo code ${validatedPromoCodeId}`);
    }

    logger.info(`[Appointments API] Created appointment with id: ${newAppointment?.id}`);

    // Potwierdzenie SMS — ta trasa tworzy wylacznie wizyty bez zadatku (zadatek:
    // /api/deposits/create-session, SMS wysyla confirmDepositPayment() po oplaceniu).
    // Best-effort: blad wysylki nie moze wywrocic utworzonej rezerwacji.
    if (newAppointment) {
      try {
        const [details] = await db
          .select({
            clientFirstName: clients.firstName,
            clientPhone: clients.phone,
            serviceName: services.name,
            employeeFirstName: employees.firstName,
            employeeLastName: employees.lastName,
            salonName: salons.name,
          })
          .from(appointments)
          .leftJoin(clients, eq(appointments.clientId, clients.id))
          .leftJoin(services, eq(appointments.serviceId, services.id))
          .innerJoin(employees, eq(appointments.employeeId, employees.id))
          .innerJoin(salons, eq(appointments.salonId, salons.id))
          .where(eq(appointments.id, newAppointment.id))
          .limit(1);

        const phone = details?.clientPhone || guestPhone || null;
        if (details && phone) {
          await sendBookingConfirmationSms({
            clientPhone: phone,
            clientName: details.clientFirstName || guestName || "Kliencie",
            serviceName: details.serviceName || "wizyta",
            employeeName: `${details.employeeFirstName} ${details.employeeLastName}`,
            appointmentDate: new Date(startTime),
            salonName: details.salonName,
            salonId,
            ...(newAppointment.clientId ? { clientId: newAppointment.clientId } : {}),
          });
        }
      } catch (smsError) {
        logger.warn("[Appointments API] Booking confirmation SMS failed", {
          appointmentId: newAppointment.id,
          error: smsError,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: newAppointment,
    }, { status: 201 });
  } catch (error) {
    logger.error("[Appointments API] Database error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to create appointment" },
      { status: 500 }
    );
  }
}
