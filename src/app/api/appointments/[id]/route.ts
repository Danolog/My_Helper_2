import { NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { parseBody, updateAppointmentSchema } from "@/lib/api-validation";
import {
  AppointmentGoneError,
  callerAppointmentWhere,
  hasFullAppointmentAccess,
  isForeignAppointment,
} from "@/lib/appointment-access";
import { appointmentError, type AppointmentErrorKey } from "@/lib/appointment-codes";
import {
  APPOINTMENT_COMPLETED_CODE,
  APPOINTMENT_COMPLETED_MESSAGE,
  AppointmentCompletedError,
  COMPLETE_DEDICATED_ROUTE_CODE,
  COMPLETE_DEDICATED_ROUTE_MESSAGE,
  COMPLETED_STATUS,
  completedAppointmentChangedFields,
} from "@/lib/appointment-completion";
import {
  appointmentConflictWhere,
  dbErrorCode,
  isAppointmentSlotTaken,
  overlapsRange,
} from "@/lib/appointment-overlap";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { recordDepositStatusEvent, type DepositStatusEventActor } from "@/lib/deposit-status-events";
import { DEPOSITS_DISABLED_CODE, DEPOSITS_DISABLED_MESSAGE, isDepositEnabled } from "@/lib/features";
import { logger } from "@/lib/logger";
import { NO_SHOW_DEDICATED_ROUTE_CODE, NO_SHOW_STATUS } from "@/lib/no-show";
import { refundAppointmentDeposits, type AppointmentDepositsRefund } from "@/lib/refund";
import { toErrorIdentity } from "@/lib/safe-error";
import {
  AppointmentMarkedNoShowError,
  buildSalonCancellationSms,
  cancelAppointmentInTx,
  expireCheckoutSessions,
} from "@/lib/salon-cancellation";
import { getSalonContext, type SalonContext } from "@/lib/salon-context";
import { assertSalonRefs } from "@/lib/salon-refs";
import { appointments, clients, employees, services, notifications, salons, timeBlocks } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { timeBlockConflictMessage } from "@/lib/time-block-conflict";
import { isValidUuid } from "@/lib/validations";
import { notifyWaitingList } from "@/lib/waiting-list";

// Faza 3 (role): employee widzi/modyfikuje wyłącznie WŁASNE wizyty.
// Cudza wizyta = 404 (nie 403 — nie zdradzamy istnienia zasobu). Warunek
// wspólny dla GET, PUT i DELETE (`@/lib/appointment-access`), przy błędzie
// zamyka dostęp.

/**
 * Czy kwota zadatku z body może być dodatnia. Brak pola i null — nie.
 * Napis przechodzi tylko wtedy, gdy na pewno nie jest większy od 0 ("0",
 * "0.00"). Napis, który nie jest liczbą (np. "NaN", który baza przyjmuje
 * w kolumnie numeric), traktujemy jak kwotę dodatnią: przy wyłączonym
 * zadatku lepiej odmówić niż zapisać zadatek, który klient zobaczy.
 */
function mayBePositiveDepositAmount(amount: string | null | undefined): boolean {
  if (amount === null || amount === undefined) return false;
  return !(Number(amount) <= 0);
}

/**
 * DELETE wizyty oznaczonej „Nie przyszedł”: anulowanie po fakcie zatarłoby
 * nieobecność klienta (licznik na karcie). Pomyłkę cofa się na trasie
 * „Nie przyszedł”, potem można anulować. Ta sama odpowiedź przed transakcją
 * i po blokadzie wiersza.
 */
function noShowCancelResponse() {
  return NextResponse.json(
    {
      success: false,
      code: NO_SHOW_DEDICATED_ROUTE_CODE,
      error: "Najpierw cofnij oznaczenie „Nie przyszedł” w szczegółach wizyty",
    },
    { status: 400 }
  );
}

/**
 * Zmiana statusu wizyty zakończonej (PUT ze statusem, DELETE). Ta sama
 * odpowiedź przed transakcją i po blokadzie wiersza / warunku w UPDATE.
 */
function completedFinalResponse() {
  return NextResponse.json(
    { success: false, code: APPOINTMENT_COMPLETED_CODE, error: APPOINTMENT_COMPLETED_MESSAGE },
    { status: 409 }
  );
}

/**
 * Odpowiedź błędu wizyty ze wspólnym kodem (GET, PUT, DELETE): status HTTP
 * z mapy `APPOINTMENT_ERROR_STATUS` (`@/lib/appointment-codes`), ten sam co
 * w trasie zakończenia. Teksty zostają przy tej trasie. Wizyta cudza
 * i nieistniejąca mają ten sam tekst.
 */
const APPOINTMENT_ERROR_MESSAGES: Record<AppointmentErrorKey, string> = {
  salonNotFound: "Nie znaleziono salonu powiązanego z tym kontem.",
  invalidId: "Nieprawidłowy identyfikator wizyty.",
  appointmentNotFound: "Nie znaleziono wizyty. Odśwież kalendarz.",
  appointmentCancelled: "Ta wizyta jest już odwołana.",
  invalidJson: "Nie udało się odczytać danych formularza. Odśwież stronę i spróbuj ponownie.",
  assignmentForbidden: "Pracownika, klienta i usługę wizyty zmienia właściciel albo recepcja.",
};

/** 500 PUT: nic nie zostało zapisane. */
const UPDATE_FAILED_MESSAGE = "Nie udało się zapisać zmian w wizycie. Spróbuj ponownie.";
/** 500 DELETE: tylko przed zatwierdzeniem anulowania (po nim odpowiedź jest zawsze 200). */
const CANCEL_FAILED_MESSAGE = "Nie udało się odwołać wizyty. Spróbuj ponownie.";

function appointmentErrorResponse(key: AppointmentErrorKey) {
  const { status, body } = appointmentError(key, APPOINTMENT_ERROR_MESSAGES[key]);
  return NextResponse.json(body, { status });
}

/**
 * Pola przypisania wizyty: pracownik, klient i usługa. Zmienia je tylko
 * właściciel albo recepcja (`hasFullAppointmentAccess`) — usługa wyznacza
 * cenę, a cena prowizję; przekazanie wizyty zmienia kalendarz i prowizję
 * innego pracownika; zmiana klienta przepisuje rezerwację na inną osobę.
 */
const ASSIGNMENT_FIELDS = ["employeeId", "clientId", "serviceId"] as const;

/**
 * Pola przypisania, które body zmieniłoby względem zapisanej wizyty. Liczy się
 * wartość, nie obecność pola: dialog edycji wysyła pracownika, klienta
 * i usługę także przy samej zmianie terminu albo notatki. Puste `employeeId`
 * trasa pomija przy zapisie, więc nie jest zmianą (ta sama reguła co dla
 * wizyty zakończonej).
 */
function changedAssignmentFields(
  existing: typeof appointments.$inferSelect,
  input: Parameters<typeof completedAppointmentChangedFields>[1]
): string[] {
  const changed = completedAppointmentChangedFields(existing, input);
  return changed.filter((field) => (ASSIGNMENT_FIELDS as readonly string[]).includes(field));
}

/** Kroki DELETE po zatwierdzeniu anulowania (nazwa w śladzie w logu). */
type CancelFollowUpStep =
  | "expire_checkout_sessions"
  | "refund"
  | "read_names"
  | "sms"
  | "notification"
  | "waiting_list";

/**
 * Stały tekst śladu w logu: anulowanie wizyty jest zatwierdzone w bazie, a krok
 * po nim się nie wykonał. Nazwa kroku w tekście (odczyt logów pokazuje tylko
 * komunikat), bez kwoty, bez identyfikatorów i bez treści błędu.
 */
const CANCEL_COMMITTED_STEP_SKIPPED: Record<CancelFollowUpStep, string> = {
  expire_checkout_sessions: "[Appointments API] anulowanie zatwierdzone, skutek pominięty: expire_checkout_sessions",
  refund: "[Appointments API] anulowanie zatwierdzone, skutek pominięty: refund",
  read_names: "[Appointments API] anulowanie zatwierdzone, skutek pominięty: read_names",
  sms: "[Appointments API] anulowanie zatwierdzone, skutek pominięty: sms",
  notification: "[Appointments API] anulowanie zatwierdzone, skutek pominięty: notification",
  waiting_list: "[Appointments API] anulowanie zatwierdzone, skutek pominięty: waiting_list",
};

/** Warunek „wiersz wołającego”: pracownik zapisuje tylko własną wizytę. */
function callerRowWhere(ctx: SalonContext, id: string) {
  return callerAppointmentWhere(ctx, ctx.salonId, id);
}

/**
 * Zapis samych notatek wizyty zakończonej. Tylko kolumna `notes` — termin,
 * pracownik, usługa, klient, zadatek i status zostają bez zmian. Status
 * wizyty zakończonej nie zmienia się już żadną trasą, więc UPDATE nie
 * potrzebuje warunku statusu. `null` = zapis nie trafił w wiersz wołającego.
 */
async function updateCompletedNotes(ctx: SalonContext, id: string, notes: string | null) {
  const [row] = await forSalon(ctx.salonId).raw((tx) =>
    tx.update(appointments).set({ notes }).where(callerRowWhere(ctx, id)).returning()
  );
  // Tylko nazwa pola — treść notatki nie trafia do logów.
  logger.info(`[Appointments API] Updating appointment ${id}`, { fields: ["notes"] });
  return row ?? null;
}

// GET /api/appointments/[id] - Get a single appointment
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) return appointmentErrorResponse("salonNotFound");
    const salonId = ctx.salonId;

    const { id } = await params;

    if (!isValidUuid(id)) return appointmentErrorResponse("invalidId");

    // Join — przez raw(tx) z jawnym eq(salonId) (defense in depth: filtr
    // aplikacyjny widoczny, plus kontekst RLS ustawiony przez forSalon).
    const result = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          appointment: appointments,
          client: clients,
          employee: employees,
          service: services,
        })
        .from(appointments)
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
        .limit(1)
    );

    const row = result[0];
    if (!row || isForeignAppointment(ctx, row.appointment.employeeId)) {
      return appointmentErrorResponse("appointmentNotFound");
    }

    const formattedAppointment = {
      ...row.appointment,
      client: row.client,
      employee: row.employee,
      service: row.service,
    };

    return NextResponse.json({
      success: true,
      data: formattedAppointment,
    });
  } catch (error) {
    // Tylko nazwa i kod błędu: treść błędu zapytania niesie parametry.
    logger.error("[Appointments API] Database error", { ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Failed to fetch appointment" },
      { status: 500 }
    );
  }
}

// PUT /api/appointments/[id] - Update an appointment (reschedule)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) return appointmentErrorResponse("salonNotFound");
    const salonId = ctx.salonId;

    const { id } = await params;

    if (!isValidUuid(id)) return appointmentErrorResponse("invalidId");

    // Body, które nie jest JSON-em: 400 z kodem, nie 500 z błędu parsowania.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return appointmentErrorResponse("invalidJson");
    }

    // Server-side validation with Zod schema. Zapis czyta SPARSOWANE dane
    // (jak POST): preprocess schematu zamienia same spacje w notes na null —
    // surowe body zapisałoby "   " bez zmian (audyt bezpieczeństwa, przegląd #90).
    const parsed = parseBody(updateAppointmentSchema, body);
    if (!parsed.ok) {
      return NextResponse.json(parsed.error, { status: 400 });
    }

    const { startTime, endTime, employeeId, clientId, serviceId, notes, status, depositAmount, depositPaid } = parsed.data;

    // P1: pola zadatku zmienia tylko wlasciciel (reczne rozliczenie).
    // Poza ta trasa depositPaid ustawia potwierdzenie platnosci (webhook Stripe
    // -> confirmDepositPayment) albo reczne oznaczenie zadatku w panelu, a kwote
    // ustala sciezka rezerwacji z zadatkiem (nie tylko create-session).
    // Zaden ekran panelu nie wysyla tych pol w PUT. Pracownik/recepcja,
    // ktorzy "oplacali" zadatek recznie, wlaczali tez sciezke zwrotu przy
    // anulacji (DELETE) — dlatego 403, nie ciche pominiecie.
    // Zmiana `depositPaid` zapisuje wpis dziennika `owner_edit` w transakcji zapisu.
    if ((depositAmount !== undefined || depositPaid !== undefined) && ctx.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "Tylko wlasciciel salonu moze zmieniac zadatek" },
        { status: 403 }
      );
    }
    // Zmiana `depositPaid` w PUT jest tylko wlasciciela (403 wyzej).
    const ownerActor: DepositStatusEventActor | null =
      ctx.role === "owner" ? { userId: ctx.userId, role: "owner" } : null;

    // Check if appointment exists in the caller's salon — cudza/nieistniejaca
    // wizyta = 404 (scoped findOne, kontekst RLS ustawiony).
    const existing = await forSalon(salonId).findOne(appointments, id);

    // Brak wizyty i cudza wizyta pracownika przed sprawdzeniem statusu:
    // 404, nie 409 — odpowiedź nie zdradza, że wizyta istnieje ani że jest zakończona.
    if (!existing || isForeignAppointment(ctx, existing.employeeId)) {
      return appointmentErrorResponse("appointmentNotFound");
    }

    // Pracownik w swojej wizycie zmienia termin i notatkę. Pracownika, klienta
    // i usługę zmienia tylko właściciel albo recepcja: inna wartość od
    // pracownika → 403, nic nie zapisane (odrzucenie, nie ciche pominięcie —
    // panel nie pokaże sukcesu przy niezapisanej zmianie). Ta sama wartość
    // przechodzi. Przed sprawdzeniem statusu: pracownik widzi tę wizytę.
    const fullAccess = hasFullAppointmentAccess(ctx);
    if (!fullAccess && changedAssignmentFields(existing, parsed.data).length > 0) {
      return appointmentErrorResponse("assignmentForbidden");
    }

    // Wizyta zakończona ma ostateczny wynik: prowizja, zużycie materiałów
    // i punkty policzone są dla jej terminu, pracownika, usługi i klienta.
    // Zmienić można tylko notatki. Pole z body liczy się jako zmiana, gdy różni
    // się od zapisanej wartości — cały obiekt z niezmienionymi polami przechodzi.
    // Status wizyty zakończonej nie zmienia się już nigdzie, więc zapis samych
    // notatek nie potrzebuje warunku statusu w UPDATE.
    if (existing.status === COMPLETED_STATUS) {
      if (completedAppointmentChangedFields(existing, parsed.data).length > 0) {
        return completedFinalResponse();
      }
      if (notes === undefined) {
        return NextResponse.json({
          success: true,
          data: existing,
          message: "Appointment rescheduled successfully",
        });
      }
      const saved = await updateCompletedNotes(ctx, id, notes);
      // Wiersz zniknął (albo przepisany na innego pracownika) po odczycie.
      if (!saved) return appointmentErrorResponse("appointmentNotFound");
      return NextResponse.json({
        success: true,
        data: saved,
        message: "Appointment rescheduled successfully",
      });
    }

    // „Nie przyszedł” zmienia wyłącznie /api/appointments/[id]/no-show (rola
    // właściciel/recepcja, dzień wizyty). Inaczej pracownik oznaczałby tu własną
    // wizytę, a licznik nieobecności klienta zależałby od dwóch tras.
    if (
      status === NO_SHOW_STATUS ||
      (existing.status === NO_SHOW_STATUS && status != null)
    ) {
      return NextResponse.json(
        {
          success: false,
          code: NO_SHOW_DEDICATED_ROUTE_CODE,
          error: "Oznaczenie „Nie przyszedł” zmienisz przyciskiem w szczegółach wizyty",
        },
        { status: 400 }
      );
    }

    // `completed` ustawia wyłącznie /api/appointments/[id]/complete — tam w tej
    // samej transakcji zapisuje się płatność, prowizja i zużycie materiałów.
    if (status === COMPLETED_STATUS) {
      return NextResponse.json(
        { success: false, code: COMPLETE_DEDICATED_ROUTE_CODE, error: COMPLETE_DEDICATED_ROUTE_MESSAGE },
        { status: 400 }
      );
    }

    // P1 (audyt bezpieczeństwa): klient, pracownik i usluga z body musza nalezec do salonu
    // z sesji — inaczej wizyta wskazywalaby cudzego klienta (dane w GET) lub
    // blokowala kalendarz pracownika innego salonu. null = wyczyszczenie pola.
    const refsError = await assertSalonRefs(salonId, { clientId, employeeId, serviceId });
    if (refsError) return refsError;

    // If times or employee changed, check for conflicts
    const newStartTime = startTime ? new Date(startTime) : existing.startTime;
    const newEndTime = endTime ? new Date(endTime) : existing.endTime;
    const newEmployeeId = employeeId || existing.employeeId;

    // Koniec po początku — na wartościach SCALONYCH z istniejącą wizytą (samo
    // endTime wcześniejsze niż zapisany start albo samo startTime po zapisanym
    // końcu). Przedział pusty/odwrócony nigdy nie trafia w warunek kolizji
    // półotwartej, więc ominąłby sprawdzenie (#165). Komunikat jak w POST.
    if (!(newEndTime.getTime() > newStartTime.getTime())) {
      return NextResponse.json(
        { success: false, error: "Czas zakonczenia musi byc pozniej niz czas rozpoczecia" },
        { status: 400 }
      );
    }

    // #168: blokady czasu (urlop, przerwa…) sprawdzamy, gdy wizyta zmienia
    // termin albo pracownika (porównanie WARTOŚCI — dialog edycji wysyła czas
    // i pracownika także przy samej zmianie notatki) albo gdy anulowana wizyta
    // wraca do kalendarza. Wizyta, która już leży na blokadzie dodanej później,
    // nie blokuje edycji notatki ani anulacji. Wynik anulowany: bez sprawdzenia.
    const resultingStatus = status ?? existing.status;
    const slotChanged =
      newStartTime.getTime() !== new Date(existing.startTime).getTime() ||
      newEndTime.getTime() !== new Date(existing.endTime).getTime() ||
      newEmployeeId !== existing.employeeId;
    const revived = existing.status === "cancelled" && resultingStatus !== "cancelled";
    const checkTimeBlocks = resultingStatus !== "cancelled" && (slotChanged || revived);

    // Zadatek wyłączony (isDepositEnabled): kwota zadatku większa od 0 dałaby
    // klientowi w portalu zadatek „oczekujący”, którego nie ma jak wpłacić.
    // Odmowa przed zapisem; null i zero przechodzą, żeby dało się wyczyścić
    // kwotę na starych wizytach. Stoi za walidacją, bramką roli i sprawdzeniem
    // wizyty, więc odpowiedzi 401/403/404/400 zostają w dotychczasowej kolejności.
    if (mayBePositiveDepositAmount(depositAmount) && !isDepositEnabled()) {
      return NextResponse.json(
        { success: false, code: DEPOSITS_DISABLED_CODE, error: DEPOSITS_DISABLED_MESSAGE },
        { status: 409 }
      );
    }

    // Build update object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (startTime) updateData.startTime = newStartTime;
    if (endTime) updateData.endTime = newEndTime;
    // Pracownik: pola przypisania są tu takie jak w odczycie (inna wartość →
    // 403 wyżej), więc nie trafiają do zapisu — zapis pracownika nie nadpisze
    // zmiany przypisania, którą właściciel albo recepcja zapisali po odczycie.
    if (fullAccess) {
      if (employeeId) updateData.employeeId = employeeId;
      if (clientId !== undefined) updateData.clientId = clientId;
      if (serviceId !== undefined) updateData.serviceId = serviceId;
    }
    if (notes !== undefined) updateData.notes = notes;
    if (status) updateData.status = status;
    if (depositAmount !== undefined) updateData.depositAmount = depositAmount;
    if (depositPaid !== undefined) updateData.depositPaid = depositPaid;

    // Body bez żadnego pola do zapisu: nic się nie zmienia, odpowiedź z wizytą
    // z odczytu (UPDATE bez kolumn byłby błędem zapytania i 500).
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({
        success: true,
        data: existing,
        message: "Appointment rescheduled successfully",
      });
    }

    // Sprawdzenie kolizji + update w JEDNYM kontekscie RLS (raw(tx)); jawny
    // eq(salonId) zachowany jako filtr aplikacyjny (defense in depth).
    const conflict = await forSalon(salonId).raw(async (tx) => {
      const overlapping = await tx.select({ id: appointments.id })
        .from(appointments)
        .where(
          // Półotwarte [start, end) (#165); wizyta nie koliduje sama ze sobą.
          appointmentConflictWhere({
            salonId,
            employeeId: newEmployeeId,
            start: newStartTime,
            end: newEndTime,
            excludeId: id,
          })
        );

      if (overlapping.length > 0) {
        return { conflicting: overlapping[0], blocked: null, updated: null as typeof appointments.$inferSelect | null };
      }

      // #168: ta sama reguła co POST — blokada NOWEGO pracownika, [start, end)
      // (styk nie koliduje). timeBlocks nie ma salonId: zakres pilnuje
      // pracownik (assertSalonRefs wyżej) + kontekst RLS transakcji.
      if (checkTimeBlocks) {
        const [block] = await tx
          .select({ id: timeBlocks.id, blockType: timeBlocks.blockType, reason: timeBlocks.reason })
          .from(timeBlocks)
          .where(
            and(
              eq(timeBlocks.employeeId, newEmployeeId),
              overlapsRange(timeBlocks.startTime, timeBlocks.endTime, newStartTime, newEndTime)
            )
          )
          .limit(1);
        if (block) {
          return { conflicting: null, blocked: block, updated: null };
        }
      }

      // Tylko nazwy pól — wartości (notatka o kliencie, clientId, zadatek) nie
      // trafiają do logów (hotfix P1, dane osobowe w logach).
      logger.info(`[Appointments API] Updating appointment ${id}`, { fields: Object.keys(updateData) });

      // Odczyt `existing` sprzed transakcji nie decyduje o wpisie: wartość z blokadą wiersza.
      const [locked] = depositPaid !== undefined
        ? await tx
            .select({ depositPaid: appointments.depositPaid })
            .from(appointments)
            .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
            .limit(1)
            .for("update")
        : [];

      // Zapis czegokolwiek poza notatkami z warunkiem „nie zakończona” w samym
      // UPDATE: odczyt `existing` jest sprzed transakcji, a zakończenie mogło
      // wejść po nim (np. przeniesienie w kalendarzu równolegle z zakończeniem).
      // UPDATE czeka na blokadę wiersza i sprawdza warunek ponownie.
      // Pracownik zapisuje tylko własną wizytę: warunek pracownika w UPDATE
      // sprawdzany ponownie po czekaniu na blokadę (przepisanie w tej chwili).
      const changesBeyondNotes = Object.keys(updateData).some((field) => field !== "notes");
      const [updatedAppointment] = await tx
        .update(appointments)
        .set(updateData)
        .where(
          changesBeyondNotes
            ? and(callerRowWhere(ctx, id), ne(appointments.status, COMPLETED_STATUS))
            : callerRowWhere(ctx, id)
        )
        .returning();

      if (!updatedAppointment) {
        // Stan wiersza z tej samej transakcji: nowe zapytanie w READ COMMITTED
        // widzi zmianę zatwierdzoną w czasie czekania na blokadę (zakończenie,
        // usunięcie, przepisanie na innego pracownika). Błąd wycofuje całą
        // transakcję; 200 z `data: null` nie wychodzi.
        const [current] = await tx
          .select({
            status: appointments.status,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            employeeId: appointments.employeeId,
            clientId: appointments.clientId,
            serviceId: appointments.serviceId,
            depositAmount: appointments.depositAmount,
            depositPaid: appointments.depositPaid,
          })
          .from(appointments)
          .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
          .limit(1);
        // Brak wizyty i cudza wizyta pracownika przed statusem: 404, nie 409.
        if (!current || isForeignAppointment(ctx, current.employeeId)) throw new AppointmentGoneError();
        if (current.status !== COMPLETED_STATUS) {
          // Wiersz jest, nie jest zakończony, a warunek UPDATE go nie objął —
          // stan, którego trasa nie przewiduje. Wycofanie i 500 z logiem.
          throw new Error("Appointment update matched no row");
        }
        // Zakończenie weszło w trakcie zapisu. Dialog edycji wysyła termin,
        // pracownika, klienta i usługę także przy samej zmianie notatki: gdy te
        // pola są takie jak w zakończonej wizycie, zapisuje się tylko notatka
        // (jak przy wizycie zakończonej przed odczytem). Inaczej 409.
        if (completedAppointmentChangedFields(current, parsed.data).length > 0) {
          throw new AppointmentCompletedError();
        }
        const [saved] =
          notes === undefined
            ? await tx.select().from(appointments).where(callerRowWhere(ctx, id)).limit(1)
            : await tx.update(appointments).set({ notes }).where(callerRowWhere(ctx, id)).returning();
        if (!saved) throw new AppointmentGoneError();
        return { conflicting: null, blocked: null, updated: saved };
      }

      if (
        depositPaid !== undefined &&
        ownerActor &&
        locked &&
        updatedAppointment &&
        (locked.depositPaid === true) !== depositPaid
      ) {
        await recordDepositStatusEvent(tx, {
          salonId,
          appointmentId: id,
          previousDepositPaid: locked.depositPaid,
          depositPaid,
          source: "owner_edit",
          actor: ownerActor,
        });
      }

      return { conflicting: null, blocked: null, updated: updatedAppointment };
    });

    if (conflict.conflicting) {
      return NextResponse.json(
        { success: false, error: "Termin koliduje z istniejaca wizyta. Wybierz inna godzine", conflictingAppointment: conflict.conflicting },
        { status: 409 }
      );
    }

    if (conflict.blocked) {
      return NextResponse.json(
        { success: false, error: timeBlockConflictMessage(conflict.blocked) },
        { status: 409 }
      );
    }

    const updatedAppointment = conflict.updated;

    logger.info(`[Appointments API] Updated appointment ${id} successfully`);

    return NextResponse.json({
      success: true,
      data: updatedAppointment,
      message: "Appointment rescheduled successfully",
    });
  } catch (error) {
    // Zakończenie weszło między odczytem a zapisem statusu — nic nie zapisane.
    if (error instanceof AppointmentCompletedError) {
      return completedFinalResponse();
    }
    // Wizyta zniknęła (albo przepisana na innego pracownika) w trakcie zapisu.
    if (error instanceof AppointmentGoneError) {
      return appointmentErrorResponse("appointmentNotFound");
    }
    // #171: równoległy zapis zajął termin (EXCLUDE w bazie: 23P01 albo 40P01
    // przy jego sprawdzaniu, przeniesienia „na krzyż”) — ta sama kolizja.
    if (isAppointmentSlotTaken(error)) {
      return NextResponse.json(
        { success: false, error: "Termin koliduje z istniejaca wizyta. Wybierz inna godzine" },
        { status: 409 }
      );
    }
    // Tylko nazwa i kod błędu: treść błędu zapytania niesie parametry
    // (notatka o kliencie, zadatek).
    // `code` — SQLSTATE także z błędu opakowanego głębiej (#171).
    logger.error("[Appointments API] Database error", { ...toErrorIdentity(error), code: dbErrorCode(error) });
    return NextResponse.json(
      { success: false, error: UPDATE_FAILED_MESSAGE },
      { status: 500 }
    );
  }
}

/** Odczyt DELETE sprzed transakcji: wizyta z klientem, pracownikiem i usługą. */
type CancelReadRow = {
  appointment: typeof appointments.$inferSelect;
  client: typeof clients.$inferSelect | null;
  employee: typeof employees.$inferSelect | null;
  service: typeof services.$inferSelect | null;
};

/**
 * Klient do SMS-a o odwołaniu — z wiersza spod blokady (`cancelled`). Gdy
 * identyfikator jest taki jak w odczycie sprzed transakcji, klient z tego
 * odczytu (brak wiersza klienta = bez SMS-a). Bez zapytania.
 */
function cancelledClientId(before: CancelReadRow, cancelled: typeof appointments.$inferSelect): string | null {
  return cancelled.clientId === before.appointment.clientId ? (before.client?.id ?? null) : cancelled.clientId;
}

/**
 * Nazwa usługi i pracownik wizyty odwołanej — dla identyfikatorów z wiersza
 * spod blokady (`cancelled`). Gdy identyfikator jest taki jak w odczycie
 * sprzed transakcji, dane z tego odczytu; gdy się zmienił (wizyta przepisana
 * przed blokadą), ponowny odczyt w salonie z sesji.
 */
async function cancelledLabels(
  salonId: string,
  before: CancelReadRow,
  cancelled: typeof appointments.$inferSelect
) {
  let serviceName = before.service?.name ?? null;
  let employee = before.employee
    ? { firstName: before.employee.firstName, lastName: before.employee.lastName }
    : null;

  const serviceId = cancelled.serviceId;
  const employeeId = cancelled.employeeId;
  const serviceChanged = serviceId !== before.appointment.serviceId;
  const employeeChanged = employeeId !== before.appointment.employeeId;
  if (serviceChanged || employeeChanged) {
    await forSalon(salonId).raw(async (tx) => {
      if (serviceChanged) {
        const [service] = serviceId
          ? await tx
              .select({ name: services.name })
              .from(services)
              .where(and(eq(services.id, serviceId), eq(services.salonId, salonId)))
              .limit(1)
          : [];
        serviceName = service?.name ?? null;
      }
      if (employeeChanged) {
        const [current] = employeeId
          ? await tx
              .select({ firstName: employees.firstName, lastName: employees.lastName })
              .from(employees)
              .where(and(eq(employees.id, employeeId), eq(employees.salonId, salonId)))
              .limit(1)
          : [];
        employee = current ?? null;
      }
    });
  }
  return { serviceName, employee };
}

// DELETE /api/appointments/[id] - Cancel an appointment with deposit rules
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const ctx = await getSalonContext();
    if (!ctx) return appointmentErrorResponse("salonNotFound");
    const salonId = ctx.salonId;

    const { id } = await params;
    // Niepoprawny identyfikator dawał błąd bazy (22P02) i 500.
    if (!isValidUuid(id)) return appointmentErrorResponse("invalidId");
    const url = new URL(request.url);
    const notifyClient = url.searchParams.get("notifyClient") === "true";

    // Fetch the appointment with client info, scoped to the caller's salon
    // (join przez raw(tx) z jawnym eq(salonId) — cudza wizyta = pusty wynik = 404).
    const result = await forSalon(salonId).raw((tx) =>
      tx
        .select({
          appointment: appointments,
          client: clients,
          employee: employees,
          service: services,
        })
        .from(appointments)
        .leftJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(employees, eq(appointments.employeeId, employees.id))
        .leftJoin(services, eq(appointments.serviceId, services.id))
        .where(and(eq(appointments.id, id), eq(appointments.salonId, salonId)))
        .limit(1)
    );

    // Brak wizyty i cudza wizyta pracownika przed sprawdzeniem statusu:
    // 404, nie 409 — odpowiedź nie zdradza, że wizyta istnieje ani że jest zakończona.
    const row = result[0];
    if (!row || isForeignAppointment(ctx, row.appointment.employeeId)) {
      return appointmentErrorResponse("appointmentNotFound");
    }

    const appointment = row.appointment;

    // Check if already cancelled
    if (appointment.status === "cancelled") return appointmentErrorResponse("appointmentCancelled");

    // Wczesne sprawdzenie; po blokadzie wiersza sprawdza je ponownie
    // `cancelAppointmentInTx` (oznaczenie wstawione między odczytem a transakcją).
    if (appointment.status === NO_SHOW_STATUS) {
      return noShowCancelResponse();
    }

    // Wizyta zakończona: anulowanie zwróciłoby zadatek za wykonaną usługę.
    // Po blokadzie wiersza sprawdza to ponownie `cancelAppointmentInTx`.
    if (appointment.status === COMPLETED_STATUS) {
      return completedFinalResponse();
    }

    // refund-fix RF1 + #70 pkt 1: płatność pending → failed i wizyta →
    // cancelled w JEDNEJ transakcji (kontekst RLS salonu); decyzja o zwrocie
    // i o tym, czy wizyta jest wołającego, na stanie wizyty po blokadzie
    // (`src/lib/salon-cancellation.ts`). Wizyta cudza po blokadzie rzuca
    // `AppointmentGoneError` (404 w `catch`), a transakcja się wycofuje.
    const txResult = await forSalon(salonId).raw((tx) => cancelAppointmentInTx(tx, salonId, id, ctx));
    if ("alreadyCancelled" in txResult) return appointmentErrorResponse("appointmentCancelled");
    const { cancelled: cancelledAppointment, depositPaid, variant, failedPayments } = txResult;
    // Od tego miejsca kwota, termin, pracownik, usługa i klient ze stanu spod
    // blokady (wiersz z UPDATE), nie z odczytu sprzed transakcji.
    const depositAmount = txResult.depositAmount ? parseFloat(txResult.depositAmount) : 0;
    const hasDeposit = depositAmount > 0;

    // Anulowanie jest zatwierdzone w bazie. Od tego miejsca odpowiedź jest
    // zawsze 200 z sukcesem: żaden krok poniżej nie trafia do `catch` z 500
    // (ponowna próba dałaby „już odwołana”, a panel pokazałby porażkę).
    // Krok, który się nie wykona, zostawia ślad w logu stałym tekstem.
    const skipped = (step: CancelFollowUpStep) =>
      logger.warn(CANCEL_COMMITTED_STEP_SKIPPED[step], { appointmentId: id, step, hasDeposit, depositPaid });

    // Calculate time difference (informacyjnie — salon zwraca zadatek zawsze, RF1)
    const now = new Date();
    const startTime = new Date(cancelledAppointment.startTime);
    const hoursUntilAppointment = (startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isMoreThan24h = hoursUntilAppointment > 24;

    // #70 pkt 1: otwarta sesja Checkout nie przyjmie już wpłaty (błąd = warn).
    try {
      await expireCheckoutSessions(id, failedPayments);
    } catch (expireError) {
      logger.error("[Appointments API] Failed to expire checkout sessions", {
        ...toErrorIdentity(expireError),
        appointmentId: id,
      });
      skipped("expire_checkout_sessions");
    }

    // RF1: odwołanie przez salon = pełny zwrot, niezależnie od reguły 24 h.
    // Zwrot przed odczytem nazw: nazwy są potrzebne dopiero w SMS-ie.
    let refundResult: AppointmentDepositsRefund | null = null;
    let refundThrew = false;
    if (hasDeposit && depositPaid) {
      try {
        // Każda płatność `succeeded` osobno, od najstarszej (recenzja, #98).
        refundResult = await refundAppointmentDeposits(id, "Odwolanie wizyty przez salon - pelny zwrot zadatku");
      } catch (refundError) {
        refundThrew = true;
        logger.error("[Appointments API] Deposit refund threw after salon cancellation — manual refund", {
          ...toErrorIdentity(refundError),
          appointmentId: id,
        });
      }
      if (refundResult && !refundResult.success) {
        logger.error("[Appointments API] Deposit refund failed after salon cancellation — manual refund", {
          appointmentId: id,
          salonId,
          refundMessage: refundResult.message,
        });
      }
      if (refundThrew || refundResult?.success === false) skipped("refund");
    }
    const refundFailed = refundThrew || refundResult?.success === false;

    // Nazwy usługi, pracownika i salonu do SMS-a i listy oczekujących. Błąd
    // odczytu nie cofa odwołania: wartości zapasowe, jeden log, ślad.
    let labels: Awaited<ReturnType<typeof cancelledLabels>> = { serviceName: null, employee: null };
    let salon: { name: string | null; phone: string | null } | undefined;
    try {
      labels = await cancelledLabels(salonId, row, cancelledAppointment);
      // Efekty uboczne anulacji w kontekscie RLS salonu z sesji (#193): nazwa
      // salonu (polityka `tenant_self`) i wpis powiadomienia; jawny filtr zostaje.
      [salon] = await forSalon(salonId).raw((tx) =>
        tx
          .select({ name: salons.name, phone: salons.phone })
          .from(salons)
          .where(eq(salons.id, salonId))
          .limit(1)
      );
    } catch (namesError) {
      logger.error("[Appointments API] Failed to read names after cancellation", {
        ...toErrorIdentity(namesError),
        appointmentId: id,
      });
      skipped("read_names");
    }

    logger.info("[Appointments API] Cancelled appointment by salon", {
      appointmentId: id,
      hoursUntilAppointment: hoursUntilAppointment.toFixed(1),
      hasDeposit,
      depositPaid,
      variant,
      refunded: refundResult?.refunded ?? false,
      refundFailed,
      expiredSessions: failedPayments.length,
      notifyClient,
    });

    const salonName = salon?.name || "Salon";
    const serviceName = labels.serviceName || "Wizyta";

    // RF2: JEDEN SMS (odwołanie + ewentualny zwrot), bez linku do rezerwacji.
    const notifiedClientId = cancelledClientId(row, cancelledAppointment);
    const shouldNotify = !!notifiedClientId && (notifyClient || refundResult?.refunded === true);
    let clientNotified = false;
    if (shouldNotify && notifiedClientId) {
      let smsStep: CancelFollowUpStep = "sms";
      try {
        const message = buildSalonCancellationSms({
          salonName,
          salonPhone: salon?.phone ?? null,
          serviceName,
          startTime,
          variant,
          depositAmount,
        });
        const clientId = notifiedClientId;
        smsStep = "notification";
        await forSalon(salonId).raw((tx) =>
          tx.insert(notifications).values({
            salonId,
            clientId,
            type: "sms",
            message,
            status: "pending",
          })
        );
        clientNotified = true;
      } catch (notifError) {
        logger.error("[Appointments API] Failed to create notification", {
          ...toErrorIdentity(notifError),
          appointmentId: id,
        });
        skipped(smsStep);
        // Don't fail the cancellation if notification creation fails
      }
    }

    // Notify waiting list entries about the freed slot
    try {
      const employeeName = labels.employee
        ? `${labels.employee.firstName} ${labels.employee.lastName}`
        : "Pracownik";

      const waitingListResult = await notifyWaitingList({
        salonId: cancelledAppointment.salonId,
        serviceId: cancelledAppointment.serviceId,
        employeeId: cancelledAppointment.employeeId,
        startTime,
        endTime: new Date(cancelledAppointment.endTime),
        serviceName,
        employeeName,
        salonName,
      });

      // Tylko liczniki — wynik nie może zawierać danych klientów z listy oczekujących.
      const { notified, smsCount, pushCount, errors } = waitingListResult;
      logger.info(`[Appointments API] Waiting list notification result`, { notified, smsCount, pushCount, errors });
    } catch (waitingListError) {
      logger.error("[Appointments API] Failed to notify waiting list", { ...toErrorIdentity(waitingListError) });
      skipped("waiting_list");
      // Don't fail the cancellation if waiting list notification fails
    }

    return NextResponse.json({
      success: true,
      data: cancelledAppointment,
      message: "Appointment cancelled successfully",
      cancellationDetails: {
        hoursUntilAppointment: Math.max(0, hoursUntilAppointment),
        isMoreThan24h,
        hasDeposit,
        depositPaid,
        depositAmount,
        depositRefunded: refundResult?.refunded === true,
        // RF1: salon nigdy nie zatrzymuje zadatku (pole zostaje dla zgodności UI).
        depositForfeited: false,
        depositVariant: variant,
        refundFailed,
        clientNotified,
        refund: refundResult ? {
          processed: refundResult.refunded,
          refundId: refundResult.refundId,
          amount: refundResult.amount,
          // Kwota, która nie wróciła (toast przy refundFailed — recenzja, #98).
          failedAmount: refundResult.failedAmount ?? null,
          message: refundResult.message,
        } : null,
      },
    });
  } catch (error) {
    // Oznaczenie „Nie przyszedł” weszło po wczesnym sprawdzeniu: transakcja
    // anulowania jest wycofana, bez zwrotu, SMS-a i listy oczekujących.
    if (error instanceof AppointmentMarkedNoShowError) {
      return noShowCancelResponse();
    }
    // Zakończenie weszło po wczesnym sprawdzeniu — anulowanie wycofane w całości.
    if (error instanceof AppointmentCompletedError) {
      return completedFinalResponse();
    }
    // Wizyta zniknęła albo po blokadzie jest cudza (przepisana na innego
    // pracownika): anulowanie wycofane w całości, ta sama odpowiedź co dla
    // wizyty nieistniejącej, bez logu.
    if (error instanceof AppointmentGoneError) {
      return appointmentErrorResponse("appointmentNotFound");
    }
    // Tylko nazwa i kod błędu: treść błędu zapytania niesie parametry.
    logger.error("[Appointments API] Database error", { ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: CANCEL_FAILED_MESSAGE },
      { status: 500 }
    );
  }
}
