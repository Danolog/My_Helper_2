import { NextResponse } from "next/server";
import { eq, and, inArray, desc } from "drizzle-orm";
import { validateBody, subscriptionCheckoutSchema } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
// Surowe db: odczyt planu (tabela bez salonu) i bieżących wierszy subskrypcji salonu z sesji (plik na przejściowej liście izolacji danych salonu); odczyt wszystkich wierszy salonu idzie przez forSalon
import { db } from "@/lib/db";
import { getUserSalonId } from "@/lib/get-user-salon";
import { hostingPlatform } from "@/lib/hosting";
import { logger } from "@/lib/logger";
import { grossGrosze } from "@/lib/plan-price";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { subscriptionPlans, salonSubscriptions } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { getStripe } from "@/lib/stripe";
import { retrieveStripeSubscriptionLocked } from "@/lib/subscription-locks";
import {
  CURRENT_LOCAL_STATUSES,
  hasRealStripeSubscription,
  isCurrentLocalStatus,
  isCurrentPaidStripeRow,
  purchaseBlock,
  toSalonPurchaseAccessRow,
} from "@/lib/subscription-predicates";
import { isStripeSubscriptionEnded } from "@/lib/subscription-sync";

const warsawDate = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// Czas życia sesji Checkout (`expires_at`, sekundy). Stripe przyjmuje od
// 30 minut do 24 godzin od utworzenia sesji; 5 minut ponad dolną granicę to
// zapas na opóźnienie żądania i różnicę zegarów.
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;

/**
 * Stripe price ID of the purchased plan: STRIPE_PRICE_BASIC for "basic",
 * STRIPE_PRICE_PRO for "pro", trimmed. Missing or blank value → undefined
 * (no price). The other plan's variable is not read.
 */
function getStripePriceId(slug: string): string | undefined {
  let priceId: string | undefined;
  if (slug === "basic") priceId = process.env.STRIPE_PRICE_BASIC;
  else if (slug === "pro") priceId = process.env.STRIPE_PRICE_PRO;
  return priceId?.trim() || undefined;
}

function stripeUnavailableResponse() {
  return NextResponse.json(
    {
      success: false,
      code: "STRIPE_UNAVAILABLE",
      error:
        "Płatności online są chwilowo niedostępne. Plan nie został zmieniony — spróbuj ponownie później.",
    },
    { status: 503 },
  );
}

/**
 * POST /api/subscriptions/checkout
 *
 * Creates a Stripe Checkout Session for a subscription plan. The session's
 * `expires_at` is set to 35 minutes after the moment it is created.
 *
 * This endpoint NEVER writes a subscription or a payment. The subscription
 * is created/updated only by /api/subscriptions/confirm after Stripe reports
 * the Checkout Session as paid. Stripe not configured → 503 STRIPE_UNAVAILABLE;
 * error while building the line item or creating the Checkout Session → 502;
 * in every case nothing is granted.
 *
 * Price: the Stripe price ID of the purchased plan (STRIPE_PRICE_BASIC /
 * STRIPE_PRICE_PRO, trimmed). On hosting (`hostingPlatform()`: Vercel or
 * Cloud Run) without that ID → 503 STRIPE_PRICE_NOT_CONFIGURED, checked
 * right after the Stripe client and before any Stripe call. Off hosting
 * without that ID the price is created in the request: monthly, PLN,
 * `unit_amount` = gross amount in grosze (`grossGrosze` of the plan's net
 * `priceMonthly`).
 *
 * 409 PURCHASE_BLOCKED_UNTIL_PERIOD_END (with `until`): the salon still has
 * full access from a canceled or past_due row with a real Stripe
 * subscription (`resolveSalonAccess` over all salon rows). A new Checkout
 * would create a second Stripe subscription while access from the first one
 * lasts; a new purchase is possible after `until`.
 *
 * 409 PURCHASE_BLOCKED_STRIPE_SUBSCRIPTION_LIVE (no `until`): a salon row with
 * a real Stripe subscription and a status other than trialing/active points
 * to a Stripe subscription that is not in a final Stripe state (`canceled`,
 * `incomplete_expired`). Each such subscription is read from Stripe before
 * the Checkout Session is created; a subscription Stripe reports as missing
 * (`resource_missing`) counts as ended, any other read error → 503
 * STRIPE_UNAVAILABLE.
 *
 * Request body: { planSlug: "basic" | "pro" }
 * Response:     { url: string }
 */
export async function POST(request: Request) {
  // Rate limit: payment checkout is a sensitive operation
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
    const { user } = authResult;

    const salonId = await getUserSalonId();
    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 },
      );
    }

    const body: unknown = await request.json();
    const validationError = validateBody(subscriptionCheckoutSchema, body);
    if (validationError) {
      return NextResponse.json(validationError, { status: 400 });
    }

    // salonId z body (jesli ktos go wysle) schemat pomija (nieznane pola
    // znikaja z wyniku parse) — salon wylacznie z sesji (wyzej).
    const { planSlug } = subscriptionCheckoutSchema.parse(body);

    // Look up the plan in the database
    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.slug, planSlug),
          eq(subscriptionPlans.isActive, true),
        ),
      );

    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan nie zostal znaleziony" },
        { status: 404 },
      );
    }

    // Bieżące wiersze salonu (trialing/active). Ten sam predykat konfliktu co
    // confirm (`isCurrentPaidStripeRow`): wiersz z prawdziwą subskrypcją
    // Stripe — także trial prowadzony przez Stripe — blokuje nowy Checkout
    // TUTAJ, przed pobraniem pieniędzy, a nie dopiero 409 w confirm.
    const currentRows = (
      await db
        .select()
        .from(salonSubscriptions)
        .where(
          and(
            eq(salonSubscriptions.salonId, salonId),
            inArray(salonSubscriptions.status, [...CURRENT_LOCAL_STATUSES]),
          ),
        )
    ).filter((s) => isCurrentLocalStatus(s.status));

    const paidStripeRow = currentRows.find(isCurrentPaidStripeRow);
    const samePlanActive = currentRows.find((s) => s.status === "active" && s.planId === plan.id);
    if (samePlanActive || paidStripeRow?.planId === plan.id) {
      return NextResponse.json(
        {
          success: false,
          error: "Salon posiada juz aktywna subskrypcje tego planu.",
        },
        { status: 409 },
      );
    }
    // Zmiana planu opłaconej subskrypcji Stripe wymaga
    // stripe.subscriptions.update (proracja + synchronizacja planId z
    // webhooka) — do decyzji architektonicznej. Nowy Checkout założyłby
    // drugą subskrypcję w Stripe (podwójne obciążenie), więc odmawiamy.
    if (paidStripeRow) {
      return NextResponse.json(
        {
          success: false,
          code: "PLAN_CHANGE_UNSUPPORTED",
          error:
            "Zmiana planu opłaconej subskrypcji nie jest jeszcze dostępna online. Skontaktuj się z obsługą.",
        },
        { status: 409 },
      );
    }
    // Wiersz bez prawdziwego Stripe (nasz trial z rejestracji, dawne `sim_*`):
    // nowy plan tylko przez Checkout, planId zmienia confirm po opłaceniu —
    // ten sam wiersz, bez drugiego.

    // Dostęp z wszystkich wierszy salonu (ta sama reguła co bramki):
    // pełny dostęp z wiersza canceled/past_due z prawdziwą subskrypcją Stripe
    // znaczy, że nowy Checkout założyłby drugą subskrypcję w Stripe, gdy
    // dostęp z pierwszej jeszcze trwa (canceled — druga opłata za te same
    // dni; past_due — stara subskrypcja w Stripe nie jest zakończona). Warunek
    // i termin liczy `purchaseBlock`; odmawiamy do `block.until` (termin
    // pełnego dostępu), bez wywołania Stripe i bez zapisu.
    const accessRows = await forSalon(salonId).raw(async (tx) => {
      const all = await tx
        .select({
          subscription: salonSubscriptions,
          plan: subscriptionPlans,
        })
        .from(salonSubscriptions)
        .innerJoin(
          subscriptionPlans,
          eq(salonSubscriptions.planId, subscriptionPlans.id),
        )
        .where(eq(salonSubscriptions.salonId, salonId))
        .orderBy(desc(salonSubscriptions.createdAt), desc(salonSubscriptions.id));
      return all.map(({ subscription, plan: rowPlan }) => ({
        ...toSalonPurchaseAccessRow(subscription, rowPlan.slug),
        id: subscription.id,
      }));
    });
    const block = purchaseBlock(accessRows, new Date());
    if (block) {
      const untilText = warsawDate.format(block.until);
      return NextResponse.json(
        {
          success: false,
          code: "PURCHASE_BLOCKED_UNTIL_PERIOD_END",
          until: block.until.toISOString(),
          error:
            block.state === "canceled"
              ? `Subskrypcja jest anulowana, ale dostęp trwa do ${untilText}. Nowy zakup będzie możliwy po tym terminie.`
              : `Płatność za subskrypcję jest zaległa. Nowy zakup będzie możliwy po ${untilText}. W sprawie zaległej płatności skontaktuj się z obsługą.`,
        },
        { status: 409 },
      );
    }

    // Attempt to create a real Stripe Checkout Session
    const stripe = getStripe();
    if (!stripe) {
      logger.warn("Subscription checkout refused: Stripe not configured", {
        planSlug: plan.slug,
      });
      return stripeUnavailableResponse();
    }

    // Identyfikator ceny Stripe kupowanego planu. Na hostingu (Vercel, Cloud
    // Run) bez niego trasa odmawia tutaj: przed odczytami subskrypcji w Stripe,
    // bez sesji Checkout i bez zapisu. Poza hostingiem cena powstaje w żądaniu
    // (niżej).
    const priceId = getStripePriceId(plan.slug);
    const platform = hostingPlatform();
    if (!priceId && platform) {
      logger.error("Subscription checkout refused: Stripe price not configured on hosting", {
        planSlug: plan.slug,
        platform,
      });
      return NextResponse.json(
        {
          success: false,
          code: "STRIPE_PRICE_NOT_CONFIGURED",
          error:
            "Zakup planu jest chwilowo niedostępny. Nic nie zostało pobrane — spróbuj ponownie później.",
        },
        { status: 503 },
      );
    }

    // Poprzednie subskrypcje Stripe salonu: wiersze z prawdziwą subskrypcją
    // Stripe i statusem innym niż trialing/active (z odczytu wszystkich
    // wierszy wyżej, każde id raz). Stan każdej czytamy wprost ze Stripe,
    // równolegle, bez blokady i poza transakcją. Nowy Checkout tylko wtedy,
    // gdy każda jest w stanie końcowym (`canceled`/`incomplete_expired`);
    // zaplanowane anulowanie (`cancel_at_period_end`) nim nie jest. Brak
    // subskrypcji w Stripe (`resource_missing`) = zakończona. Każdy inny błąd
    // odczytu → 503, bez sesji.
    const previousStripeSubscriptions = new Map<string, string>();
    for (const row of accessRows) {
      if (
        row.stripeSubscriptionId &&
        hasRealStripeSubscription(row.stripeSubscriptionId) &&
        !isCurrentLocalStatus(row.status) &&
        !previousStripeSubscriptions.has(row.stripeSubscriptionId)
      ) {
        previousStripeSubscriptions.set(row.stripeSubscriptionId, row.id);
      }
    }
    if (previousStripeSubscriptions.size > 0) {
      let liveSubscriptions: {
        subscriptionId: string;
        stripeSubscriptionId: string;
        stripeStatus: string;
        cancelAtPeriodEnd: boolean;
      }[];
      try {
        const states = await Promise.all(
          [...previousStripeSubscriptions].map(async ([stripeSubscriptionId, subscriptionId]) => {
            try {
              const stripeSub = await retrieveStripeSubscriptionLocked(stripe, stripeSubscriptionId);
              return {
                subscriptionId,
                stripeSubscriptionId,
                ended: isStripeSubscriptionEnded(stripeSub.status),
                stripeStatus: stripeSub.status,
                cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
              };
            } catch (retrieveError) {
              if (
                typeof retrieveError === "object" &&
                retrieveError !== null &&
                (retrieveError as { code?: unknown }).code === "resource_missing"
              ) {
                logger.warn("Subscription checkout: previous Stripe subscription not found in Stripe, treated as ended", {
                  subscriptionId,
                  stripeSubscriptionId,
                });
                return { subscriptionId, stripeSubscriptionId, ended: true, stripeStatus: "", cancelAtPeriodEnd: false };
              }
              throw retrieveError;
            }
          }),
        );
        liveSubscriptions = states.filter((s) => !s.ended);
      } catch (stripeError) {
        logger.error("Subscription checkout refused: Stripe subscription read failed", {
          error: stripeError instanceof Error ? stripeError.message : stripeError,
          planSlug: plan.slug,
        });
        return stripeUnavailableResponse();
      }
      if (liveSubscriptions.length > 0) {
        for (const live of liveSubscriptions) {
          logger.error("Subscription checkout refused: previous Stripe subscription still live, manual handling", {
            subscriptionId: live.subscriptionId,
            stripeSubscriptionId: live.stripeSubscriptionId,
            stripeStatus: live.stripeStatus,
            cancelAtPeriodEnd: live.cancelAtPeriodEnd,
          });
        }
        return NextResponse.json(
          {
            success: false,
            code: "PURCHASE_BLOCKED_STRIPE_SUBSCRIPTION_LIVE",
            error:
              "Poprzednia subskrypcja jest jeszcze otwarta w systemie płatności. Nowy zakup będzie możliwy po jej zamknięciu. Jeśli to się przedłuża, skontaktuj się z obsługą.",
          },
          { status: 409 },
        );
      }
    }

    try {
      // Price: the purchased plan's Stripe price ID, or (only off hosting —
      // on hosting the route refused above) a price created in the request
      let lineItem: {
        price?: string;
        price_data?: {
          currency: string;
          product_data: { name: string; description: string };
          unit_amount: number;
          recurring: { interval: "month" };
        };
        quantity: number;
      };

      if (priceId) {
        lineItem = { price: priceId, quantity: 1 };
      } else {
        // Price created in the request: gross amount in grosze from the
        // plan's net monthly price (e.g. "49.00" → 6027)
        const unitAmount = grossGrosze(plan.priceMonthly);
        lineItem = {
          price_data: {
            currency: "pln",
            product_data: {
              name: `MyHelper ${plan.name}`,
              description: `Subskrypcja miesięczna planu ${plan.name}`,
            },
            unit_amount: unitAmount,
            recurring: { interval: "month" },
          },
          quantity: 1,
        };
      }

      const origin =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

      const checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [lineItem],
        success_url: `${origin}/dashboard/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        customer_email: user.email,
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
        metadata: {
          salonId: salonId,
          planId: plan.id,
          planSlug: plan.slug,
          userId: user.id,
        },
      });

      logger.info("Stripe Checkout session created", {
        sessionId: checkoutSession.id,
        planSlug: plan.slug,
      });

      return NextResponse.json({
        success: true,
        url: checkoutSession.url,
      });
    } catch (stripeError) {
      logger.error("Stripe Checkout creation failed", {
        error: stripeError instanceof Error ? stripeError.message : stripeError,
        planSlug: plan.slug,
      });
      return NextResponse.json(
        {
          success: false,
          code: "STRIPE_ERROR",
          error:
            "Nie udało się połączyć z systemem płatności. Plan nie został zmieniony — spróbuj ponownie później.",
        },
        { status: 502 },
      );
    }
  } catch (error) {
    logger.error("Subscription checkout error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie utworzyc sesji platnosci" },
      { status: 500 },
    );
  }
}
