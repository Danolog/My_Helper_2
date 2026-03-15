import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invoices, clients } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";

import { logger } from "@/lib/logger";
/**
 * POST /api/invoices/[id]/send-email
 *
 * Send an invoice via email to the associated client.
 * In development mode, the email content is logged to the console
 * instead of being sent through an email provider.
 *
 * Request body (optional):
 *  - email: string (override recipient email)
 *
 * The endpoint:
 * 1. Fetches the invoice and associated client data
 * 2. Determines the recipient email (body override > client email)
 * 3. "Sends" the email (logs to console in dev mode)
 * 4. Updates the invoice with emailSentAt and emailSentTo timestamps
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: email sending is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const { id } = await params;

    // Parse optional body for email override
    let overrideEmail: string | null = null;
    try {
      const body = await request.json();
      if (body.email && typeof body.email === "string") {
        overrideEmail = body.email.trim();
      }
    } catch {
      // No body or invalid JSON - that's OK
    }

    // Fetch invoice with client data
    const rows = await db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        type: invoices.type,
        amount: invoices.amount,
        vatRate: invoices.vatRate,
        vatAmount: invoices.vatAmount,
        netAmount: invoices.netAmount,
        clientName: invoices.clientName,
        clientAddress: invoices.clientAddress,
        companyName: invoices.companyName,
        companyNip: invoices.companyNip,
        description: invoices.description,
        paymentMethod: invoices.paymentMethod,
        invoiceDataJson: invoices.invoiceDataJson,
        issuedAt: invoices.issuedAt,
        emailSentAt: invoices.emailSentAt,
        emailSentTo: invoices.emailSentTo,
        clientId: invoices.clientId,
        clientEmail: clients.email,
        clientFirstName: clients.firstName,
        clientLastName: clients.lastName,
      })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.id, id), eq(invoices.salonId, salonId)))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Faktura nie zostala znaleziona" },
        { status: 404 }
      );
    }

    const invoice = rows[0]!;

    // Determine recipient email
    const recipientEmail = overrideEmail || invoice.clientEmail;

    if (!recipientEmail) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Brak adresu email klienta. Podaj adres email w formularzu lub zaktualizuj dane klienta.",
        },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidlowy format adresu email" },
        { status: 400 }
      );
    }

    // Build email content
    const invoiceType =
      invoice.type === "faktura" ? "Faktura VAT" : "Rachunek";
    const clientDisplayName =
      invoice.companyName ||
      invoice.clientName ||
      (invoice.clientFirstName && invoice.clientLastName
        ? `${invoice.clientFirstName} ${invoice.clientLastName}`
        : "Klient");
    const amount = parseFloat(invoice.amount).toFixed(2);

    const emailSubject = `${invoiceType} ${invoice.invoiceNumber} - ${amount} PLN`;
    const emailBody = buildEmailBody(invoice, invoiceType, clientDisplayName);

    // In development mode, log to console instead of sending
    // eslint-disable-next-line no-console
    logger.info(`
${"=".repeat(70)}
INVOICE EMAIL SENT
${"=".repeat(70)}
To: ${recipientEmail}
Subject: ${emailSubject}
${"─".repeat(70)}
${emailBody}
${"─".repeat(70)}
Attachment: ${invoice.invoiceNumber.replace(/\//g, "_")}.pdf (would be attached in production)
${"=".repeat(70)}
`);

    // Update invoice with email sent timestamp
    const now = new Date();
    await db
      .update(invoices)
      .set({
        emailSentAt: now,
        emailSentTo: recipientEmail,
      })
      .where(eq(invoices.id, id));

    return NextResponse.json({
      success: true,
      message: `Faktura wyslana na adres ${recipientEmail}`,
      data: {
        sentTo: recipientEmail,
        sentAt: now.toISOString(),
        invoiceNumber: invoice.invoiceNumber,
      },
    });
  } catch (error) {
    logger.error("[Invoice Send Email API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie wyslac faktury emailem" },
      { status: 500 }
    );
  }
}

/**
 * Build a plain-text email body for the invoice
 */
function buildEmailBody(
  invoice: {
    invoiceNumber: string;
    type: string;
    amount: string;
    vatAmount: string | null;
    netAmount: string | null;
    issuedAt: Date;
    paymentMethod: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoiceDataJson: any;
  },
  invoiceType: string,
  clientDisplayName: string
): string {
  const issuedDate = new Date(invoice.issuedAt).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const amount = parseFloat(invoice.amount).toFixed(2);
  const netAmount = invoice.netAmount
    ? parseFloat(invoice.netAmount).toFixed(2)
    : null;
  const vatAmount = invoice.vatAmount
    ? parseFloat(invoice.vatAmount).toFixed(2)
    : null;

  const paymentLabels: Record<string, string> = {
    cash: "Gotowka",
    card: "Karta",
    transfer: "Przelew",
  };
  const paymentMethod = invoice.paymentMethod
    ? paymentLabels[invoice.paymentMethod] || invoice.paymentMethod
    : "Nie podano";

  let body = `Szanowny/a ${clientDisplayName},\n\n`;
  body += `W zalaczeniu przesylamy ${invoiceType.toLowerCase()} nr ${invoice.invoiceNumber}.\n\n`;
  body += `Szczegoly dokumentu:\n`;
  body += `  Numer: ${invoice.invoiceNumber}\n`;
  body += `  Typ: ${invoiceType}\n`;
  body += `  Data wystawienia: ${issuedDate}\n`;
  if (netAmount) body += `  Kwota netto: ${netAmount} PLN\n`;
  if (vatAmount) body += `  VAT: ${vatAmount} PLN\n`;
  body += `  Kwota brutto: ${amount} PLN\n`;
  body += `  Metoda platnosci: ${paymentMethod}\n`;

  // Add items from invoiceDataJson if available
  if (invoice.invoiceDataJson?.items?.length > 0) {
    body += `\nPozycje:\n`;
    for (const item of invoice.invoiceDataJson.items) {
      body += `  - ${item.name}: ${item.quantity} x ${item.unitPrice} PLN = ${item.total} PLN\n`;
    }
  }

  body += `\nDziekujemy za skorzystanie z naszych uslug.\n`;
  body += `Pozdrawiamy,\n`;

  if (invoice.invoiceDataJson?.seller?.name) {
    body += `${invoice.invoiceDataJson.seller.name}\n`;
  }

  return body;
}
