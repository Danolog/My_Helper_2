import crypto from "crypto";
import { eq, and, asc, gt, isNull, isNotNull, or } from "drizzle-orm";
import { appointmentConflictWhere, dbErrorCode, isAppointmentSlotTaken } from "@/lib/appointment-overlap";
import {
  checkBookingWithoutDeposit,
  DEPOSIT_CHECK_UNAVAILABLE_MESSAGE,
  DEPOSIT_REQUIRED_MESSAGE,
} from "@/lib/deposit-guard";
import { logger } from "@/lib/logger";
import { sendPushNotification } from "@/lib/push";
import {
  waitingList,
  clients,
  user,
  appointments,
  notifications,
  salons,
} from "@/lib/schema";
import { getSalonModules } from "@/lib/server/modules";
import { forSalon } from "@/lib/server/repository";
import { resolveWaitingListToken } from "@/lib/server/system";
import { buildWaitingListSms, sendSms, SMS_TIME_ZONE } from "@/lib/sms";
import { isTestPhoneNumber } from "@/lib/test-phone";
import { buildWaitingListPush, type WaitingListPushContent } from "@/lib/waiting-list-message";

// #193 P5a-1 (decyzja CTO 4): bez puli `db`. notifyWaitingList działa w
// forSalon(params.salonId); accept/decline ustalają salon wyłącznie przez
// wyjście `resolveWaitingListToken` i dalej idą przez forSalon(salonId).
// Każde polecenie to osobne `raw(...)` — jak przed zmianą, gdzie każde było
// osobnym poleceniem bez wspólnej transakcji (#171: błąd EXCLUDE dotyczy
// jednego zapisu). Wysyłka (SMS, push) i wyliczenie zadatku są wołane poza
// callbackiem bramy.

type SalonGate = ReturnType<typeof forSalon>;

/**
 * Konto klienta do wysyłki push: JEDYNE miejsce odczytu tabeli kont w tym
 * module. Tylko konto ze ZWERYFIKOWANYM e-mailem równym e-mailowi klienta
 * (ta sama reguła co src/lib/client-match.ts) — konto założone na cudzy
 * adres nie dostaje danych klienta, salonu, usługi, pracownika i terminu.
 * null = brak takiego konta.
 */
async function findVerifiedLinkedUserId(gate: SalonGate, email: string): Promise<string | null> {
  const [linkedUser] = await gate.raw((tx) =>
    tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, email), eq(user.emailVerified, true)))
      .limit(1)
  );
  return linkedUser?.id ?? null;
}

interface NotifyWaitingListParams {
  salonId: string;
  serviceId: string | null;
  employeeId: string | null;
  startTime: Date;
  endTime: Date;
  serviceName: string;
  /** Podawany przez wołających; treść powiadomień go nie zawiera. */
  employeeName: string;
  salonName: string;
}

interface NotifyWaitingListResult {
  notified: number;
  smsCount: number;
  pushCount: number;
  errors: number;
}

/** Najwięcej wpisów powiadamianych o jednym zwolnionym terminie (najstarsze pierwsze). */
export const WAITING_LIST_NOTIFY_LIMIT = 5;

/** Godziny ciszy SMS w strefie SMS_TIME_ZONE: od 21:00 (włącznie) do 8:00 (wyłącznie). */
const SMS_QUIET_FROM_HOUR = 21;
const SMS_QUIET_UNTIL_HOUR = 8;

/**
 * Czy chwila `now` wypada w godzinach ciszy SMS listy oczekujących: 21:00–8:00
 * czasu warszawskiego (SMS_TIME_ZONE), niezależnie od strefy procesu.
 * Nieprawidłowa data = cisza (SMS nie wychodzi). Formatter tworzony przy
 * każdym wywołaniu, więc wynik nie zależy od strefy procesu z chwili importu.
 */
export function isWaitingListSmsQuietTime(now: Date): boolean {
  if (Number.isNaN(now.getTime())) return true;
  const hourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour");
  const hour = Number(hourPart?.value);
  if (!Number.isInteger(hour)) return true;
  return hour >= SMS_QUIET_FROM_HOUR || hour < SMS_QUIET_UNTIL_HOUR;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/**
 * Telefon salonu do treści SMS: odczyt tabeli salonów przez bramę salonu,
 * z warunkiem tego salonu. Błąd odczytu = brak telefonu (SMS bez fragmentu
 * z telefonem), nie błąd przebiegu.
 */
async function readSalonPhone(gate: SalonGate, salonId: string): Promise<string | null> {
  try {
    const [salon] = await gate.raw((tx) =>
      tx
        .select({ phone: salons.phone })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1)
    );
    return salon?.phone ?? null;
  } catch (err) {
    logger.warn("Waiting list: salon phone read failed", { errorName: errorName(err) });
    return null;
  }
}

/** Wpis listy oczekujących z klientem (wynik odczytu wpisów). */
interface EntryRow {
  entry: typeof waitingList.$inferSelect;
  client: typeof clients.$inferSelect;
}

/** Wspólne dane jednego przebiegu: zwolniony termin, gotowe treści, wynik. */
interface SlotOffer {
  gate: SalonGate;
  salonId: string;
  params: NotifyWaitingListParams;
  /** Odczyt zegara przebiegu (termin w przyszłości, godziny ciszy, powiązana wizyta). */
  now: Date;
  /** Treść SMS; null = SMS w tym przebiegu nie wychodzi (godziny ciszy). */
  smsMessage: string | null;
  push: WaitingListPushContent;
  /** Konto klienta po e-mailu: jeden odczyt na e-mail w przebiegu. */
  linkedUserIdByEmail: Map<string, string | null>;
  result: NotifyWaitingListResult;
}

/**
 * Kanały wysyłki jednego wpisu, ustalone przed zajęciem wpisu. Oba puste =
 * wpis pomijany bez zapisu.
 */
interface EntryChannels {
  /** Numer klienta do SMS; null = SMS dla tego wpisu nie jest podejmowany. */
  smsTo: string | null;
  /** Konto klienta do push; null = push dla tego wpisu nie jest podejmowany. */
  linkedUserId: string | null;
}

/**
 * Kanały wpisu przed zajęciem: SMS tylko poza godzinami ciszy i na numer,
 * który `sendSms` wysyła (numer testowy rozpoznany tą samą regułą co
 * w `sendSms` — bez SMS); push tylko na konto ze zweryfikowanym e-mailem
 * klienta. Błąd odczytu konta = brak push, nie błąd przebiegu.
 */
async function resolveEntryChannels(row: EntryRow, offer: SlotOffer): Promise<EntryChannels> {
  const entryId = row.entry.id;

  let smsTo: string | null = null;
  if (row.client.phone && isTestPhoneNumber(row.client.phone)) {
    // Numer testowy: SMS celowo nie wychodzi — nie błąd i nie oferta.
    logger.debug("Waiting list SMS skipped: test phone number", { entryId });
  } else if (row.client.phone && offer.smsMessage !== null) {
    smsTo = row.client.phone;
  }

  let linkedUserId: string | null = null;
  if (row.client.email) {
    const email = row.client.email;
    try {
      const cached = offer.linkedUserIdByEmail.get(email);
      if (cached === undefined) {
        linkedUserId = await findVerifiedLinkedUserId(offer.gate, email);
        offer.linkedUserIdByEmail.set(email, linkedUserId);
      } else {
        linkedUserId = cached;
      }
    } catch (err) {
      logger.warn("Waiting list account lookup failed", { entryId, errorName: errorName(err) });
    }
  }

  return { smsTo, linkedUserId };
}

/**
 * Wysyłka oferty do jednego, zajętego wpisu: SMS na numer klienta i push na
 * konto klienta — tylko kanały ustalone przed zajęciem. Zwraca true, gdy co
 * najmniej jedna wiadomość została przyjęta (SMS `success` albo push
 * `success`). Nieudana wysyłka nie jest błędem przebiegu (`errors` bez zmian).
 */
async function deliverOffer(row: EntryRow, offer: SlotOffer, channels: EntryChannels): Promise<boolean> {
  const { result, salonId } = offer;
  const entryId = row.entry.id;
  let delivered = false;

  // SMS na numer klienta wpisu; treść wyłącznie z buildWaitingListSms.
  if (channels.smsTo !== null && offer.smsMessage !== null) {
    try {
      const sms = await sendSms({
        to: channels.smsTo,
        message: offer.smsMessage,
        salonId,
        clientId: row.client.id,
      });
      if (sms.success) {
        result.smsCount++;
        delivered = true;
      } else if (sms.skipped === "test_phone") {
        // Numer testowy rozpoznany dopiero przez sendSms: SMS celowo nie
        // wyszedł — nie błąd i nie oferta (bez innego kanału wpis zostanie
        // zwolniony).
        logger.debug("Waiting list SMS skipped: test phone number", { entryId });
      } else {
        logger.warn("Waiting list SMS not accepted", { entryId, errorName: "SmsNotAccepted" });
      }
    } catch (err) {
      logger.warn("Waiting list SMS failed", { entryId, errorName: errorName(err) });
    }
  }

  // Push na konto klienta (findVerifiedLinkedUserId: tylko zweryfikowany e-mail).
  if (channels.linkedUserId) {
    try {
      const pushResult = await sendPushNotification(channels.linkedUserId, {
        title: offer.push.title,
        body: offer.push.body,
        tag: `waiting-list-${entryId}`,
        data: {
          type: "waiting_list_notification",
          waitingListId: entryId,
          salonId,
          url: "/client/waiting-list",
        },
        salonId,
        clientId: row.client.id,
      });
      if (pushResult.success) {
        result.pushCount++;
        delivered = true;
      }
    } catch (err) {
      // Nieudany push nie jest błędem przebiegu.
      logger.warn("Waiting list push notification failed", { entryId, errorName: errorName(err) });
    }
  }

  return delivered;
}

/**
 * Warunek wizyty, którą oferta może przenieść: zaplanowana albo potwierdzona,
 * ze startem później niż proponowany termin i później niż `now`. Ten sam
 * warunek wybiera wizytę do powiązania i stoi w samym zapisie przeniesienia.
 */
function movableAppointmentWhere(offeredStart: Date, now: Date) {
  return and(
    or(eq(appointments.status, "scheduled"), eq(appointments.status, "confirmed")),
    gt(appointments.startTime, offeredStart),
    gt(appointments.startTime, now)
  );
}

/**
 * Wizyta klienta na tę samą usługę w tym salonie, którą oferta może przenieść
 * (`movableAppointmentWhere`); przy kilku — najwcześniejsza.
 */
async function findExistingAppointmentId(row: EntryRow, offer: SlotOffer): Promise<string | null> {
  const { gate, salonId, params } = offer;
  if (!params.serviceId || !row.client.id) return null;
  const clientId = row.client.id;
  const serviceId = params.serviceId;
  const existingAppts = await gate.raw((tx) =>
    tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          eq(appointments.salonId, salonId),
          eq(appointments.serviceId, serviceId),
          movableAppointmentWhere(params.startTime, offer.now)
        )
      )
      .orderBy(asc(appointments.startTime))
      .limit(1)
  );
  return existingAppts[0]?.id ?? null;
}

/**
 * Zajęcie wpisu jednym warunkowym zapisem: pola oferty i nowy token tylko,
 * gdy wpis tego salonu jest nadal niepowiadomiony i nierozstrzygnięty.
 * true = ten przebieg zajął wpis; false = wpis obsłużyło inne wywołanie albo
 * został rozstrzygnięty.
 */
async function claimEntry(
  row: EntryRow,
  offer: SlotOffer,
  existingApptId: string | null,
  acceptToken: string
): Promise<boolean> {
  const { gate, salonId, params } = offer;
  const entryId = row.entry.id;
  const claimed = await gate.raw((tx) =>
    tx
      .update(waitingList)
      .set({
        notifiedAt: new Date(),
        offeredStartTime: params.startTime,
        offeredEndTime: params.endTime,
        offeredEmployeeId: params.employeeId,
        existingAppointmentId: existingApptId,
        acceptToken,
      })
      .where(
        and(
          eq(waitingList.id, entryId),
          eq(waitingList.salonId, salonId),
          isNull(waitingList.notifiedAt),
          isNull(waitingList.accepted)
        )
      )
      .returning({ id: waitingList.id })
  );
  return claimed.length > 0;
}

/**
 * Zwolnienie zajętego wpisu po nieudanej wysyłce: czyści pola oferty tylko,
 * gdy wpis ma nadal token z tego zajęcia i nie został rozstrzygnięty.
 * true = wpis wrócił do puli; false = wpis rozstrzygnięty albo zmieniony
 * w trakcie wysyłki (zostaje bez zmian).
 */
async function releaseEntry(row: EntryRow, offer: SlotOffer, acceptToken: string): Promise<boolean> {
  const { gate, salonId } = offer;
  const entryId = row.entry.id;
  const released = await gate.raw((tx) =>
    tx
      .update(waitingList)
      .set({
        notifiedAt: null,
        offeredStartTime: null,
        offeredEndTime: null,
        offeredEmployeeId: null,
        existingAppointmentId: null,
        acceptToken: null,
      })
      .where(
        and(
          eq(waitingList.id, entryId),
          eq(waitingList.salonId, salonId),
          eq(waitingList.acceptToken, acceptToken),
          isNull(waitingList.accepted)
        )
      )
      .returning({ id: waitingList.id })
  );
  return released.length > 0;
}

/** Wynik obsługi jednego wpisu (log `{ entryId, outcome }`). */
type EntryOutcome =
  | "no_channel"
  | "claim_failed"
  | "claimed_elsewhere"
  | "delivered"
  | "released"
  | "settled_in_window"
  | "release_failed";

/**
 * Jeden wpis: kanały i powiązana wizyta ustalone przed zapisem; bez kanału —
 * wpis pominięty bez zapisu. Potem zajęcie wpisu, wysyłka i — gdy żadna
 * wiadomość nie została przyjęta — warunkowe zwolnienie.
 */
async function offerSlotToEntry(row: EntryRow, offer: SlotOffer): Promise<EntryOutcome> {
  const { result } = offer;
  const entryId = row.entry.id;

  const channels = await resolveEntryChannels(row, offer);
  if (channels.smsTo === null && channels.linkedUserId === null) return "no_channel";

  const acceptToken = crypto.randomBytes(32).toString("hex");
  let claimed: boolean;
  try {
    const existingApptId = await findExistingAppointmentId(row, offer);
    claimed = await claimEntry(row, offer, existingApptId, acceptToken);
  } catch (err) {
    // Błąd bazy przed wysyłką: wiadomość nie wychodzi, wpis zostaje oczekujący.
    logger.error("Waiting list entry claim failed", { entryId, errorName: errorName(err) });
    result.errors++;
    return "claim_failed";
  }
  if (!claimed) {
    logger.debug("Waiting list entry already claimed or settled", { entryId });
    return "claimed_elsewhere";
  }
  logger.info("Waiting list entry claimed", { entryId });

  const delivered = await deliverOffer(row, offer, channels);
  if (delivered) {
    result.notified++;
    return "delivered";
  }

  try {
    const released = await releaseEntry(row, offer, acceptToken);
    if (!released) {
      logger.info("Waiting list entry settled during delivery; not released", { entryId });
      return "settled_in_window";
    }
    return "released";
  } catch (err) {
    // Wpis zostaje zajęty bez przyjętej wiadomości — jedyny stan alarmowy.
    logger.error("Waiting list entry release failed", { entryId, errorName: errorName(err) });
    result.errors++;
    return "release_failed";
  }
}

/**
 * Powiadomienie wpisów listy oczekujących o zwolnionym terminie (wołane przy
 * odwołaniu wizyty).
 *
 * Termin nieprawidłowy albo nie w przyszłości = wynik zerowy, bez odczytu
 * wpisów i bez wysyłki. Moduł listy oczekujących wyłączony w salonie (albo
 * błąd odczytu ustawień) = brak odczytu wpisów i brak wysyłki.
 *
 * Wpisy: ten salon, potwierdzona prośba klienta, jeszcze nie powiadomione
 * i nierozstrzygnięte, ta sama usługa/pracownik albo bez preferencji;
 * najwyżej WAITING_LIST_NOTIFY_LIMIT najstarszych.
 *
 * Kanały: SMS na numer klienta wpisu (treść z `buildWaitingListSms`, telefon
 * salonu z bazy), poza godzinami ciszy 21:00–8:00 czasu SMS_TIME_ZONE i nie
 * na numer testowy; push na konto klienta ze zweryfikowanym e-mailem (treść
 * z `buildWaitingListPush`). Kanały są ustalane przed jakimkolwiek zapisem;
 * wpis bez kanału jest pomijany bez zapisu.
 *
 * Każdy wpis po kolei: zajęcie (`notifiedAt`, `acceptToken`, `offered*`
 * jednym warunkowym zapisem, tylko gdy wpis jest nadal niepowiadomiony
 * i nierozstrzygnięty), wysyłka, a gdy żadna wiadomość nie została przyjęta —
 * zwolnienie (pola oferty z powrotem puste, tylko gdy wpis ma nadal token
 * z tego zajęcia i nie został rozstrzygnięty). W trakcie wysyłki wpis jest
 * zajęty: inne wywołanie go nie wybierze, a oferta jest już widoczna w portalu
 * klienta. Stan końcowy: wpis oznaczony ⇔ wiadomość przyjęta (SMS albo push
 * `success`) albo wpis rozstrzygnięty w trakcie wysyłki. Zwolniony wpis wraca
 * przy następnym zwolnionym terminie, bez błędu w wyniku.
 *
 * `errors`: błąd bazy przy zajęciu (wiadomość nie wychodzi) albo przy
 * zwolnieniu (wpis zostaje zajęty bez przyjętej wiadomości).
 */
export async function notifyWaitingList(
  params: NotifyWaitingListParams
): Promise<NotifyWaitingListResult> {
  const result: NotifyWaitingListResult = {
    notified: 0,
    smsCount: 0,
    pushCount: 0,
    errors: 0,
  };

  // Jedno źródło salonu, jak w accept/decline: każde zapytanie poniżej ma
  // jawny warunek salonu (kontrakt raw() w repository.ts).
  const salonId = params.salonId;

  // Jeden odczyt zegara w przebiegu: termin w przyszłości i godziny ciszy SMS.
  const now = new Date();
  const startMs = params.startTime instanceof Date ? params.startTime.getTime() : Number.NaN;
  if (!Number.isFinite(startMs) || startMs <= now.getTime()) {
    logger.debug("Freed slot is not in the future; waiting list not notified", { salonId });
    return result;
  }

  try {
    // Przełącznik modułu salonu przed jakimkolwiek odczytem wpisów. Błąd
    // odczytu ustawień daje stan domyślny, w którym moduł jest wyłączony.
    const modules = await getSalonModules(salonId);
    if (!modules.waitingList) {
      logger.debug("Waiting list module disabled for salon", { salonId });
      return result;
    }

    const gate = forSalon(salonId);

    // Build conditions for matching waiting list entries:
    // - Same salon (required)
    // - Wpis z potwierdzoną prośbą klienta (clientRequestConfirmedAt is not null);
    //   wpis bez potwierdzenia nie jest powiadamiany, oznaczany ani liczony
    // - Not already notified (notifiedAt is null)
    // - Not already accepted or declined (accepted is null)
    // - Same service OR no service preference
    // - Same preferred employee OR no employee preference
    const serviceCondition = params.serviceId
      ? or(
          eq(waitingList.serviceId, params.serviceId),
          isNull(waitingList.serviceId)
        )
      : isNull(waitingList.serviceId);

    const employeeCondition = params.employeeId
      ? or(
          eq(waitingList.preferredEmployeeId, params.employeeId),
          isNull(waitingList.preferredEmployeeId)
        )
      : isNull(waitingList.preferredEmployeeId);

    const entries = await gate.raw((tx) =>
      tx
        .select({
          entry: waitingList,
          client: clients,
        })
        .from(waitingList)
        .innerJoin(
          clients,
          and(eq(waitingList.clientId, clients.id), eq(clients.salonId, salonId))
        )
        .where(
          and(
            eq(waitingList.salonId, salonId),
            isNotNull(waitingList.clientRequestConfirmedAt),
            isNull(waitingList.notifiedAt),
            isNull(waitingList.accepted),
            serviceCondition,
            employeeCondition
          )
        )
        .orderBy(asc(waitingList.createdAt))
        .limit(WAITING_LIST_NOTIFY_LIMIT)
    );

    if (entries.length === 0) {
      logger.debug("No matching waiting list entries for freed slot", { salonId });
      return result;
    }

    logger.info("Found matching waiting list entries for freed slot", { count: entries.length, salonId });

    // Kanał SMS: poza godzinami ciszy i tylko gdy któryś wpis ma numer
    // telefonu inny niż testowy. Telefon salonu — najwyżej jeden odczyt
    // w przebiegu.
    const smsQuiet = isWaitingListSmsQuietTime(now);
    if (smsQuiet) {
      logger.debug("Waiting list SMS quiet hours; SMS not sent", { salonId });
    }
    let smsMessage: string | null = null;
    if (!smsQuiet && entries.some((row) => row.client.phone && !isTestPhoneNumber(row.client.phone))) {
      const salonPhone = await readSalonPhone(gate, salonId);
      smsMessage = buildWaitingListSms({
        salonName: params.salonName,
        serviceName: params.serviceName,
        startTime: params.startTime,
        salonPhone,
      });
    }

    const offer: SlotOffer = {
      gate,
      salonId,
      params,
      now,
      smsMessage,
      push: buildWaitingListPush({
        salonName: params.salonName,
        serviceName: params.serviceName,
        startTime: params.startTime,
      }),
      // Mapa żyje tylko w pamięci tego wywołania — następny zwolniony termin
      // czyta konto od nowa (konto założone później też dostanie powiadomienie).
      linkedUserIdByEmail: new Map<string, string | null>(),
      result,
    };

    // Zajęcie bezpośrednio przed wysyłką danego wpisu, nie hurtem na starcie.
    for (const row of entries) {
      const outcome = await offerSlotToEntry(row, offer);
      logger.info("Waiting list entry outcome", { entryId: row.entry.id, outcome });
    }

    logger.info("Waiting list notification complete", {
      notified: result.notified,
      smsCount: result.smsCount,
      pushCount: result.pushCount,
      errors: result.errors,
    });
  } catch (error) {
    logger.error("Failed to notify waiting list", {
      errorName: errorName(error),
    });
    result.errors++;
  }

  return result;
}

// ─── Accept earlier slot ─────────────────────────────────────────────────────

interface AcceptResult {
  success: boolean;
  message: string;
  appointmentId?: string;
  oldStartTime?: Date;
  newStartTime?: Date;
}

/**
 * Accept an offered earlier slot from the waiting list.
 *
 * Validates the accept token, checks slot availability, then either moves
 * the client's existing appointment to the earlier time or creates a new
 * appointment. Marks the waiting list entry as accepted and logs a
 * confirmation notification.
 *
 * Powiązana wizyta, która istnieje, nie jest odwołana i nie spełnia warunku
 * przeniesienia = odmowa „Oferta nie jest już aktualna”, bez zapisu.
 *
 * Moduł listy oczekujących wyłączony w salonie (albo błąd odczytu ustawień)
 * = odmowa „Oferta nie jest już aktualna”, bez odczytu wpisu i bez zapisów.
 */
export async function acceptEarlierSlot(
  waitingListId: string,
  acceptToken: string
): Promise<AcceptResult> {
  // 0. Salon wyłącznie z tokenu (#193 P5a-1). Token nieznany albo wskazujący
  // inny wpis = odmowa, nic nie odczytane w salonie i nic nie zapisane.
  const target = await resolveWaitingListToken(acceptToken);
  if (!target || target.waitingListId !== waitingListId) {
    return { success: false, message: "Nieprawidlowy token akceptacji" };
  }
  // Jedno źródło salonu: wynik tokenu. Każde zapytanie poniżej ma jawny
  // warunek salonu (kontrakt raw() w repository.ts), wartości insertów też.
  const salonId = target.salonId;

  // Przełącznik modułu listy oczekujących (ta sama reguła co przy wysyłce):
  // moduł wyłączony albo błąd odczytu ustawień = odmowa przed odczytem wpisu
  // i przed jakimkolwiek zapisem. Oferta zostaje nietknięta.
  const modules = await getSalonModules(salonId);
  if (!modules.waitingList) {
    return { success: false, message: "Oferta nie jest już aktualna" };
  }

  const gate = forSalon(salonId);

  // 1. Fetch the waiting list entry
  const [entry] = await gate.raw((tx) =>
    tx
      .select()
      .from(waitingList)
      .where(and(eq(waitingList.id, waitingListId), eq(waitingList.salonId, salonId)))
      .limit(1)
  );

  if (!entry) {
    return { success: false, message: "Wpis nie zostal znaleziony" };
  }

  // 2. Verify token
  if (entry.acceptToken !== acceptToken) {
    return { success: false, message: "Nieprawidlowy token akceptacji" };
  }

  // 3. Check not already handled
  if (entry.accepted !== null) {
    const prev = entry.accepted ? "zaakceptowany" : "odrzucony";
    return {
      success: false,
      message: `Ten wpis zostal juz ${prev}`,
    };
  }

  // 4. Verify offered slot details exist
  if (!entry.offeredStartTime || !entry.offeredEndTime) {
    return {
      success: false,
      message: "Brak danych o proponowanym terminie",
    };
  }

  const offeredStart = new Date(entry.offeredStartTime);
  const offeredEnd = new Date(entry.offeredEndTime);
  // #168 pkt 4 (decyzja Olivera, wariant A): oferta dotyczy terminu zwolnionego
  // u KONKRETNEGO pracownika (notifyWaitingList zapisuje go razem z tokenem).
  // Puste offeredEmployeeId = pracownik usunięty po wysłaniu oferty (FK ON
  // DELETE SET NULL) — oferta nieważna: odmowa, nic nie zapisane, wpis bez
  // zmian. Bez przejścia na preferredEmployeeId (ta osoba mogła w tym czasie
  // nie pracować) i bez przesuwania wizyty bez sprawdzenia kolizji.
  if (!entry.offeredEmployeeId) {
    return { success: false, message: "Proponowany termin nie jest juz dostepny" };
  }
  const employeeId = entry.offeredEmployeeId;

  // Przedział pusty/odwrócony nie trafiłby w warunek kolizji (#165) — odmowa,
  // nic nie zapisane, wpis bez zmian.
  if (!(offeredEnd.getTime() > offeredStart.getTime())) {
    return { success: false, message: "Nieprawidlowy proponowany termin" };
  }

  // 5. Check that the offered slot is still in the future. Ten sam odczyt
  // zegara stoi w warunku przeniesienia powiązanej wizyty (krok 7).
  const now = new Date();
  if (offeredStart <= now) {
    return {
      success: false,
      message: "Proponowany termin juz minal",
    };
  }

  // 6. Termin musi być nadal wolny (#165): ta sama definicja kolizji co przy
  // zapisie wizyty, półotwarta [start, end). Przenoszona wizyta klienta nie
  // koliduje sama ze sobą. Przy kolizji nic nie zapisujemy — wpis zostaje
  // nierozstrzygnięty (accepted = null).
  const overlapping = await gate.raw((tx) =>
    tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        appointmentConflictWhere({
          salonId,
          employeeId,
          start: offeredStart,
          end: offeredEnd,
          excludeId: entry.existingAppointmentId,
        })
      )
      .limit(1)
  );

  if (overlapping.length > 0) {
    return { success: false, message: "Termin jest juz zajety" };
  }

  let appointmentId: string;
  let oldStartTime: Date | undefined;

  // #63: NOWA wizyta z listy oczekujących podlega tej samej regule co
  // /api/appointments — usługa z deposit_required / klient z require_deposit
  // (po clientId wpisu, ustawionym przez salon) nie powstaje bez wpłaty.
  // Wpis zostaje nierozstrzygnięty, klient może zarezerwować termin w portalu
  // z zadatkiem. Przeniesienie istniejącej wizyty nie tworzy nowej rezerwacji.
  const depositBlocksNewAppointment = async (): Promise<AcceptResult | null> => {
    if (!entry.serviceId) return null; // bez usługi nie ma zadatku
    const verdict = await checkBookingWithoutDeposit({
      salonId,
      serviceId: entry.serviceId,
      startTime: offeredStart,
      clientId: entry.clientId,
    });
    if (verdict.allowed) return null;
    const message =
      verdict.reason === "unavailable"
        ? DEPOSIT_CHECK_UNAVAILABLE_MESSAGE
        : verdict.reason === "not_found"
          ? "Usługa z tego wpisu nie jest już dostępna"
          : DEPOSIT_REQUIRED_MESSAGE;
    return { success: false, message };
  };

  // 7. Move existing appointment or create a new one
  // #171: każdy zapis poniżej to jedno polecenie; jeśli równoległy zapis
  // zajął termin po kroku 6, EXCLUDE w bazie odrzuca je (23P01, albo 40P01
  // przy sprawdzaniu ograniczenia) — odmowa jak
  // przy kolizji, nic nie zapisane, wpis nierozstrzygnięty.
  const insertNewAppointment = async (): Promise<string> => {
    const [newAppt] = await gate.raw((tx) =>
      tx
        .insert(appointments)
        .values({
          salonId,
          clientId: entry.clientId,
          employeeId,
          serviceId: entry.serviceId,
          startTime: offeredStart,
          endTime: offeredEnd,
          status: "scheduled",
          notes: "Utworzony z listy oczekujacych",
        })
        .returning()
    );
    return newAppt!.id;
  };

  // Powiązana wizyta: odczyt (stan, stary termin, notatki) w tym salonie.
  const readLinkedAppointment = async (existingId: string) => {
    const [row] = await gate.raw((tx) =>
      tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, existingId), eq(appointments.salonId, salonId)))
        .limit(1)
    );
    return row;
  };

  try {
    if (entry.existingAppointmentId) {
      // Powiązana wizyta: przeniesienie jednym warunkowym zapisem (warunek
      // `movableAppointmentWhere`). Wizyty brak albo odwołana → nowa wizyta.
      // Wizyta żywa, której zapis nie objął (zakończona, bez stawienia się,
      // start nie później niż oferta) → odmowa: bez nowej wizyty obok niej
      // i bez oznaczenia wpisu.
      const existingId = entry.existingAppointmentId;
      const existingAppt = await readLinkedAppointment(existingId);

      if (existingAppt && existingAppt.status !== "cancelled") {
        const moved = await gate.raw((tx) =>
          tx
            .update(appointments)
            .set({
              startTime: offeredStart,
              endTime: offeredEnd,
              employeeId,
              notes: `${existingAppt.notes || ""} [Przeniesiony z listy oczekujacych]`.trim(),
            })
            .where(
              and(
                eq(appointments.id, existingId),
                eq(appointments.salonId, salonId),
                movableAppointmentWhere(offeredStart, now)
              )
            )
            .returning({ id: appointments.id })
        );

        if (moved.length > 0) {
          oldStartTime = new Date(existingAppt.startTime);
          appointmentId = existingId;
          logger.info("Moved appointment from waiting list", {
            appointmentId,
            from: oldStartTime.toISOString(),
            to: offeredStart.toISOString(),
          });
        } else {
          // Zapis nie objął wizyty: stan po odczycie rozstrzyga ścieżkę.
          const current = await readLinkedAppointment(existingId);
          if (current && current.status !== "cancelled") {
            logger.info("Waiting list offer refused: linked appointment not movable", {
              waitingListId,
              appointmentId: existingId,
            });
            return { success: false, message: "Oferta nie jest już aktualna" };
          }
          const blocked = await depositBlocksNewAppointment();
          if (blocked) return blocked;
          appointmentId = await insertNewAppointment();
        }
      } else {
        // Existing appointment was cancelled or missing – create new
        const blocked = await depositBlocksNewAppointment();
        if (blocked) return blocked;
        appointmentId = await insertNewAppointment();
      }
    } else {
      // No existing appointment – create new
      const blocked = await depositBlocksNewAppointment();
      if (blocked) return blocked;
      appointmentId = await insertNewAppointment();
    }
  } catch (error) {
    if (isAppointmentSlotTaken(error)) {
      return { success: false, message: "Termin jest juz zajety" };
    }
    logger.error("acceptEarlierSlot: zapis wizyty odrzucony przez baze", {
      waitingListId,
      code: dbErrorCode(error),
    });
    throw error;
  }

  // 8. Mark waiting list entry as accepted
  await gate.raw((tx) =>
    tx
      .update(waitingList)
      .set({ accepted: true })
      .where(and(eq(waitingList.id, waitingListId), eq(waitingList.salonId, salonId)))
  );

  // 9. Wpis systemowy w historii powiadomień salonu (żaden SMS tu nie wychodzi);
  // treść mówi o przeniesieniu tylko po przeniesieniu.
  try {
    const outcome = oldStartTime !== undefined ? "przeniesiona" : "zarezerwowana";
    await gate.raw((tx) =>
      tx.insert(notifications).values({
        salonId,
        clientId: entry.clientId,
        type: "system",
        message: `Klient zaakceptowal wczesniejszy termin z listy oczekujacych. Wizyta ${appointmentId} ${outcome} na ${offeredStart.toLocaleString("pl-PL", { timeZone: SMS_TIME_ZONE })}.`,
        status: "sent",
        sentAt: new Date(),
      })
    );
  } catch (notifErr) {
    logger.error("Failed to create waiting list confirmation notification", { error: notifErr });
  }

  return {
    success: true,
    message:
      oldStartTime !== undefined
        ? "Termin zostal zaakceptowany! Wizyta zostala przeniesiona."
        : "Termin zostal zaakceptowany! Wizyta zostala zarezerwowana.",
    appointmentId,
    ...(oldStartTime !== undefined ? { oldStartTime } : {}),
    newStartTime: offeredStart,
  };
}

// ─── Decline earlier slot ────────────────────────────────────────────────────

interface DeclineResult {
  success: boolean;
  message: string;
}

/**
 * Decline an offered earlier slot from the waiting list.
 *
 * Bez przełącznika modułu: odrzucenie nie tworzy wizyty, tylko zamyka wpis,
 * więc działa także przy wyłączonym module listy oczekujących.
 */
export async function declineEarlierSlot(
  waitingListId: string,
  acceptToken: string
): Promise<DeclineResult> {
  // Salon wyłącznie z tokenu (#193 P5a-1), jak w acceptEarlierSlot.
  const target = await resolveWaitingListToken(acceptToken);
  if (!target || target.waitingListId !== waitingListId) {
    return { success: false, message: "Nieprawidlowy token" };
  }
  const salonId = target.salonId;
  const gate = forSalon(salonId);

  const [entry] = await gate.raw((tx) =>
    tx
      .select()
      .from(waitingList)
      .where(and(eq(waitingList.id, waitingListId), eq(waitingList.salonId, salonId)))
      .limit(1)
  );

  if (!entry) {
    return { success: false, message: "Wpis nie zostal znaleziony" };
  }

  if (entry.acceptToken !== acceptToken) {
    return { success: false, message: "Nieprawidlowy token" };
  }

  if (entry.accepted !== null) {
    const prev = entry.accepted ? "zaakceptowany" : "odrzucony";
    return {
      success: false,
      message: `Ten wpis zostal juz ${prev}`,
    };
  }

  await gate.raw((tx) =>
    tx
      .update(waitingList)
      .set({ accepted: false })
      .where(and(eq(waitingList.id, waitingListId), eq(waitingList.salonId, salonId)))
  );

  return {
    success: true,
    message: "Termin zostal odrzucony.",
  };
}
