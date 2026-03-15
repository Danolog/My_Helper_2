import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { DEFAULT_VAT_RATE } from "@/lib/constants";
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import {
  subscriptionPayments,
  salonSubscriptions,
  subscriptionPlans,
  salons,
} from "@/lib/schema";

import { logger } from "@/lib/logger";
/**
 * GET /api/subscriptions/payments/[id]/receipt
 *
 * Generates a downloadable receipt/invoice for a subscription payment.
 * Returns HTML that can be printed or saved as PDF.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 },
      );
    }

    const { id } = await params;

    // Fetch payment with plan and salon data
    const rows = await db
      .select({
        id: subscriptionPayments.id,
        amount: subscriptionPayments.amount,
        currency: subscriptionPayments.currency,
        status: subscriptionPayments.status,
        stripePaymentIntentId: subscriptionPayments.stripePaymentIntentId,
        paidAt: subscriptionPayments.paidAt,
        createdAt: subscriptionPayments.createdAt,
        // Plan info
        planName: subscriptionPlans.name,
        planSlug: subscriptionPlans.slug,
        planPrice: subscriptionPlans.priceMonthly,
        // Salon info
        salonName: salons.name,
        salonAddress: salons.address,
        salonPhone: salons.phone,
        salonEmail: salons.email,
        // Subscription info
        subscriptionId: salonSubscriptions.id,
        currentPeriodStart: salonSubscriptions.currentPeriodStart,
        currentPeriodEnd: salonSubscriptions.currentPeriodEnd,
      })
      .from(subscriptionPayments)
      .leftJoin(
        salonSubscriptions,
        eq(subscriptionPayments.subscriptionId, salonSubscriptions.id),
      )
      .leftJoin(
        subscriptionPlans,
        eq(salonSubscriptions.planId, subscriptionPlans.id),
      )
      .leftJoin(salons, eq(subscriptionPayments.salonId, salons.id))
      .where(
        and(
          eq(subscriptionPayments.id, id),
          eq(subscriptionPayments.salonId, salonId),
        ),
      )
      .limit(1);

    if (rows.length === 0 || !rows[0]) {
      return NextResponse.json(
        { success: false, error: "Platnosc nie zostala znaleziona" },
        { status: 404 },
      );
    }

    const payment = rows[0];

    const formatDate = (date: Date | null) => {
      if (!date) return "-";
      return new Intl.DateTimeFormat("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(date));
    };

    const statusLabel = (s: string) => {
      switch (s) {
        case "succeeded":
          return "Zaplacono";
        case "pending":
          return "Oczekuje";
        case "failed":
          return "Nieudana";
        default:
          return s;
      }
    };

    // Generate receipt number from payment ID and date
    const paymentDate = payment.paidAt || payment.createdAt;
    const year = new Date(paymentDate).getFullYear();
    const month = String(new Date(paymentDate).getMonth() + 1).padStart(
      2,
      "0",
    );
    const shortId = payment.id.slice(0, 8).toUpperCase();
    const receiptNumber = `SUB/${year}/${month}/${shortId}`;

    const netAmount = (parseFloat(payment.amount) / (1 + DEFAULT_VAT_RATE / 100)).toFixed(2);
    const vatAmount = (
      parseFloat(payment.amount) - parseFloat(netAmount)
    ).toFixed(2);

    const html = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Potwierdzenie platnosci - ${receiptNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #e5e7eb; }
    .logo { font-size: 24px; font-weight: 700; color: #2563eb; }
    .logo span { color: #1a1a1a; }
    .receipt-info { text-align: right; }
    .receipt-info h2 { font-size: 20px; margin-bottom: 4px; color: #374151; }
    .receipt-info p { font-size: 13px; color: #6b7280; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 32px; }
    .party { flex: 1; }
    .party h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 8px; }
    .party p { font-size: 14px; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    th { background: #f9fafb; padding: 12px 16px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
    td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
    .text-right { text-align: right; }
    .totals { margin-left: auto; width: 300px; }
    .totals table { margin-bottom: 0; }
    .totals td { padding: 8px 16px; }
    .totals .total-row { font-weight: 700; font-size: 16px; border-top: 2px solid #e5e7eb; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .status-succeeded { background: #dcfce7; color: #166534; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-failed { background: #fecaca; color: #991b1b; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; text-align: center; }
    @media print { body { padding: 20px; } .no-print { display: none; } }
    .print-btn { display: block; margin: 20px auto; padding: 10px 24px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
    .print-btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">My<span>Helper</span></div>
      <p style="font-size: 13px; color: #6b7280; margin-top: 4px;">Platforma do zarzadzania salonem</p>
    </div>
    <div class="receipt-info">
      <h2>Potwierdzenie platnosci</h2>
      <p>Nr: ${receiptNumber}</p>
      <p>Data: ${formatDate(paymentDate)}</p>
    </div>
  </div>

  <div class="parties">
    <div class="party">
      <h3>Sprzedawca</h3>
      <p><strong>${process.env.COMPANY_NAME || "MyHelper"}</strong></p>
      <p>${process.env.COMPANY_ADDRESS || ""}</p>
      <p>${process.env.COMPANY_POSTAL_CITY || ""}</p>
      <p>NIP: ${process.env.COMPANY_NIP || ""}</p>
    </div>
    <div class="party">
      <h3>Nabywca</h3>
      <p><strong>${payment.salonName || "Salon"}</strong></p>
      ${payment.salonAddress ? `<p>${payment.salonAddress}</p>` : ""}
      ${payment.salonEmail ? `<p>${payment.salonEmail}</p>` : ""}
      ${payment.salonPhone ? `<p>Tel: ${payment.salonPhone}</p>` : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Opis</th>
        <th>Okres</th>
        <th>Status</th>
        <th class="text-right">Kwota</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <strong>Subskrypcja ${payment.planName || "MyHelper"}</strong>
          <br><span style="font-size: 12px; color: #6b7280;">Plan miesiczny - ${payment.planName || "Standard"}</span>
        </td>
        <td>${formatDate(payment.currentPeriodStart)} - ${formatDate(payment.currentPeriodEnd)}</td>
        <td><span class="status status-${payment.status}">${statusLabel(payment.status)}</span></td>
        <td class="text-right">${parseFloat(payment.amount).toFixed(2)} ${payment.currency}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <table>
      <tr>
        <td>Kwota netto</td>
        <td class="text-right">${netAmount} ${payment.currency}</td>
      </tr>
      <tr>
        <td>VAT (${DEFAULT_VAT_RATE}%)</td>
        <td class="text-right">${vatAmount} ${payment.currency}</td>
      </tr>
      <tr class="total-row">
        <td>Razem brutto</td>
        <td class="text-right">${parseFloat(payment.amount).toFixed(2)} ${payment.currency}</td>
      </tr>
    </table>
  </div>

  ${payment.stripePaymentIntentId ? `
  <div style="margin-top: 24px; padding: 12px 16px; background: #f9fafb; border-radius: 8px; font-size: 12px; color: #6b7280;">
    <strong>ID transakcji:</strong> ${payment.stripePaymentIntentId}
  </div>
  ` : ""}

  <div class="footer">
    <p>Dokument wygenerowany automatycznie przez system MyHelper.</p>
    <p>Ten dokument stanowi potwierdzenie platnosci za subskrypcje.</p>
  </div>

  <button class="print-btn no-print" onclick="window.print()">Drukuj / Zapisz jako PDF</button>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    logger.error("[Subscription Receipt] Error", { error: error });
    return NextResponse.json(
      {
        success: false,
        error: "Nie udalo sie wygenerowac potwierdzenia platnosci",
      },
      { status: 500 },
    );
  }
}
