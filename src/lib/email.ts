import { logger } from "@/lib/logger";
import { notifications } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string | undefined;
  /** When provided, the send is recorded in the notifications table (audit trail). */
  salonId?: string | undefined;
  clientId?: string | undefined;
}

/**
 * Adres e-mail do logu: pierwszy znak lokalnej części + domena
 * („a***@example.com”). Pełny adres nie trafia do logów (hotfix P1).
 */
export function maskEmailAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

export interface EmailResult {
  success: boolean;
  notificationId?: string | undefined;
  error?: string | undefined;
}

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "MyHelper <onboarding@resend.dev>";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * True when a real email provider (Resend) is configured.
 * Without RESEND_API_KEY, emails are only logged (simulation mode) and
 * email verification is not enforced at sign-in.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Shape of the (partial) Resend JSON response we care about. */
interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
}

/**
 * Send a single email through the Resend REST API.
 * Throws on non-2xx HTTP statuses and network failures.
 */
async function sendViaResend(apiKey: string, msg: EmailMessage): Promise<void> {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
    }),
  });

  let data: ResendResponse | null = null;
  try {
    data = (await response.json()) as ResendResponse;
  } catch {
    // Non-JSON response body - fall through to the HTTP status check
  }

  if (!response.ok) {
    const detail = data?.message
      ? `${response.status} - ${data.message}`
      : `HTTP ${response.status}`;
    throw new Error(`Resend error: ${detail}`);
  }

  logger.info("Email sent via Resend", { to: maskEmailAddress(msg.to), messageId: data?.id });
}

/**
 * Save an email notification to the notifications table (audit trail).
 * Only called when the message carries a salon context.
 *
 * Zapis przez bramę salonu wiadomości (#193). Bez salonId (e-mail weryfikacji
 * konta i resetu hasła) — żadnego zapisu i żadnej puli.
 */
async function saveNotification(
  msg: EmailMessage,
  status: "sent" | "failed"
): Promise<string | undefined> {
  const salonId = msg.salonId;
  if (!salonId) return undefined;

  const [notification] = await forSalon(salonId).raw((tx) =>
    tx
      .insert(notifications)
      .values({
        salonId,
        clientId: msg.clientId || null,
        type: "email",
        message: msg.subject,
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
async function saveFailedNotification(msg: EmailMessage): Promise<void> {
  try {
    await saveNotification(msg, "failed");
  } catch {
    // Ignore save failure
  }
}

/**
 * Send an email message.
 *
 * When `RESEND_API_KEY` is configured, the message is sent through the
 * Resend REST API (sender taken from `EMAIL_FROM`).
 *
 * Without a key (e.g. local development), the message is only logged -
 * consistent with the SMS module's simulation mode.
 *
 * When `salonId` is provided, the send is saved to the notifications table:
 * status "sent" on success, "failed" on any error.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  if (!EMAIL_REGEX.test(msg.to)) {
    logger.warn("Invalid email address", { to: maskEmailAddress(msg.to), salonId: msg.salonId });
    await saveFailedNotification(msg);
    return {
      success: false,
      // Wynik trafia do logów wywołujących (newsletter, faktura) — bez pełnego adresu.
      error: `Invalid email address: ${maskEmailAddress(msg.to)}`,
    };
  }

  const apiKey = process.env.RESEND_API_KEY;

  try {
    if (apiKey) {
      // Real delivery through Resend
      await sendViaResend(apiKey, msg);
    } else {
      // Simulation mode - log instead of sending (no email provider configured)
      logger.info("Email notification (simulated - no RESEND_API_KEY)", {
        to: maskEmailAddress(msg.to),
        subject: msg.subject,
      });
    }

    const notificationId = await saveNotification(msg, "sent");

    return {
      success: true,
      notificationId,
    };
  } catch (error) {
    logger.error("Failed to send email", { error, to: maskEmailAddress(msg.to) });

    await saveFailedNotification(msg);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Shared minimal HTML layout for transactional emails (Polish).
 */
export function renderEmailLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pl">
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;padding:32px;">
          <tr><td style="font-size:20px;font-weight:bold;color:#111;padding-bottom:16px;">${title}</td></tr>
          <tr><td style="font-size:14px;color:#333;line-height:1.6;">${bodyHtml}</td></tr>
          <tr><td style="font-size:12px;color:#999;padding-top:24px;">MyHelper — system rezerwacji dla salonów</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Render a call-to-action button for transactional emails.
 */
export function renderEmailButton(url: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${url}" style="background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-size:14px;">${label}</a>
  </p>
  <p style="font-size:12px;color:#666;">Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:<br/>${url}</p>`;
}

/**
 * Send the account email-verification message (Better Auth flow).
 */
export async function sendVerificationEmail(params: {
  to: string;
  url: string;
}): Promise<EmailResult> {
  const html = renderEmailLayout(
    "Potwierdź swój adres email",
    `<p>Dziękujemy za rejestrację w MyHelper.</p>
     <p>Kliknij poniższy przycisk, aby potwierdzić swój adres email i aktywować konto:</p>
     ${renderEmailButton(params.url, "Potwierdź adres email")}`
  );

  return sendEmail({
    to: params.to,
    subject: "MyHelper — potwierdź swój adres email",
    html,
    text: `Potwierdź swój adres email w MyHelper: ${params.url}`,
  });
}

/**
 * Send the password-reset message (Better Auth flow).
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  url: string;
}): Promise<EmailResult> {
  const html = renderEmailLayout(
    "Reset hasła",
    `<p>Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta w MyHelper.</p>
     <p>Kliknij poniższy przycisk, aby ustawić nowe hasło. Link jest ważny przez ograniczony czas.</p>
     ${renderEmailButton(params.url, "Ustaw nowe hasło")}
     <p style="font-size:12px;color:#666;">Jeśli to nie Ty prosiłeś o reset hasła, zignoruj tę wiadomość.</p>`
  );

  return sendEmail({
    to: params.to,
    subject: "MyHelper — reset hasła",
    html,
    text: `Ustaw nowe hasło w MyHelper: ${params.url}`,
  });
}
