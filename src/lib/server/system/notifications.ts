/**
 * Wyjścia systemowe powiadomień.
 *
 * - #193 P5a-1: subskrypcje push użytkownika po stronie wysyłki. Subskrypcja
 *   należy do użytkownika, nie do salonu, więc nie idzie przez `forSalon`.
 *   Strona użytkownika (subscribe/unsubscribe) to osobna partia.
 * - #193 P5a-2: crony przypomnień (push 1h, push 24h, SMS 1h). Działają na
 *   wszystkich salonach (sekret crona, bez sesji): wybór wizyt w oknie czasu,
 *   oznaczenie flagi „wysłane” po id z wyboru, podgląd stanu. Zapytania 1:1
 *   z dawnych tras; wysyłka zostaje w trasie, poza tym modułem.
 * - #193 P5a-2: przypomnienia SMS 24h (`reminders/appointment`, sekret crona,
 *   opcjonalny filtr salonu wołającego): wybór i oznaczenie. Podgląd jednego
 *   salonu czyta trasa przez `forSalon`.
 * - Każde złączenie wyboru przypomnień (klient, pracownik, usługa) ma warunek
 *   `<tabela>.salon_id = appointments.salon_id`; salon jest złączony po
 *   `appointments.salon_id`. Wizyty odsiane tym warunkiem są zliczane raz na
 *   przebieg i logowane jako liczba (`warnSkippedOutsideSalon`).
 *
 * Każda nowa funkcja tutaj zmienia migawkę `system/` (R-Z1) i migawkę
 * importerów L7, więc jest widoczna w diffie i w recenzji.
 */
import { and, count, eq, gte, inArray, isNull, lte, ne, not, or, type SQL } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { appointments, clients, employees, pushSubscriptions, salons, services } from "@/lib/schema";
import { dbSystem } from "./db-system";

/** Subskrypcja w kształcie potrzebnym do wysyłki (bez innych kolumn). */
export type PushSubscriptionForSend = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Subskrypcje push użytkownika — tylko kolumny potrzebne do wysyłki. */
export async function getPushSubscriptionsForUser(userId: string): Promise<PushSubscriptionForSend[]> {
  return dbSystem
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/**
 * Kasuje subskrypcje użytkownika o podanych id: `WHERE user_id = $1 AND id IN (...)`.
 *
 * Kontrakt: wyjście NIE ocenia, czy wiersz jest wadliwy — decyduje wywołujący
 * (`src/lib/push.ts`: wiersz spoza allowlisty usług push albo odrzucony przez
 * dostawcę jako 404/410). Id cudzego użytkownika na liście nie jest kasowane.
 * Pusta lista = no-op bez zapytania (nigdy „wszystkie subskrypcje użytkownika”).
 *
 * @returns liczba skasowanych wierszy
 */
export async function deleteUndeliverablePushSubscriptions(
  userId: string,
  subscriptionIds: string[]
): Promise<number> {
  if (subscriptionIds.length === 0) return 0;

  const deleted = await dbSystem
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), inArray(pushSubscriptions.id, subscriptionIds)))
    .returning({ id: pushSubscriptions.id });

  return deleted.length;
}

// ------------------------------------------------------------ crony przypomnień (P5a-2)

/** Rodzaj przypomnienia crona = flaga „wysłane” na wizycie. */
export type CronReminderKind = "push1h" | "push24h" | "sms1h";

/** Okno startu wizyty, w którym cron wysyła przypomnienie. */
export type ReminderWindow = { from: Date; to: Date };

/** Kolumna flagi „wysłane” dla rodzaju przypomnienia (bez zmiany względem dawnych tras). */
function sentFlag(kind: CronReminderKind) {
  switch (kind) {
    case "push1h":
      return appointments.reminderPush1hSentAt;
    case "push24h":
      return appointments.reminderPushSentAt;
    case "sms1h":
      return appointments.reminder1hSentAt;
  }
}

/** Warunek wyboru: start w oknie, wizyta aktywna, przypomnienie jeszcze nie wysłane. */
function dueCondition(kind: CronReminderKind, window: ReminderWindow) {
  return and(
    gte(appointments.startTime, window.from),
    lte(appointments.startTime, window.to),
    not(inArray(appointments.status, ["cancelled", "completed", "no_show"])),
    isNull(sentFlag(kind))
  );
}

/** Rodzaj przypomnienia w logu pominiętych (crony + SMS 24h). */
type SkippedReminderKind = CronReminderKind | "sms24h";

/**
 * Log wizyt pominiętych przez warunek salonu w złączeniu: osobne zliczenie
 * wizyt spełniających ten sam warunek okna (`due`) co wybór i warunek
 * niezgodności (`mismatch`). Raz na przebieg, bez grupowania, jedna linia warn
 * tylko przy liczbie > 0; w treści wyłącznie rodzaj przypomnienia i liczba.
 *
 * Ta sama wizyta jest zgłaszana w każdym przebiegu, dopóki nie wyjdzie z okna
 * (flaga „wysłane” nie jest dla niej ustawiana) — to zamierzone.
 *
 * Wynik zliczenia jest sprawdzany jawnie: log idzie tylko, gdy to skończona
 * liczba całkowita > 0. Brak wiersza, `null`, tekst albo `NaN` → brak linii.
 */
async function warnSkippedOutsideSalon(
  kind: SkippedReminderKind,
  due: SQL | undefined,
  mismatch: SQL | undefined
): Promise<void> {
  const rows = await dbSystem
    .select({ n: count() })
    .from(appointments)
    .leftJoin(clients, eq(appointments.clientId, clients.id))
    .leftJoin(employees, eq(appointments.employeeId, employees.id))
    .where(and(due, mismatch));
  const n: unknown = rows[0]?.n;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) return;
  logger.warn("Przypomnienia pominięte: dane wizyty spoza jej salonu", { reminder: kind, skipped: n });
}

/** Klient albo pracownik wizyty z innego salonu niż wizyta (crony: złączenia wewnętrzne). */
const clientOrEmployeeOutsideSalon = () =>
  or(ne(clients.salonId, appointments.salonId), ne(employees.salonId, appointments.salonId));

/** Wizyta do przypomnienia push (kolumny jak w dawnych trasach push 1h / 24h). */
export type PushReminderCandidate = {
  appointmentId: string;
  appointmentStartTime: Date;
  salonId: string;
  salonName: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  bookedByUserId: string | null;
  employeeFirstName: string;
  employeeLastName: string;
  serviceName: string | null;
};

/** Wizyty w oknie bez wysłanego przypomnienia push danego rodzaju, najwyżej `limit`. */
export async function findDuePushReminders(
  kind: "push1h" | "push24h",
  window: ReminderWindow,
  limit: number
): Promise<PushReminderCandidate[]> {
  const rows = await dbSystem
    .select({
      appointmentId: appointments.id,
      appointmentStartTime: appointments.startTime,
      salonId: appointments.salonId,
      salonName: salons.name,
      clientId: clients.id,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      bookedByUserId: appointments.bookedByUserId,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.salonId, appointments.salonId)))
    .innerJoin(employees, and(eq(appointments.employeeId, employees.id), eq(employees.salonId, appointments.salonId)))
    .innerJoin(salons, eq(appointments.salonId, salons.id))
    .leftJoin(services, and(eq(appointments.serviceId, services.id), eq(services.salonId, appointments.salonId)))
    .where(dueCondition(kind, window))
    .limit(limit);
  await warnSkippedOutsideSalon(kind, dueCondition(kind, window), clientOrEmployeeOutsideSalon());
  return rows;
}

/** Wizyta do przypomnienia SMS 1h (kolumny jak w dawnej trasie sms-reminders). */
export type SmsReminderCandidate = {
  appointmentId: string;
  appointmentStartTime: Date;
  salonId: string;
  salonName: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  clientPhone: string | null;
  employeeFirstName: string;
  employeeLastName: string;
  serviceName: string | null;
};

/** Wizyty w oknie bez wysłanego przypomnienia SMS 1h, najwyżej `limit`. */
export async function findDueSmsReminders(window: ReminderWindow, limit: number): Promise<SmsReminderCandidate[]> {
  const rows = await dbSystem
    .select({
      appointmentId: appointments.id,
      appointmentStartTime: appointments.startTime,
      salonId: appointments.salonId,
      salonName: salons.name,
      clientId: clients.id,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      clientPhone: clients.phone,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.salonId, appointments.salonId)))
    .innerJoin(employees, and(eq(appointments.employeeId, employees.id), eq(employees.salonId, appointments.salonId)))
    .innerJoin(salons, eq(appointments.salonId, salons.id))
    .leftJoin(services, and(eq(appointments.serviceId, services.id), eq(services.salonId, appointments.salonId)))
    .where(dueCondition("sms1h", window))
    .limit(limit);
  await warnSkippedOutsideSalon("sms1h", dueCondition("sms1h", window), clientOrEmployeeOutsideSalon());
  return rows;
}

/**
 * Ustawia flagę „wysłane” danego rodzaju na wizytach o podanych id (z wyboru
 * tego samego przebiegu crona). Pusta lista = no-op bez zapytania.
 */
export async function markCronRemindersSent(kind: CronReminderKind, appointmentIds: string[]): Promise<void> {
  if (appointmentIds.length === 0) return;
  const now = new Date();
  const set =
    kind === "push1h"
      ? { reminderPush1hSentAt: now }
      : kind === "push24h"
        ? { reminderPushSentAt: now }
        : { reminder1hSentAt: now };
  await dbSystem.update(appointments).set(set).where(inArray(appointments.id, appointmentIds));
}

/** Którzy z podanych użytkowników mają choć jedną subskrypcję push. Pusta lista = [] bez zapytania. */
export async function getUserIdsWithPushSubscriptions(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await dbSystem
    .select({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
    .groupBy(pushSubscriptions.userId);
  return rows.map((row) => row.userId);
}

/** Wizyta oczekująca na przypomnienie (podgląd `?status=1`). */
export type PendingCronReminder = {
  appointmentId: string;
  startTime: Date;
  status: string;
  bookedByUserId: string | null;
};

/** Podgląd: wszystkie wizyty w oknie bez wysłanego przypomnienia danego rodzaju. */
export async function getPendingCronReminders(
  kind: CronReminderKind,
  window: ReminderWindow
): Promise<PendingCronReminder[]> {
  return dbSystem
    .select({
      appointmentId: appointments.id,
      startTime: appointments.startTime,
      status: appointments.status,
      bookedByUserId: appointments.bookedByUserId,
    })
    .from(appointments)
    .where(dueCondition(kind, window));
}

/** Podgląd: liczba wszystkich subskrypcji push (jak dawny odczyt id w trasach push). */
export async function countPushSubscriptions(): Promise<number> {
  const rows = await dbSystem.select({ id: pushSubscriptions.id }).from(pushSubscriptions);
  return rows.length;
}

// ------------------------------------------- przypomnienia SMS 24h (reminders/appointment, P5a-2)

/** Wizyta do przypomnienia SMS 24h (kolumny jak w dawnej trasie reminders/appointment). */
export type AppointmentReminderCandidate = {
  appointmentId: string;
  startTime: Date;
  endTime: Date;
  salonId: string;
  clientId: string | null;
  serviceId: string | null;
  employeeId: string;
  status: string;
  clientFirstName: string | null;
  clientLastName: string | null;
  clientPhone: string | null;
  salonName: string | null;
  serviceName: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
};

/**
 * Wizyty `scheduled`/`confirmed` startujące w oknie, bez wysłanego przypomnienia
 * SMS 24h. `salonId` (już zwalidowany UUID) zawęża do jednego salonu; `null` =
 * wszystkie salony (cron). Każde złączenie ma warunek salonu wizyty.
 */
export async function findDueAppointmentReminders(
  window: ReminderWindow,
  salonId: string | null
): Promise<AppointmentReminderCandidate[]> {
  const conditions = [
    gte(appointments.startTime, window.from),
    lte(appointments.startTime, window.to),
    isNull(appointments.reminderSentAt),
    inArray(appointments.status, ["scheduled", "confirmed"]),
  ];
  if (salonId !== null) conditions.push(eq(appointments.salonId, salonId));

  const rows = await dbSystem
    .select({
      appointmentId: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      salonId: appointments.salonId,
      clientId: appointments.clientId,
      serviceId: appointments.serviceId,
      employeeId: appointments.employeeId,
      status: appointments.status,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      clientPhone: clients.phone,
      salonName: salons.name,
      serviceName: services.name,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
    })
    .from(appointments)
    .leftJoin(clients, and(eq(appointments.clientId, clients.id), eq(clients.salonId, appointments.salonId)))
    .leftJoin(salons, eq(appointments.salonId, salons.id))
    .leftJoin(services, and(eq(appointments.serviceId, services.id), eq(services.salonId, appointments.salonId)))
    .leftJoin(employees, and(eq(appointments.employeeId, employees.id), eq(employees.salonId, appointments.salonId)))
    .where(and(...conditions));
  // Złączenia zewnętrzne: wiersz wizyty zostaje. Pominięta (bez telefonu) jest
  // tylko wizyta z klientem innego salonu; pracownik/usługa innego salonu dają
  // nazwy ogólne w treści, nie pominięcie — więc nie są liczone.
  await warnSkippedOutsideSalon("sms24h", and(...conditions), ne(clients.salonId, appointments.salonId));
  return rows;
}

/**
 * Ustawia `reminder_sent_at` na wizytach o podanych id (z wyboru tego samego
 * wywołania, po wysyłce). Pusta lista = no-op bez zapytania.
 */
export async function markAppointmentRemindersSent(appointmentIds: string[]): Promise<void> {
  if (appointmentIds.length === 0) return;
  await dbSystem
    .update(appointments)
    .set({ reminderSentAt: new Date() })
    .where(inArray(appointments.id, appointmentIds));
}

