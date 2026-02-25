import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  salonSubscriptions,
  subscriptionPlans,
  notifications,
} from "@/lib/schema";
import { getUserSalonId } from "@/lib/get-user-salon";

const DEFAULT_WARNING_DAYS = 7;

/**
 * GET /api/subscriptions/expiration-warning
 *
 * Returns the expiration warning status for the current subscription.
 * Includes:
 * - daysRemaining: Number of days until the subscription expires/renews
 * - warningThreshold: Number of days before expiry to show warning
 * - isNearExpiry: Whether the subscription is near its expiry date
 * - warningsSent: Recent expiration warning notifications
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
      );
    }

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Find the current active subscription
    const [activeSub] = await db
      .select({
        subscription: salonSubscriptions,
        plan: subscriptionPlans,
      })
      .from(salonSubscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(salonSubscriptions.planId, subscriptionPlans.id)
      )
      .where(
        and(
          eq(salonSubscriptions.salonId, salonId),
          eq(salonSubscriptions.status, "active")
        )
      );

    if (!activeSub) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "Brak aktywnej subskrypcji",
      });
    }

    const { subscription: sub, plan } = activeSub;

    // Calculate days remaining
    const now = new Date();
    const periodEnd = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd)
      : null;

    let daysRemaining: number | null = null;
    if (periodEnd) {
      const diffMs = periodEnd.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    const warningThreshold = DEFAULT_WARNING_DAYS;
    const isNearExpiry =
      daysRemaining !== null && daysRemaining <= warningThreshold && daysRemaining >= 0;

    // Get recent expiration warning notifications
    const recentWarnings = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.salonId, salonId),
          sql`${notifications.message} LIKE '%wygasa%' OR ${notifications.message} LIKE '%odnowienia%' OR ${notifications.message} LIKE '%expir%'`
        )
      )
      .orderBy(sql`${notifications.createdAt} DESC`)
      .limit(5);

    return NextResponse.json({
      success: true,
      data: {
        subscriptionId: sub.id,
        planName: plan.name,
        planSlug: plan.slug,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        daysRemaining,
        warningThreshold,
        isNearExpiry,
        renewalAmount: plan.priceMonthly,
        recentWarnings: recentWarnings.map((w) => ({
          id: w.id,
          type: w.type,
          message: w.message,
          status: w.status,
          sentAt: w.sentAt,
          createdAt: w.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error("[Subscription Expiration Warning] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie sprawdzic statusu wygasniecia" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/subscriptions/expiration-warning
 *
 * Checks for subscriptions near expiry and creates warning notifications.
 * This can be called by a cron job or manually triggered.
 *
 * Optional body:
 * - warningDays: Override default warning threshold (default 7)
 * - simulate: If true, simulates near-expiry by temporarily adjusting the period end
 *
 * Returns: { success: true, warnings: [...] }
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Wymagane logowanie" },
        { status: 401 }
      );
    }

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    let warningDays = DEFAULT_WARNING_DAYS;
    let simulate = false;

    try {
      const body = await request.json();
      if (body.warningDays && typeof body.warningDays === "number") {
        warningDays = Math.max(1, Math.min(30, body.warningDays));
      }
      if (body.simulate === true) {
        simulate = true;
      }
    } catch {
      // No body or invalid JSON - use defaults
    }

    // Find active subscriptions near expiry
    const [activeSub] = await db
      .select({
        subscription: salonSubscriptions,
        plan: subscriptionPlans,
      })
      .from(salonSubscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(salonSubscriptions.planId, subscriptionPlans.id)
      )
      .where(
        and(
          eq(salonSubscriptions.salonId, salonId),
          eq(salonSubscriptions.status, "active")
        )
      );

    if (!activeSub) {
      return NextResponse.json({
        success: true,
        warnings: [],
        message: "Brak aktywnej subskrypcji",
      });
    }

    const { subscription: sub, plan } = activeSub;
    const now = new Date();

    // If simulating, temporarily set the period end to simulate near-expiry
    let effectivePeriodEnd = sub.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd)
      : null;

    if (simulate && effectivePeriodEnd) {
      // Set period end to 3 days from now for simulation
      const simulatedEnd = new Date(now);
      simulatedEnd.setDate(simulatedEnd.getDate() + 3);

      // Actually update the database to move period end closer
      await db
        .update(salonSubscriptions)
        .set({
          currentPeriodEnd: simulatedEnd,
        })
        .where(eq(salonSubscriptions.id, sub.id));

      effectivePeriodEnd = simulatedEnd;

      // eslint-disable-next-line no-console
      console.log(
        `[Subscription Warning] SIMULATION: Period end moved to ${simulatedEnd.toISOString()} (${3} days from now)`
      );
    }

    if (!effectivePeriodEnd) {
      return NextResponse.json({
        success: true,
        warnings: [],
        message: "Brak daty zakonczenia okresu",
      });
    }

    // Calculate days remaining
    const diffMs = effectivePeriodEnd.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    const isNearExpiry = daysRemaining <= warningDays && daysRemaining >= 0;

    if (!isNearExpiry) {
      return NextResponse.json({
        success: true,
        warnings: [],
        daysRemaining,
        warningThreshold: warningDays,
        message: `Subskrypcja nie wymaga ostrzezenia (${daysRemaining} dni do odnowienia)`,
      });
    }

    // Format the expiry date for Polish locale
    const expiryDateStr = new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(effectivePeriodEnd);

    // Create warning notification
    const warningMessage =
      `Twoja subskrypcja planu ${plan.name} wygasa za ${daysRemaining} ${daysRemaining === 1 ? "dzien" : daysRemaining < 5 ? "dni" : "dni"} (${expiryDateStr}). ` +
      `Kwota odnowienia: ${parseFloat(plan.priceMonthly).toFixed(2)} PLN. ` +
      `Aby uniknac przerwy w dostepie, upewnij sie ze metoda platnosci jest aktualna. ` +
      `Mozesz zarzadzac subskrypcja w panelu: /dashboard/subscription`;

    const emailResults = await db
      .insert(notifications)
      .values({
        salonId: salonId,
        clientId: null,
        type: "email",
        message: warningMessage,
        status: "sent",
        sentAt: now,
      })
      .returning();

    const notification = emailResults[0];

    // Also create a push notification
    const pushMessage =
      `Subskrypcja ${plan.name} wygasa za ${daysRemaining} dni. Odnow teraz aby zachowac dostep.`;

    const pushResults = await db
      .insert(notifications)
      .values({
        salonId: salonId,
        clientId: null,
        type: "push",
        message: pushMessage,
        status: "sent",
        sentAt: now,
      })
      .returning();

    const pushNotification = pushResults[0];

    // eslint-disable-next-line no-console
    console.log(
      `[Subscription Warning] Warning sent for subscription ${sub.id}. ` +
        `Plan: ${plan.name}, Days remaining: ${daysRemaining}, ` +
        `Renewal amount: ${plan.priceMonthly} PLN`
    );

    const warningsList: Array<{
      id: string;
      type: string;
      message: string;
      status: string;
      sentAt: Date | null;
    }> = [];

    if (notification) {
      warningsList.push({
        id: notification.id,
        type: notification.type,
        message: notification.message,
        status: notification.status,
        sentAt: notification.sentAt,
      });
    }

    if (pushNotification) {
      warningsList.push({
        id: pushNotification.id,
        type: pushNotification.type,
        message: pushNotification.message,
        status: pushNotification.status,
        sentAt: pushNotification.sentAt,
      });
    }

    return NextResponse.json({
      success: true,
      daysRemaining,
      warningThreshold: warningDays,
      isNearExpiry: true,
      planName: plan.name,
      currentPeriodEnd: effectivePeriodEnd,
      renewalAmount: plan.priceMonthly,
      warnings: warningsList,
      message: `Wyslano ostrzezenie o wygasnieciu subskrypcji (${daysRemaining} dni do odnowienia)`,
    });
  } catch (error) {
    console.error("[Subscription Expiration Warning] Error:", error);
    return NextResponse.json(
      { success: false, error: "Nie udalo sie wyslac ostrzezenia" },
      { status: 500 }
    );
  }
}
