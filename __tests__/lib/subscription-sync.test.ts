/**
 * `subscriptionStateFromStripe` — czysta funkcja: bieżący stan subskrypcji
 * w Stripe + wiersz `salon_subscriptions` → wartości do zapisania albo `null`.
 *
 * Przypina odwzorowanie stanu Stripe na stan lokalny (w tym `unpaid` →
 * `past_due`: reguła dostępu daje wierszowi `past_due` termin — koniec okresu
 * + 7 dni — a status `unpaid` zapisany w wierszu oznacza w niej od razu tylko
 * odczyt), wyliczenie `canceledAt` i `trialEndsAt`, brak okresu
 * rozliczeniowego w wyniku oraz regułę końcowego lokalnego `canceled`.
 * `isStripeSubscriptionEnded` — stany końcowe Stripe (`canceled`,
 * `incomplete_expired`).
 * Bez bazy: połączenie z bazą powstaje dopiero przy pierwszym zapytaniu,
 * a ta funkcja żadnego nie wykonuje.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";
import {
  isStripeSubscriptionEnded,
  subscriptionStateFromStripe,
  type StripeSubscriptionState,
  type SubscriptionRow,
} from "@/lib/subscription-sync";

const ROW_CREATED_AT = new Date("2026-10-01T10:00:00.000Z");
const ROW_CANCELED_AT = new Date("2026-10-15T12:00:00.000Z");
const STRIPE_CANCELED_AT = 1784000000;
const STRIPE_TRIAL_END = 1785000000;
const NOW = new Date("2026-11-19T09:30:00.000Z");

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "row-1",
    salonId: "salon-1",
    planId: "plan-1",
    stripeSubscriptionId: "sub_1",
    stripeCustomerId: "cus_1",
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    canceledAt: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
    createdAt: ROW_CREATED_AT,
    ...overrides,
  };
}

function stripeSub(overrides: Partial<StripeSubscriptionState> = {}): StripeSubscriptionState {
  return { id: "sub_1", status: "active", ...overrides };
}

const MAPPED: Array<[string, string]> = [
  ["active", "active"],
  ["trialing", "trialing"],
  ["past_due", "past_due"],
  ["unpaid", "past_due"],
  ["canceled", "canceled"],
  ["incomplete_expired", "canceled"],
];

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isStripeSubscriptionEnded", () => {
  it.each(["canceled", "incomplete_expired"])("Stripe %s → true", (stripeStatus) => {
    expect(isStripeSubscriptionEnded(stripeStatus)).toBe(true);
  });

  it.each([
    ["active", "active"],
    ["past_due", "past_due"],
    ["unpaid", "unpaid"],
    ["incomplete", "incomplete"],
    ["trialing", "trialing"],
    ["paused", "paused"],
    ["pusty status", ""],
    ["nieznany status", "ended"],
    ["null", null],
    ["brak statusu", undefined],
  ])("Stripe %s → false", (_label, stripeStatus) => {
    expect(isStripeSubscriptionEnded(stripeStatus)).toBe(false);
  });
});

describe("subscriptionStateFromStripe — odwzorowanie stanu Stripe", () => {
  it.each(MAPPED)(
    "Stripe %s → lokalnie %s dla wiersza lokalnie active, bez ostrzeżenia",
    (stripeStatus, localStatus) => {
      const result = subscriptionStateFromStripe(row(), stripeSub({ status: stripeStatus }));

      expect(result?.status).toBe(localStatus);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["incomplete", "incomplete"],
    ["paused", "paused"],
    ["pusty status", ""],
    ["brak statusu", undefined],
  ])(
    "Stripe %s bez odpowiednika → zostaje status z wiersza i logger.warn",
    (_label, stripeStatus) => {
      const result = subscriptionStateFromStripe(
        row({ status: "past_due" }),
        stripeStatus === undefined ? { id: "sub_1" } : stripeSub({ status: stripeStatus })
      );

      expect(result?.status).toBe("past_due");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "Stripe subscription status without local equivalent — keeping stored status",
        { stripeSubscriptionId: "sub_1", stripeStatus: stripeStatus ?? "", localStatus: "past_due" }
      );
    }
  );

  it("Stripe unpaid dla wiersza lokalnie past_due → past_due, canceledAt null", () => {
    const result = subscriptionStateFromStripe(
      row({ status: "past_due" }),
      stripeSub({ status: "unpaid" })
    );

    expect(result).toEqual({ status: "past_due", canceledAt: null });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("subscriptionStateFromStripe — canceledAt", () => {
  it("canceled_at ze Stripe (sekundy) → canceledAt jako Date", () => {
    const result = subscriptionStateFromStripe(
      row({ canceledAt: ROW_CANCELED_AT }),
      stripeSub({ status: "canceled", canceled_at: STRIPE_CANCELED_AT })
    );

    expect(result?.canceledAt).toEqual(new Date(STRIPE_CANCELED_AT * 1000));
  });

  it("stan końcowy bez canceled_at → canceledAt z wiersza", () => {
    const result = subscriptionStateFromStripe(
      row({ canceledAt: ROW_CANCELED_AT }),
      stripeSub({ status: "incomplete_expired" })
    );

    expect(result?.status).toBe("canceled");
    expect(result?.canceledAt).toEqual(ROW_CANCELED_AT);
  });

  it("stan końcowy bez canceled_at i bez canceledAt w wierszu → chwila bieżąca", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const result = subscriptionStateFromStripe(row(), stripeSub({ status: "canceled" }));

    expect(result?.status).toBe("canceled");
    expect(result?.canceledAt).toEqual(NOW);
  });

  it.each(["active", "trialing", "past_due", "unpaid"])(
    "stan niekońcowy (Stripe %s) bez canceled_at → canceledAt null mimo canceledAt w wierszu",
    (stripeStatus) => {
      const result = subscriptionStateFromStripe(
        row({ canceledAt: ROW_CANCELED_AT }),
        stripeSub({ status: stripeStatus })
      );

      expect(result?.canceledAt).toBeNull();
    }
  );
});

describe("subscriptionStateFromStripe — trialEndsAt", () => {
  it("lokalnie trialing i trial_end ze Stripe → trialEndsAt jako Date", () => {
    const result = subscriptionStateFromStripe(
      row({ status: "trialing" }),
      stripeSub({ status: "trialing", trial_end: STRIPE_TRIAL_END })
    );

    expect(result?.trialEndsAt).toEqual(new Date(STRIPE_TRIAL_END * 1000));
  });

  it("lokalnie trialing bez trial_end ze Stripe → brak klucza trialEndsAt", () => {
    const result = subscriptionStateFromStripe(
      row({ status: "trialing" }),
      stripeSub({ status: "trialing" })
    );

    expect(result).not.toBeNull();
    expect(Object.keys(result!)).not.toContain("trialEndsAt");
  });

  it.each(["active", "past_due", "unpaid", "canceled", "incomplete_expired"])(
    "Stripe %s (lokalnie nie trialing) z trial_end → brak klucza trialEndsAt",
    (stripeStatus) => {
      const result = subscriptionStateFromStripe(
        row(),
        stripeSub({ status: stripeStatus, trial_end: STRIPE_TRIAL_END })
      );

      expect(result).not.toBeNull();
      expect(Object.keys(result!)).not.toContain("trialEndsAt");
    }
  );
});

describe("subscriptionStateFromStripe — okres rozliczeniowy", () => {
  it.each(MAPPED.map(([stripeStatus]) => stripeStatus))(
    "Stripe %s → wynik bez currentPeriodStart i currentPeriodEnd",
    (stripeStatus) => {
      const result = subscriptionStateFromStripe(
        row(),
        stripeSub({ status: stripeStatus, canceled_at: STRIPE_CANCELED_AT, trial_end: STRIPE_TRIAL_END })
      );

      expect(result).not.toBeNull();
      expect(Object.keys(result!)).not.toContain("currentPeriodStart");
      expect(Object.keys(result!)).not.toContain("currentPeriodEnd");
    }
  );
});

describe("subscriptionStateFromStripe — wiersz lokalnie canceled", () => {
  const canceledRow = () => row({ status: "canceled", canceledAt: ROW_CANCELED_AT });

  it("Stripe canceled → null", () => {
    expect(subscriptionStateFromStripe(canceledRow(), stripeSub({ status: "canceled" }))).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("Stripe incomplete_expired → null", () => {
    expect(
      subscriptionStateFromStripe(canceledRow(), stripeSub({ status: "incomplete_expired" }))
    ).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("Stripe active z cancel_at_period_end: true → null", () => {
    expect(
      subscriptionStateFromStripe(
        canceledRow(),
        stripeSub({ status: "active", cancel_at_period_end: true })
      )
    ).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("Stripe active z cancel_at_period_end: false → active, canceledAt null i logger.error", () => {
    const result = subscriptionStateFromStripe(
      canceledRow(),
      stripeSub({ status: "active", cancel_at_period_end: false })
    );

    expect(result).toEqual({ status: "active", canceledAt: null });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Local subscription canceled but Stripe still renews it — syncing Stripe state, manual handling",
      { subscriptionId: "row-1", stripeSubscriptionId: "sub_1", stripeStatus: "active", cancelAtPeriodEnd: false }
    );
  });

  it("Stripe unpaid bez cancel_at_period_end → past_due i logger.error", () => {
    const result = subscriptionStateFromStripe(canceledRow(), stripeSub({ status: "unpaid" }));

    expect(result?.status).toBe("past_due");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Local subscription canceled but Stripe still renews it — syncing Stripe state, manual handling",
      { subscriptionId: "row-1", stripeSubscriptionId: "sub_1", stripeStatus: "unpaid", cancelAtPeriodEnd: null }
    );
  });
});
