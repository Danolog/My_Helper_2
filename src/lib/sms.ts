import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { maskPhoneNumber, normalizePolishPhoneNumber } from "@/lib/phone";
import { notifications } from "@/lib/schema";
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
    // Tylko kod błędu (#75, Ryan): `message` dostawcy bywa echem danych
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
 */
async function saveNotification(
  msg: SmsMessage,
  status: "sent" | "failed"
): Promise<string | undefined> {
  const [notification] = await db
    .insert(notifications)
    .values({
      salonId: msg.salonId,
      clientId: msg.clientId || null,
      type: "sms",
      message: msg.message,
      status,
      ...(status === "sent" ? { sentAt: new Date() } : {}),
    })
    .returning();

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
 * Send an SMS message.
 *
 * When `SMSAPI_TOKEN` is configured, the message is sent through the
 * SMSAPI.pl REST API (sender name taken from `SMSAPI_SENDER`, default "Info").
 *
 * Without a token (e.g. local development), the message is only logged -
 * the previous stub behaviour is preserved.
 *
 * The message is always saved to the notifications table for audit trail:
 * status "sent" on success, "failed" on any error.
 */
export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  const normalizedTo = normalizePolishPhoneNumber(msg.to);
  if (!normalizedTo) {
    // N2 (Ryan): numer zamaskowany — log i wynik błędu trafiają do
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

  try {
    if (token) {
      // Real delivery through SMSAPI.pl
      await sendViaSmsapi(token, normalizedTo, msg.message);
    } else {
      // Simulation mode - log instead of sending (no SMS provider configured).
      // Ryan: numer zamaskowany, bez treści (imię, usługa, termin = PII).
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

/** Nazwa wyglądająca na adres: „://”, „www.” albo kropka + domena (np. uroda.pl). */
const ADDRESS_LIKE = /:\/\/|www\.|[a-z0-9]\.[a-z]{2,}(?![a-z])/i;

/**
 * Nazwa salonu (tekst właściciela) przygotowana do treści SMS. Kolejno:
 * znaki sterujące i nowe linie → spacja; NFKD bez znaków łączących, ł→l,
 * Ł→L; tylko podstawowa tabela GSM-7; zwinięte spacje i trim; ponad 40 znaków
 * → 37 znaków (bez spacji na końcu) + "...". Nazwa wyglądająca na adres jest
 * pomijana w całości. Pusty wynik = szablon bez fragmentu „w <salon>”.
 */
export function salonNameForSms(name: string | null | undefined): string {
  if (!name) return "";
  const cleaned = [
    ...name
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

  if (ADDRESS_LIKE.test(name) || ADDRESS_LIKE.test(cleaned)) return "";
  if (cleaned.length <= SMS_SALON_NAME_MAX) return cleaned;
  return `${cleaned.slice(0, SMS_SALON_NAME_MAX - 3).trimEnd()}...`;
}

/** Fragment „ w <salon>” albo pusty napis, gdy nazwy brak po przygotowaniu. */
function salonPart(name: string): string {
  return name ? ` w ${name}` : "";
}

/**
 * Send an appointment reminder SMS to the client 1 hour before the appointment.
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
  const formattedDate = params.appointmentDate.toLocaleDateString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    day: "numeric",
    month: "long",
  });

  const salon = salonPart(salonNameForSms(params.salonName));

  const message =
    `Przypomnienie: ${params.clientName}, Twoja wizyta "${params.serviceName}" u ${params.employeeName}${salon} juz dzisiaj o ${formattedTime} (${formattedDate}). Do zobaczenia!`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/**
 * Send a booking confirmation SMS right after an appointment is created
 * without a deposit (deposit bookings get their confirmation after payment).
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
  const formattedDate = params.appointmentDate.toLocaleDateString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const formattedTime = params.appointmentDate.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const salon = salonPart(salonNameForSms(params.salonName));

  const message =
    `Potwierdzenie rezerwacji: ${params.clientName}, Twoja wizyta "${params.serviceName}" u ${params.employeeName}${salon} zostala umowiona na ${formattedDate} o ${formattedTime}. Do zobaczenia!`;

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
  const formattedDate = params.appointmentDate.toLocaleDateString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const salon = salonPart(salonNameForSms(params.salonName));

  const message =
    `Potwierdzenie platnosci: ${params.clientName}, zadatek ${params.amount.toFixed(2)} ${params.currency} za usluge "${params.serviceName}" u ${params.employeeName}${salon} dnia ${formattedDate} zostal przyjety. Dziekujemy!`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}
