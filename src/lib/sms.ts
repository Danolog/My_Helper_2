import { type HostingPlatform, hostingPlatform } from "@/lib/hosting";
import { logger } from "@/lib/logger";
import { maskPhoneNumber, normalizePolishPhoneNumber } from "@/lib/phone";
import { notifications } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isTestPhoneNumber } from "@/lib/test-phone";

export interface SmsMessage {
  to: string; // Phone number
  message: string;
  salonId: string;
  clientId?: string | undefined;
}

export interface SmsResult {
  success: boolean;
  notificationId?: string | undefined;
  error?: string | undefined;
  /**
   * Wysyłka świadomie pominięta (numer testowy) — nie błąd do ponawiania.
   * Wołający, który oznacza "wysłane" (przypomnienia), traktuje to jako
   * obsłużone, inaczej każdy przebieg brałby tę wizytę od nowa (#75).
   */
  skipped?: "test_phone" | undefined;
}

/**
 * Komunikat błędu wysyłki zwracany wołającemu (trafia m.in. do odpowiedzi
 * /api/reminders/appointment). Ogólny: szczegóły dostawcy i bazy idą tylko do
 * logu, przez `logger` (redakcja `safe-error`).
 */
export const SMS_SEND_FAILED_ERROR = "Nie udało się wysłać SMS.";

/** Wynik dla numeru z listy TEST_PHONE_NUMBERS — SMS celowo nie wychodzi. */
export const SMS_TEST_PHONE_ERROR = "SMS nie wysłany: numer testowy.";

/** Wynik na hostingu bez skonfigurowanego dostawcy SMS — wiadomość nie wychodzi. */
export const SMS_PROVIDER_UNAVAILABLE_ERROR = "Wysyłka SMS jest niedostępna.";

const SMSAPI_URL = "https://api.smsapi.pl/sms.do";
const DEFAULT_SENDER = "Info";

// Format E.164 i maskowanie żyją w czystym module (importuje go też schemat
// Zod); re-eksport zostaje dla dotychczasowych importów z "@/lib/sms".
export { normalizePolishPhoneNumber };

/** Shape of the (partial) SMSAPI.pl JSON response we care about. */
interface SmsapiResponse {
  error?: number | string;
  message?: string;
  count?: number;
  list?: Array<{ id?: string }>;
}

/**
 * Send a single SMS through the SMSAPI.pl REST API.
 * Throws on API errors (JSON body with an `error` field), non-2xx HTTP
 * statuses and network failures.
 */
async function sendViaSmsapi(
  token: string,
  to: string,
  message: string
): Promise<void> {
  const body = new URLSearchParams({
    format: "json",
    to,
    message,
    from: process.env.SMSAPI_SENDER || DEFAULT_SENDER,
    encoding: "utf-8",
  });

  const response = await fetch(SMSAPI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  let data: SmsapiResponse | null = null;
  try {
    data = (await response.json()) as SmsapiResponse;
  } catch {
    // Non-JSON response body - fall through to the HTTP status check
  }

  if (data?.error !== undefined && data.error !== null) {
    // Tylko kod błędu (#75, audyt bezpieczeństwa): `message` dostawcy bywa echem danych
    // wejściowych (numer, treść) i trafiałby do logów bez redakcji.
    // Kod przepuszczamy tylko, gdy jest liczbą — inaczej to też tekst dostawcy.
    const code = /^\d{1,6}$/.test(String(data.error)) ? String(data.error) : "unknown";
    throw new Error(`SMSAPI error: code ${code}`);
  }

  if (!response.ok) {
    throw new Error(`SMSAPI error: HTTP ${response.status}`);
  }

  logger.info("SMS sent via SMSAPI", {
    to: maskPhoneNumber(to),
    count: data?.count,
    messageId: data?.list?.[0]?.id,
  });
}

/**
 * Save an SMS notification to the notifications table (audit trail).
 * Returns the id of the created notification, if any.
 *
 * Zapis przez bramę salonu wiadomości (#193): własna, krótka transakcja —
 * wołający nie może trzymać otwartej transakcji `forSalon` w trakcie wysyłki.
 */
async function saveNotification(
  msg: SmsMessage,
  status: "sent" | "failed"
): Promise<string | undefined> {
  const [notification] = await forSalon(msg.salonId).raw((tx) =>
    tx
      .insert(notifications)
      .values({
        salonId: msg.salonId,
        clientId: msg.clientId || null,
        type: "sms",
        message: msg.message,
        status,
        ...(status === "sent" ? { sentAt: new Date() } : {}),
      })
      .returning()
  );

  return notification?.id;
}

/**
 * Best-effort save of a "failed" notification - never throws.
 */
async function saveFailedNotification(msg: SmsMessage): Promise<void> {
  try {
    await saveNotification(msg, "failed");
  } catch {
    // Ignore save failure
  }
}

/**
 * Czy na tym hostingu brakuje dostawcy SMS? Zwraca nazwę platformy, gdy nie ma
 * `SMSAPI_TOKEN`, a serwer działa na hostingu (Vercel, Cloud Run); w pozostałych
 * przypadkach `null` (jest token albo działamy poza hostingiem — lokalnie, w
 * testach, w CI). Jedno źródło warunku dla `sendSms` i dla tras, które przed
 * wysyłką wsadową muszą wiedzieć, że wiadomości nie wyjdą.
 */
export function smsProviderUnavailablePlatform(): HostingPlatform | null {
  if (process.env.SMSAPI_TOKEN) return null;
  return hostingPlatform();
}

/**
 * Send an SMS message.
 *
 * When `SMSAPI_TOKEN` is configured, the message is sent through the
 * SMSAPI.pl REST API (sender name taken from `SMSAPI_SENDER`, default "Info").
 *
 * Without a token outside hosting (local development, tests, CI), the message
 * is only logged (simulation) and saved as "sent".
 *
 * Without a token on hosting (Vercel, Cloud Run) nothing is sent or simulated:
 * the error is logged, no row is written to the notifications table and the
 * result is `success: false` with SMS_PROVIDER_UNAVAILABLE_ERROR (no `skipped`
 * field, so callers do not treat the message as handled).
 *
 * Otherwise the message is saved to the notifications table for audit trail:
 * status "sent" on success, "failed" on any error.
 */
export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  const normalizedTo = normalizePolishPhoneNumber(msg.to);
  if (!normalizedTo) {
    // N2 (audyt bezpieczeństwa): numer zamaskowany — log i wynik błędu trafiają do
    // notifications/logów Vercela, pełny numer to dana osobowa.
    logger.warn("Invalid phone number for SMS", {
      to: maskPhoneNumber(msg.to),
      salonId: msg.salonId,
    });
    await saveFailedNotification(msg);
    return {
      success: false,
      error: `Invalid phone number: ${maskPhoneNumber(msg.to)}. Expected 9 digits or +48 followed by 9 digits.`,
    };
  }

  // Numery testowe (E2E, seed): nigdy do dostawcy, także z tokenem, i bez
  // wpisu w notifications — test nie zostawia po sobie danych.
  if (isTestPhoneNumber(normalizedTo)) {
    logger.info("SMS skipped: test phone number", {
      to: maskPhoneNumber(normalizedTo),
      salonId: msg.salonId,
    });
    return { success: false, error: SMS_TEST_PHONE_ERROR, skipped: "test_phone" };
  }

  const token = process.env.SMSAPI_TOKEN;

  // Na hostingu bez dostawcy wiadomość nie wychodzi, więc nie może zostać
  // zapisana ani zgłoszona jako wysłana. Brak konfiguracji nie jest zdarzeniem
  // jednej wiadomości — bez wpisu w notifications; wołający dostaje błąd.
  const platform = smsProviderUnavailablePlatform();
  if (platform !== null) {
    logger.error("SMS not sent: no SMS provider configured on hosting", {
      platform,
      salonId: msg.salonId,
    });
    return { success: false, error: SMS_PROVIDER_UNAVAILABLE_ERROR };
  }

  try {
    if (token) {
      // Real delivery through SMSAPI.pl
      await sendViaSmsapi(token, normalizedTo, msg.message);
    } else {
      // Simulation mode - log instead of sending (no SMS provider configured).
      // Audyt bezpieczeństwa: numer zamaskowany, bez treści (imię, usługa, termin = PII).
      logger.info("SMS notification (simulated - no SMSAPI_TOKEN)", {
        to: maskPhoneNumber(normalizedTo),
        salonId: msg.salonId,
        messageLength: msg.message.length,
      });
    }

    // Save notification to database with 'sent' status
    const notificationId = await saveNotification(msg, "sent");
    logger.info("SMS notification saved", { notificationId });

    return {
      success: true,
      notificationId,
    };
  } catch (error) {
    // Szczegóły tylko w logu (`logger` redaguje `error` przez safe-error);
    // wołający dostaje ogólny komunikat.
    logger.error("Failed to send/save SMS", {
      error,
      to: maskPhoneNumber(normalizedTo),
      salonId: msg.salonId,
    });

    // Try to save notification with failed status
    await saveFailedNotification(msg);

    return {
      success: false,
      error: SMS_SEND_FAILED_ERROR,
    };
  }
}

/**
 * Strefa czasowa daty i godziny w treści SMS (#232): zawsze czas warszawski,
 * niezależnie od strefy procesu.
 */
export const SMS_TIME_ZONE = "Europe/Warsaw";

/** Podstawowa tabela GSM 03.38 bez znaków sterujących (LF, CR, ESC). */
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);

/** Maksymalna długość nazwy salonu w treści SMS. */
const SMS_SALON_NAME_MAX = 40;

/**
 * Maksymalna długość nazwy usługi w treści SMS o zwolnionym terminie — jak
 * nazwy salonu; z nią najdłuższa treść mieści się w dwóch segmentach GSM-7.
 */
const SMS_SERVICE_NAME_MAX = 40;

/**
 * Maksymalna długość nazwy pracownika w treści SMS — jak nazwy salonu i usługi.
 */
const SMS_EMPLOYEE_NAME_MAX = 40;

/**
 * Maksymalna długość imienia klienta w treści SMS. Imię i nazwisko zwykle
 * mieszczą się w tym limicie; dłuższy tekst nie jest skracany, tylko pomijany
 * (patrz `clientNameForSms`).
 */
const SMS_CLIENT_NAME_MAX = 30;

/** Dowolny znak liczbowy Unicode (cyfry ASCII, pełnoszerokie, indeksy itd.). */
const ANY_NUMBER_CHAR = /\p{N}/u;

/**
 * Telefon salonu w treści SMS: po obcięciu spacji w całości cyfry, spacje,
 * nawiasy i myślniki (opcjonalny „+” na początku), 6–20 znaków, w tym co
 * najmniej 6 cyfr. Wartość niepasująca nie jest poprawiana — fragment
 * z telefonem jest pomijany.
 */
const SMS_SALON_PHONE = /^(?=(?:\D*\d){6})\+?[0-9 ()-]{6,20}$/;

/**
 * Nazwa wyglądająca na adres: „://”, „www.”, kropka + domena (np. uroda.pl)
 * albo czteroczęściowy adres numeryczny (np. 192.168.10.20).
 */
const ADDRESS_LIKE = /:\/\/|www\.|[a-z0-9]\.[a-z]{2,}(?![a-z])|\d{1,3}(?:\.\d{1,3}){3}/i;

/**
 * Czy tekst wygląda na adres („://”, „www.”, kropka + domena, czteroczęściowy
 * adres numeryczny). Jedna reguła dla treści SMS i push.
 */
export function looksLikeAddress(text: string): boolean {
  return ADDRESS_LIKE.test(text);
}

/**
 * Tekst sprowadzony do podstawowej tabeli GSM-7. Kolejno: znaki sterujące
 * i nowe linie → spacja; NFKD bez znaków łączących, ł→l, Ł→L; tylko
 * podstawowa tabela GSM-7; zwinięte spacje i trim.
 */
function toGsm7Basic(text: string): string {
  return [
    ...text
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L"),
  ]
    .filter((c) => GSM7_BASIC.has(c))
    .join("")
    .replace(/ +/g, " ")
    .trim();
}

/**
 * Tekst właściciela salonu przygotowany do treści SMS: `toGsm7Basic`; tekst
 * wyglądający na adres przed albo po oczyszczeniu jest pomijany w całości;
 * ponad `max` znaków → `max - 3` znaki (bez spacji na końcu) + "...".
 */
function ownerTextForSms(text: string, max: number): string {
  const cleaned = toGsm7Basic(text);

  if (looksLikeAddress(text) || looksLikeAddress(cleaned)) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3).trimEnd()}...`;
}

/**
 * Imię klienta przygotowane do treści szablonów SMS z tego modułu (przypomnienie,
 * potwierdzenie rezerwacji, potwierdzenie płatności, rezerwacja z zadatkiem
 * BLIK). Imię może pochodzić z publicznego formularza (także bez sesji) albo
 * z kartoteki założonej z nazwy konta, a SMS może trafić na dowolny numer —
 * nie może więc przemycić adresu strony ani numeru (telefonu, konta, kodu),
 * który odbiorca wziąłby za wiadomość albo instrukcję od salonu.
 * `toGsm7Basic`; pomijane w całości (pusty wynik), gdy przed albo po
 * oczyszczeniu wygląda na adres albo zawiera jakikolwiek znak liczbowy, oraz
 * gdy po oczyszczeniu ma ponad SMS_CLIENT_NAME_MAX znaków — obcięcie mogłoby
 * zostawić czytelny fragment wstrzykniętej treści. Pusty wynik = szablon bez
 * powitania.
 */
function clientNameForSms(name: string): string {
  const cleaned = toGsm7Basic(name);

  if (looksLikeAddress(name) || looksLikeAddress(cleaned)) return "";
  if (ANY_NUMBER_CHAR.test(name) || ANY_NUMBER_CHAR.test(cleaned)) return "";
  if (cleaned.length > SMS_CLIENT_NAME_MAX) return "";
  return cleaned;
}

/**
 * Nazwa salonu (tekst właściciela) przygotowana do treści SMS: `toGsm7Basic`,
 * potem ponad 40 znaków → 37 znaków (bez spacji na końcu) + "...". Nazwa
 * wyglądająca na adres jest pomijana w całości. Pusty wynik = szablon bez
 * fragmentu „w <salon>”.
 */
export function salonNameForSms(name: string | null | undefined): string {
  if (!name) return "";
  return ownerTextForSms(name, SMS_SALON_NAME_MAX);
}

/** Fragment „ w <salon>” albo pusty napis, gdy nazwy brak po przygotowaniu. */
function salonPart(name: string): string {
  return name ? ` w ${name}` : "";
}

/** Powitanie „<imię>, ” przez `clientNameForSms` albo pusty napis. */
function greetingPart(clientName: string): string {
  const name = clientNameForSms(clientName);
  return name ? `${name}, ` : "";
}

/** Nazwa usługi przez regułę tekstu właściciela (adres pomijany, limit). */
function serviceNameForSms(serviceName: string): string {
  return ownerTextForSms(serviceName, SMS_SERVICE_NAME_MAX);
}

/**
 * Fragment „ u <pracownik>” albo pusty napis. Nazwę pracownika wpisuje
 * właściciel salonu w panelu, więc idzie przez tę samą regułę co nazwa salonu
 * i usługi (adres pomijany, długi tekst skracany), a nie przez regułę imienia
 * klienta: tekst właściciela nie pochodzi z publicznego formularza.
 */
function employeePart(employeeName: string): string {
  const employee = ownerTextForSms(employeeName, SMS_EMPLOYEE_NAME_MAX);
  return employee ? ` u ${employee}` : "";
}

/**
 * Parametry treści SMS o zwolnionym terminie z listy oczekujących. Celowo bez
 * danych klienta, pracownika i bez linku.
 */
export interface WaitingListSmsParams {
  salonName: string | null | undefined;
  serviceName?: string | null | undefined;
  startTime: Date;
  salonPhone?: string | null | undefined;
}

/**
 * Treść SMS o zwolnionym terminie (czysta funkcja, bez wysyłki). Nazwa salonu
 * przez `salonNameForSms`; nazwa usługi przez tę samą regułę (adres pomijany,
 * limit SMS_SERVICE_NAME_MAX); data przez `toGsm7Basic`; telefon salonu tylko,
 * gdy w całości pasuje do SMS_SALON_PHONE. Data i godzina w strefie
 * SMS_TIME_ZONE. Fragmenty salonu, usługi i telefonu pojawiają się tylko, gdy
 * po przygotowaniu nie są puste.
 */
export function buildWaitingListSms(params: WaitingListSmsParams): string {
  const formattedDate = toGsm7Basic(
    params.startTime.toLocaleDateString("pl-PL", {
      timeZone: SMS_TIME_ZONE,
      day: "numeric",
      month: "long",
    })
  );
  const formattedTime = params.startTime.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const salon = salonPart(salonNameForSms(params.salonName));

  const service = ownerTextForSms(params.serviceName ?? "", SMS_SERVICE_NAME_MAX);
  const servicePart = service ? ` "${service}"` : "";

  const rawPhone = (params.salonPhone ?? "").trim();
  const phone = SMS_SALON_PHONE.test(rawPhone) ? rawPhone : "";
  const phonePart = phone ? ` lub zadzwon: ${phone}` : "";

  return (
    `Zwolnil sie termin${salon}:${servicePart} ${formattedDate} o ${formattedTime}. ` +
    `Aby go przyjac, zaloguj sie w aplikacji i otworz liste oczekujacych${phonePart}.`
  );
}

/**
 * Send an appointment reminder SMS to the client 1 hour before the appointment.
 * Imię przez `clientNameForSms`, usługa i pracownik przez regułę tekstu
 * właściciela, salon przez `salonNameForSms`, data przez `toGsm7Basic`; puste
 * po przygotowaniu fragmenty są opuszczane („Przypomnienie: Twoja wizyta…”).
 */
export async function sendAppointmentReminderSms(params: {
  clientPhone: string;
  clientName: string;
  serviceName: string;
  employeeName: string;
  appointmentDate: Date;
  salonName: string;
  salonId: string;
  clientId?: string;
}): Promise<SmsResult> {
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
  const formattedDate = toGsm7Basic(
    params.appointmentDate.toLocaleDateString("pl-PL", {
      timeZone: SMS_TIME_ZONE,
      day: "numeric",
      month: "long",
    })
  );

  const salon = salonPart(salonNameForSms(params.salonName));
  const greeting = greetingPart(params.clientName);
  const service = serviceNameForSms(params.serviceName);
  const servicePart = service ? ` "${service}"` : "";
  const employee = employeePart(params.employeeName);

  const message =
    `Przypomnienie: ${greeting}Twoja wizyta${servicePart}${employee}${salon} juz dzisiaj o ${formattedTime} (${formattedDate}). Do zobaczenia!`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/**
 * Parametry SMS przypomnienia na dobę przed wizytą (trasa
 * /api/reminders/appointment). `clientName` to imię i nazwisko jako jedno pole
 * — jak w pozostałych szablonach; reguła imienia (`clientNameForSms`, w tym
 * limit SMS_CLIENT_NAME_MAX) działa na całym połączonym tekście, więc
 * wstrzyknięta treść nie może się rozłożyć na dwa pola, z których każde
 * osobno mieści się w limicie.
 */
export interface AppointmentReminder24hSmsParams {
  clientPhone: string;
  clientName: string;
  serviceName: string | null | undefined;
  employeeName: string;
  appointmentDate: Date;
  salonName: string | null | undefined;
  salonId: string;
  clientId?: string | undefined;
}

/**
 * Treść SMS przypomnienia na dobę przed wizytą (czysta funkcja, bez wysyłki).
 * Imię przez `clientNameForSms`, usługa i pracownik przez regułę tekstu
 * właściciela, salon przez `salonNameForSms`, data (z dniem tygodnia i rokiem)
 * przez `toGsm7Basic`; data i godzina w strefie SMS_TIME_ZONE. Puste po
 * przygotowaniu fragmenty są opuszczane („Przypomnienie: Twoja wizyta
 * odbedzie sie …”). Inne brzmienie niż `sendAppointmentReminderSms`, które
 * mówi „juz dzisiaj”.
 */
export function buildAppointmentReminder24hSms(params: AppointmentReminder24hSmsParams): string {
  const formattedDate = toGsm7Basic(
    params.appointmentDate.toLocaleDateString("pl-PL", {
      timeZone: SMS_TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const greeting = greetingPart(params.clientName);
  const service = serviceNameForSms(params.serviceName ?? "");
  const servicePart = service ? ` "${service}"` : "";
  const salon = salonPart(salonNameForSms(params.salonName));
  const employee = employeePart(params.employeeName);

  return `Przypomnienie: ${greeting}Twoja wizyta${servicePart}${salon}${employee} odbedzie sie ${formattedDate} o godz. ${formattedTime}. Do zobaczenia!`;
}

/** Send the 24h appointment reminder SMS with the text from buildAppointmentReminder24hSms. */
export async function sendAppointmentReminder24hSms(params: AppointmentReminder24hSmsParams): Promise<SmsResult> {
  return sendSms({
    to: params.clientPhone,
    message: buildAppointmentReminder24hSms(params),
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/**
 * Send a booking confirmation SMS right after an appointment is created
 * without a deposit (Stripe deposit bookings get their confirmation after
 * payment; BLIK deposit bookings get sendBlikDepositBookingSms instead).
 * Imię przez `clientNameForSms`, usługa i pracownik przez regułę tekstu
 * właściciela, salon przez `salonNameForSms`, data przez `toGsm7Basic`; puste
 * po przygotowaniu fragmenty są opuszczane („Potwierdzenie rezerwacji: Twoja
 * wizyta…”).
 */
export async function sendBookingConfirmationSms(params: {
  clientPhone: string;
  clientName: string;
  serviceName: string;
  employeeName: string;
  appointmentDate: Date;
  salonName: string;
  salonId: string;
  clientId?: string;
}): Promise<SmsResult> {
  const formattedDate = toGsm7Basic(
    params.appointmentDate.toLocaleDateString("pl-PL", {
      timeZone: SMS_TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  );
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const salon = salonPart(salonNameForSms(params.salonName));
  const greeting = greetingPart(params.clientName);
  const service = serviceNameForSms(params.serviceName);
  const servicePart = service ? ` "${service}"` : "";
  const employee = employeePart(params.employeeName);

  const message =
    `Potwierdzenie rezerwacji: ${greeting}Twoja wizyta${servicePart}${employee}${salon} zostala umowiona na ${formattedDate} o ${formattedTime}. Do zobaczenia!`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/**
 * Send a payment confirmation SMS to the client after a deposit payment.
 * `salonName` przechodzi przez `salonNameForSms`; pusty wynik (null, pusty
 * napis, nazwa jak adres albo spoza GSM-7) → treść bez fragmentu „w <salon>”.
 * Imię przez `clientNameForSms` (pusty wynik → bez powitania), usługa
 * i pracownik przez regułę tekstu właściciela (pusta usługa → „za wizyte”,
 * pusty pracownik → bez fragmentu „u …”), data przez `toGsm7Basic`.
 */
export async function sendPaymentConfirmationSms(params: {
  clientPhone: string;
  clientName: string;
  amount: number;
  currency: string;
  serviceName: string;
  appointmentDate: Date;
  employeeName: string;
  salonName: string | null;
  salonId: string;
  clientId?: string;
}): Promise<SmsResult> {
  const formattedDate = toGsm7Basic(
    params.appointmentDate.toLocaleDateString("pl-PL", {
      timeZone: SMS_TIME_ZONE,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  const salon = salonPart(salonNameForSms(params.salonName));
  const greeting = greetingPart(params.clientName);
  const service = serviceNameForSms(params.serviceName);
  const servicePart = service ? ` za usluge "${service}"` : " za wizyte";
  const employee = employeePart(params.employeeName);

  const message =
    `Potwierdzenie platnosci: ${greeting}zadatek ${params.amount.toFixed(2)} ${params.currency}${servicePart}${employee}${salon} dnia ${formattedDate} zostal przyjety. Dziekujemy!`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/**
 * Parametry SMS o rezerwacji z zadatkiem płatnym BLIK-iem na telefon salonu.
 * `blikPhone` i `title` to dokładnie te wartości, które klient dostał
 * w odpowiedzi rezerwacji — wołający nie czyta ich ponownie z bazy, żeby SMS
 * i ekran nie mogły się rozjechać (np. gdy właściciel zmieni numer w trakcie).
 */
export interface BlikDepositBookingSmsParams {
  clientPhone: string;
  clientName: string;
  serviceName: string;
  employeeName: string;
  appointmentDate: Date;
  salonName: string | null;
  salonId: string;
  clientId?: string | undefined;
  blikPhone: string;
  amount: number;
  title: string;
}

/**
 * Treść SMS o rezerwacji z zadatkiem BLIK (czysta funkcja, bez wysyłki).
 * Data przechodzi przez `toGsm7Basic`, nazwa salonu przez `salonNameForSms`,
 * usługa i pracownik przez regułę tekstu właściciela (adres pomijany, pusty
 * pracownik → bez fragmentu „u …”).
 * Imię klienta (z kartoteki albo z publicznego formularza) przez `clientNameForSms`:
 * imię z adresem, cyfrą albo ponad limit jest pomijane i treść idzie bez
 * powitania. Numer BLIK, kwota i tytuł nie są skracane — bez nich
 * klient nie zapłaci; numer i tytuł idą bez zmian, bo muszą być identyczne
 * z tym, co pokazał ekran rezerwacji. Data i godzina w strefie SMS_TIME_ZONE.
 */
export function buildBlikDepositBookingSms(params: BlikDepositBookingSmsParams): string {
  const formattedDate = toGsm7Basic(
    params.appointmentDate.toLocaleDateString("pl-PL", {
      timeZone: SMS_TIME_ZONE,
      day: "numeric",
      month: "long",
    })
  );
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const salon = salonPart(salonNameForSms(params.salonName));
  const greeting = greetingPart(params.clientName);
  const service = serviceNameForSms(params.serviceName) || "wizyta";
  const employee = employeePart(params.employeeName);

  return (
    `Rezerwacja przyjeta: ${greeting}"${service}"${employee}${salon} ${formattedDate} o ${formattedTime}. ` +
    `Wplac zadatek ${params.amount.toFixed(2)} PLN BLIK-iem na telefon ${params.blikPhone}, ` +
    `tytul: ${params.title}. Salon potwierdzi wplate.`
  );
}

/**
 * Send the BLIK deposit booking SMS right after the booking is created:
 * the appointment is reserved, the deposit is paid by BLIK to the salon's
 * phone and confirmed manually by the salon.
 */
export async function sendBlikDepositBookingSms(params: BlikDepositBookingSmsParams): Promise<SmsResult> {
  return sendSms({
    to: params.clientPhone,
    message: buildBlikDepositBookingSms(params),
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/** Powód nieudanej wysyłki z zamkniętej listy (do logu zamiast `result.error`, który może nieść zamaskowany numer). */
export type SmsFailureReason = "test_phone" | "provider_unavailable" | "send_failed" | "rejected";

export function smsFailureReason(result: SmsResult): SmsFailureReason {
  if (result.skipped === "test_phone") return "test_phone";
  if (result.error === SMS_PROVIDER_UNAVAILABLE_ERROR) return "provider_unavailable";
  if (result.error === SMS_SEND_FAILED_ERROR) return "send_failed";
  return "rejected";
}

/**
 * Parametry SMS po ręcznym oznaczeniu zadatku jako wpłaconego przez salon.
 * Celowo bez imienia klienta, usługi, pracownika i numeru BLIK: treść ma się
 * zmieścić w jednym segmencie GSM-7 i nie niesie tekstu z publicznego formularza.
 */
export interface DepositMarkedSmsParams {
  clientPhone: string;
  amount: number;
  appointmentDate: Date;
  salonName: string | null | undefined;
  salonId: string;
  clientId?: string | undefined;
}

/**
 * Treść SMS po ręcznym oznaczeniu zadatku (czysta funkcja, bez wysyłki).
 * Nazwa salonu przez `salonNameForSms` (pusty wynik → bez fragmentu „w <salon>”),
 * data przez `toGsm7Basic`, data i godzina w strefie SMS_TIME_ZONE. „Przez salon”:
 * wpłatę oznacza salon ręcznie, MyHelper jej nie weryfikuje. Najdłuższa treść
 * (kwota 11 znaków, data 15, salon 40) ma 148 znaków, czyli jeden segment.
 */
export function buildDepositMarkedSms(params: DepositMarkedSmsParams): string {
  const formattedDate = toGsm7Basic(
    params.appointmentDate.toLocaleDateString("pl-PL", { timeZone: SMS_TIME_ZONE, day: "numeric", month: "long" })
  );
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE, hour: "2-digit", minute: "2-digit",
  });
  const salon = salonPart(salonNameForSms(params.salonName));
  return `Zadatek ${params.amount.toFixed(2)} PLN za wizyte ${formattedDate} o ${formattedTime}${salon} zostal potwierdzony przez salon. Do zobaczenia!`;
}

/** Send the SMS with the text from buildDepositMarkedSms. */
export async function sendDepositMarkedSms(params: DepositMarkedSmsParams): Promise<SmsResult> {
  return sendSms({
    to: params.clientPhone,
    message: buildDepositMarkedSms(params),
    salonId: params.salonId,
    clientId: params.clientId,
  });
}
