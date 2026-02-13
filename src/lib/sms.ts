import { db } from "@/lib/db";
import { notifications } from "@/lib/schema";

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
}

/**
 * Send an SMS message.
 *
 * In development mode, the message is logged to the console instead of
 * actually sending via an SMS provider (SMSAPI, Twilio, etc.).
 *
 * In production, this would integrate with the configured SMS provider.
 * The message is always saved to the notifications table for audit trail.
 */
export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  try {
    // Log to console in dev mode (no real SMS provider configured)
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║              📱  SMS NOTIFICATION                ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  To:      ${msg.to}`);
    console.log(`║  Message: ${msg.message}`);
    console.log("╚══════════════════════════════════════════════════╝\n");

    // Save notification to database with 'sent' status
    // In dev mode we mark as 'sent' since the console log is the delivery mechanism
    const [notification] = await db
      .insert(notifications)
      .values({
        salonId: msg.salonId,
        clientId: msg.clientId || null,
        type: "sms",
        message: msg.message,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();

    const notifId = notification?.id;
    console.log(`[SMS] Notification saved: ${notifId}`);

    return {
      success: true,
      notificationId: notifId,
    };
  } catch (error) {
    console.error("[SMS] Failed to send/save SMS:", error);

    // Try to save notification with failed status
    try {
      await db.insert(notifications).values({
        salonId: msg.salonId,
        clientId: msg.clientId || null,
        type: "sms",
        message: msg.message,
        status: "failed",
      });
    } catch {
      // Ignore save failure
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
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
    hour: "2-digit",
    minute: "2-digit",
  });
  const formattedDate = params.appointmentDate.toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const bookingLink = `${appUrl}/salons/${params.salonId}/book`;

  const message =
    `Przypomnienie: ${params.clientName}, Twoja wizyta "${params.serviceName}" u ${params.employeeName} w ${params.salonName} juz dzisiaj o ${formattedTime} (${formattedDate}). Do zobaczenia! Zarezerwuj nastepna wizyte: ${bookingLink}`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}

/**
 * Send a payment confirmation SMS to the client after a deposit payment.
 */
export async function sendPaymentConfirmationSms(params: {
  clientPhone: string;
  clientName: string;
  amount: number;
  currency: string;
  serviceName: string;
  appointmentDate: Date;
  employeeName: string;
  salonId: string;
  clientId?: string;
}): Promise<SmsResult> {
  const formattedDate = params.appointmentDate.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const bookingLink = `${appUrl}/salons/${params.salonId}/book`;

  const message =
    `Potwierdzenie platnosci: ${params.clientName}, zadatek ${params.amount.toFixed(2)} ${params.currency} za usluge "${params.serviceName}" u ${params.employeeName} dnia ${formattedDate} zostal przyjety. Dziekujemy! Zarezerwuj kolejna wizyte: ${bookingLink}`;

  return sendSms({
    to: params.clientPhone,
    message,
    salonId: params.salonId,
    clientId: params.clientId,
  });
}
