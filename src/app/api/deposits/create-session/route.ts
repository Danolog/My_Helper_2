import { NextResponse } from "next/server";
import { eq, and, not, lt, gt } from "drizzle-orm";
import { parseBody, depositCreateSessionSchema } from "@/lib/api-validation";
// ADR-001 sekcja 4: publiczna ścieżka rezerwacji gościa (brak sesji właściciela salonu) — świadomie surowe db
// eslint-disable-next-line no-restricted-imports
import { db } from "@/lib/db";
import { calculateExpectedDeposit } from "@/lib/deposit-calculation";
import {
  DEPOSIT_CHECK_UNAVAILABLE_MESSAGE,
  DEPOSIT_NOT_APPLICABLE_CODE,
  depositDecision,
} from "@/lib/deposit-guard";
import { logger } from "@/lib/logger";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { getSalonContext } from "@/lib/salon-context";
import { assertSalonRefs } from "@/lib/salon-refs";
import { timeBlocks } from "@/lib/schema";
import { appointments, depositPayments } from "@/lib/schema";
import { getOptionalSession } from "@/lib/session";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

/**
 * POST /api/deposits/create-session
 *
 * Creates a deposit payment session for a booking:
 * 1. Validates the slot (overlaps, time blocks), recomputes the deposit
 *    amount SERVER-SIDE (the body amount is only cross-checked — never
 *    trusted), and creates the appointment ("scheduled", depositPaid=false)
 *    + a pending depositPayments record in one transaction.
 * 2. When Stripe is configured: creates a real Stripe Checkout session
 *    (mode "payment", card/BLIK/P24) and returns its URL as `paymentUrl`.
 *    The payment is then confirmed exclusively by the signed Stripe webhook
 *    (`checkout.session.completed`).
 * 3. When Stripe is NOT configured and simulation is opted in (NODE_ENV=
 *    development, or ALLOW_PAYMENT_SIMULATION=1 off Vercel — CI E2E): returns
 *    `simulated: true` and a fake session id (otherwise: 503
 *    STRIPE_UNAVAILABLE, nothing saved) — the frontend then confirms via the dev-only
 *    /api/deposits/confirm endpoint.
 *
 * Slot lifecycle: an unpaid deposit appointment DOES block the slot while
 * the Checkout session is alive (so nobody can steal a slot mid-payment).
 * It is freed by cancelling the appointment on `checkout.session.expired` /
 * `async_payment_failed` (webhook) and by the cleanup cron
 * (/api/cron/cleanup-pending-deposits) as a backstop for lost webhooks.
 */
/**
 * Symulacja płatności (bez klucza Stripe) jest opt-in, nie opt-out:
 * - `NODE_ENV=development` (lokalny `pnpm dev`) → dozwolona;
 * - `ALLOW_PAYMENT_SIMULATION=1` → dozwolona, ale TYLKO poza Vercelem.
 *   Flaga jest ustawiana wyłącznie w krokach E2E workflow CI (serwer
 *   `pnpm start`, NODE_ENV=production) — nie w `.env*` ani w Vercelu.
 *   Na Vercelu (`VERCEL=1`, ustawiane przez platformę) flaga jest
 *   ignorowana i logowana jako błąd konfiguracji (druga bramka, Ethan).
 * Wszystko inne (production, test, preview, brak NODE_ENV) → 503.
 */
function isPaymentSimulationAllowed(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  if (process.env.ALLOW_PAYMENT_SIMULATION !== "1") return false;
  if (process.env.VERCEL === "1") {
    logger.error("[Deposits API] ALLOW_PAYMENT_SIMULATION=1 ignored on Vercel — remove the flag from this deployment");
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  // Rate limit: deposit payment creation is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  const session = await getOptionalSession();

  try {
    const body = await request.json();
    // P0: czytamy SPARSOWANE dane — schemat zamienia null/"" na undefined
    // (front wysyła clientId/variantId/guestEmail: null) i normalizuje
    // telefony. Surowe body omijało tę normalizację.
    const parsed = parseBody(depositCreateSessionSchema, body);
    if (!parsed.ok) {
      // Quinn: front pokazuje `error` w toaście — zamiast ogólnego
      // "Validation failed" pierwszy konkretny komunikat (np. za krótkie
      // imię). `details` bez zmian, `code` dla klientów maszynowych.
      const firstMessage = Object.values(parsed.error.details)[0];
      return NextResponse.json(
        { ...parsed.error, error: firstMessage ?? parsed.error.error, code: "VALIDATION_FAILED" },
        { status: 400 }
      );
    }
    const {
      salonId,
      clientId: bodyClientId,
      employeeId,
      serviceId,
      variantId,
      startTime,
      endTime,
      notes,
      depositAmount,
      paymentMethod,
      blikPhoneNumber,
      guestName,
      guestPhone,
      guestEmail,
    } = parsed.data;

    const bookedByUserId = session?.user?.id || null;

    // Guest validation: require name and phone when not logged in.
    // Format (trim, min. 2 znaki, telefon PL po normalizacji) sprawdził już
    // schemat — tu tylko obecność pól dla gościa.
    if (!session) {
      if (!guestName) {
        return NextResponse.json(
          { success: false, error: "Imię i nazwisko jest wymagane (min. 2 znaki)" },
          { status: 400 }
        );
      }
      if (!guestPhone) {
        return NextResponse.json(
          { success: false, error: "Podaj prawidłowy numer telefonu (9 cyfr)" },
          { status: 400 }
        );
      }
    }

    // NOTE: the "Blik P2P" mock flow (payment request sent to a phone number)
    // was removed — BLIK is now handled as a payment method inside Stripe
    // Checkout. The blikPhoneNumber column stays in the DB (no migration).

    // A deposit session is meaningless without a service (the deposit is
    // derived from the service price and settings).
    if (!serviceId) {
      return NextResponse.json(
        { success: false, error: "serviceId jest wymagany dla platnosci zadatku" },
        { status: 400 }
      );
    }

    // #69/Ethan: brak klucza Stripe → 503, nic nie zapisane — chyba że
    // symulacja jest jawnie dozwolona (isPaymentSimulationAllowed: dev albo
    // ALLOW_PAYMENT_SIMULATION=1 poza Vercelem). Sprawdzamy wyłącznie
    // obecność klucza, nigdy wartość.
    if (!isStripeConfigured() && !isPaymentSimulationAllowed()) {
      logger.error("[Deposits API] Stripe not configured and payment simulation not allowed — deposit booking refused");
      return NextResponse.json(
        {
          success: false,
          code: "STRIPE_UNAVAILABLE",
          error: "Płatności online są chwilowo niedostępne. Spróbuj ponownie później lub skontaktuj się z salonem.",
        },
        { status: 503 }
      );
    }

    // P1 (Ryan), wzorzec z #39: clientId wybiera WYLACZNIE personel TEGO
    // salonu. Gosc i klient portalu (jedyny front tej trasy) nie podpinaja
    // rekordu klienta — gosc jest opisany przez guestName/guestPhone/guestEmail.
    // Wczesniej wystarczylo znac id klienta salonu, by podpiac jego kartoteke.
    const staffCtx = session ? await getSalonContext() : null;
    const isSalonStaff = staffCtx?.salonId === salonId;
    const clientId: string | null = isSalonStaff && bodyClientId ? bodyClientId : null;
    if (!isSalonStaff && bodyClientId) {
      logger.warn("[Deposits API] Ignored client-supplied clientId (non-staff booking)", { salonId });
    }

    // P1 (Ryan): klient, pracownik i usluga musza nalezec do salonu — PRZED
    // sprawdzeniem kolizji i zapisem. Bez tego obcy employeeId dostawal wizyte
    // "scheduled", ktora blokowala jego termin w innym salonie przez czas
    // zycia sesji Checkout. Jeden, niezdradzajacy komunikat 400.
    const refsError = await assertSalonRefs(salonId, { clientId, employeeId, serviceId });
    if (refsError) return refsError;

    // SECURITY: recompute the deposit amount on the server from salon/service
    // /client settings + promotions. The body amount is only compared to
    // detect a manipulated or stale frontend value — the SERVER value is
    // stored and charged.
    // Błąd wyliczenia = 503 i nic nie zapisane (jak strażnik /api/appointments),
    // a nie ogólne 500 z catch na końcu trasy.
    let expected: Awaited<ReturnType<typeof calculateExpectedDeposit>>;
    try {
      expected = await calculateExpectedDeposit({
        salonId,
        serviceId,
        variantId: variantId ?? null,
        startTime: new Date(startTime),
        sessionUser: session?.user ?? null,
        guestEmail: guestEmail ?? null,
      });
    } catch (error) {
      logger.error("[Deposits API] Deposit calculation failed", { salonId, serviceId, error });
      return NextResponse.json(
        { success: false, error: DEPOSIT_CHECK_UNAVAILABLE_MESSAGE },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }

    if (!expected.ok) {
      return NextResponse.json(
        {
          success: false,
          error: expected.error === "service_not_found" ? "Service not found" : "Variant not found",
        },
        { status: 404 }
      );
    }

    // Ta sama reguła co strażnik /api/appointments (depositDecision, #67):
    // "none" (brak wymogu albo kwota ≤ 0 przy required) → 400
    // DEPOSIT_NOT_APPLICABLE, portal rezerwuje wtedy zwykłą ścieżką;
    // "error" (kwota NaN) → 503, nic nie zapisane.
    const decision = depositDecision(expected, { salonId, serviceId, variantId: variantId ?? null });
    if (decision.kind === "error") {
      return NextResponse.json(
        { success: false, error: DEPOSIT_CHECK_UNAVAILABLE_MESSAGE },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    if (decision.kind === "none") {
      return NextResponse.json(
        {
          success: false,
          error: "Zadatek nie jest wymagany dla tej rezerwacji",
          code: DEPOSIT_NOT_APPLICABLE_CODE,
        },
        { status: 400 }
      );
    }

    const requestedAmount = depositAmount;
    if (Math.abs(requestedAmount - decision.amount) > 0.01) {
      logger.warn("Deposit amount mismatch — request rejected", {
        salonId,
        serviceId,
        requestedAmount,
        expectedAmount: decision.amount,
      });
      return NextResponse.json(
        {
          success: false,
          error: "Nieprawidlowa kwota zadatku. Odswiez strone i sprobuj ponownie.",
        },
        { status: 400 }
      );
    }

    const depositAmountValue = decision.amount;
    const serviceName = expected.serviceName;

    // Check for overlapping appointments for this employee. Correct overlap
    // condition: newStart < existing.end AND newEnd > existing.start — pure
    // boundary touches (e.g. 11:00-12:00 right after 10:00-11:00) do NOT
    // collide.
    const overlapping = await db.select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.employeeId, employeeId),
          not(eq(appointments.status, "cancelled")),
          lt(appointments.startTime, new Date(endTime)),
          gt(appointments.endTime, new Date(startTime))
        )
      );

    if (overlapping.length > 0) {
      return NextResponse.json(
        { success: false, error: "Wybrany termin jest juz zajety. Wybierz inny termin." },
        { status: 409 }
      );
    }

    // Check for vacation/time blocks that overlap (only need id for existence check)
    const conflictingBlocks = await db.select({ id: timeBlocks.id })
      .from(timeBlocks)
      .where(
        and(
          eq(timeBlocks.employeeId, employeeId),
          lt(timeBlocks.startTime, new Date(endTime)),
          gt(timeBlocks.endTime, new Date(startTime))
        )
      );

    if (conflictingBlocks.length > 0) {
      return NextResponse.json(
        { success: false, error: "Pracownik nie jest dostepny w wybranym terminie." },
        { status: 409 }
      );
    }

    // When Stripe is configured every payment (card/BLIK/P24) goes through
    // Stripe Checkout, so we normalize paymentMethod to "stripe" — refund.ts
    // only auto-refunds payments with paymentMethod === "stripe".
    const stripeConfigured = isStripeConfigured();

    // Create the appointment ("scheduled") + pending deposit payment
    // atomically — never one without the other.
    const { newAppointment, depositPayment } = await db.transaction(async (tx) => {
      const [appointment] = await tx
        .insert(appointments)
        .values({
          salonId,
          clientId: clientId || null,
          employeeId,
          serviceId: serviceId || null,
          variantId: variantId || null,
          bookedByUserId,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          notes: notes ?? null,
          depositAmount: String(depositAmountValue),
          depositPaid: false,
          status: "scheduled",
          guestName: guestName ?? null,
          guestPhone: guestPhone ?? null,
          guestEmail: guestEmail ?? null,
        })
        .returning();

      if (!appointment) {
        return { newAppointment: undefined, depositPayment: undefined };
      }

      const [payment] = await tx
        .insert(depositPayments)
        .values({
          appointmentId: appointment.id,
          salonId,
          amount: String(depositAmountValue),
          currency: "PLN",
          paymentMethod: stripeConfigured ? "stripe" : paymentMethod || "stripe",
          blikPhoneNumber: blikPhoneNumber || null,
          status: "pending",
        })
        .returning();

      return { newAppointment: appointment, depositPayment: payment };
    });

    if (!newAppointment || !depositPayment) {
      return NextResponse.json(
        { success: false, error: "Failed to create deposit payment record" },
        { status: 500 }
      );
    }

    // Real Stripe Checkout session (production path)
    const stripe = stripeConfigured ? getStripe() : null;
    if (stripe) {
      const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const customerEmail = session?.user?.email || guestEmail || undefined;

      try {
        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          // BLIK and Przelewy24 require PLN and must be enabled in the
          // Stripe Dashboard (Settings -> Payment methods).
          payment_method_types: ["card", "blik", "p24"],
          line_items: [
            {
              price_data: {
                currency: "pln",
                product_data: {
                  name: `Zadatek — ${serviceName}`,
                  description: "Zadatek za rezerwacje wizyty",
                },
                // Stripe expects the amount in grosze (cents)
                unit_amount: Math.round(depositAmountValue * 100),
              },
              quantity: 1,
            },
          ],
          metadata: {
            kind: "deposit",
            depositPaymentId: depositPayment.id,
            appointmentId: newAppointment.id,
            salonId,
          },
          // Session valid ~30 min (Stripe minimum is 30 min; +1 min for clock skew)
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          success_url: `${origin}/salons/${salonId}/book?deposit=success`,
          cancel_url: `${origin}/salons/${salonId}/book?deposit=cancelled`,
          ...(customerEmail ? { customer_email: customerEmail } : {}),
        });

        // There is no dedicated stripe_session_id column, so store the
        // Checkout session id (cs_...) in stripePaymentIntentId as a
        // reference. The webhook overwrites it with the real payment_intent
        // id (pi_...) on completion — refunds (refund.ts) only run on
        // "succeeded" payments, which always carry the pi_ id by then.
        await db
          .update(depositPayments)
          .set({ stripePaymentIntentId: checkoutSession.id })
          .where(eq(depositPayments.id, depositPayment.id));

        logger.info("Stripe Checkout session created for deposit", {
          sessionId: checkoutSession.id,
          appointmentId: newAppointment.id,
          depositPaymentId: depositPayment.id,
          amount: depositAmountValue,
        });

        return NextResponse.json({
          success: true,
          data: {
            sessionId: checkoutSession.id,
            appointmentId: newAppointment.id,
            depositPaymentId: depositPayment.id,
            amount: depositAmountValue,
            currency: "PLN",
            paymentMethod: "stripe",
            paymentUrl: checkoutSession.url,
            simulated: false,
          },
        }, { status: 201 });
      } catch (stripeError) {
        // Do NOT fall back to the dev simulation when Stripe is configured —
        // in production the appointment would stay unpayable and block the
        // slot. Clean up (cascade also removes the depositPayments row).
        logger.error("Stripe Checkout session creation failed for deposit", {
          error: stripeError instanceof Error ? stripeError.message : stripeError,
          appointmentId: newAppointment.id,
        });
        await db.delete(appointments).where(eq(appointments.id, newAppointment.id));
        return NextResponse.json(
          { success: false, error: "Nie udalo sie utworzyc sesji platnosci. Sprobuj ponownie." },
          { status: 502 }
        );
      }
    }

    // Dev fallback: Stripe not configured — return a simulated session that
    // the frontend confirms via the dev-only /api/deposits/confirm endpoint.
    const sessionId = `dep_session_${depositPayment.id}`;

    logger.info("Deposit payment session created (dev simulation, Stripe not configured)", {
      sessionId,
      appointmentId: newAppointment.id,
      amount: depositAmountValue,
      currency: "PLN",
      paymentMethod: paymentMethod || "stripe",
    });

    return NextResponse.json({
      success: true,
      data: {
        sessionId,
        appointmentId: newAppointment.id,
        depositPaymentId: depositPayment.id,
        amount: depositAmountValue,
        currency: "PLN",
        paymentMethod: paymentMethod || "stripe",
        paymentUrl: `/api/deposits/checkout?session=${sessionId}`,
        simulated: true,
      },
    }, { status: 201 });
  } catch (error) {
    logger.error("Deposit session creation failed", { error });
    return NextResponse.json(
      { success: false, error: "Failed to create deposit payment session" },
      { status: 500 }
    );
  }
}
