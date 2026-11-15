/**
 * K-1 (warunek Olivera): webhook Stripe bez STRIPE_WEBHOOK_SECRET odrzuca
 * KAŻDE żądanie (fail-closed). Na Cloud Run sekret `stripe-webhook-secret`
 * jest opcjonalny: bez wersji run-deploy.sh go nie mapuje, więc zmiennej
 * w usłudze po prostu nie ma.
 *
 * W odróżnieniu od stripe-webhook.test.ts NIE mockujemy `@/lib/stripe`
 * ani pakietu `stripe`: decyzja zapada na prawdziwym `isStripeWebhookConfigured`
 * i prawdziwym kliencie (STRIPE_SECRET_KEY ustawiony), a podpis w żądaniu jest
 * poprawnie policzony dla pustego sekretu — i tak musi zostać odrzucony.
 * Baza i logika płatności są mockami, żeby wykryć jakiekolwiek przetwarzanie.
 */
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const touched = vi.fn();
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, p) => (touched(`db.${String(p)}`), () => { throw new Error("db used"); }) }),
}));
vi.mock("@/lib/deposit-confirmation", () => ({ confirmDepositPayment: () => touched("confirmDepositPayment") }));
vi.mock("@/lib/subscription-confirmation", () => ({ confirmSubscriptionCheckout: () => touched("confirmSubscriptionCheckout") }));
vi.mock("@/lib/subscription-sync", () => ({
  subscriptionStateFromStripe: () => touched("subscriptionStateFromStripe"),
  withLockedStripeSubscriptionRow: () => touched("withLockedStripeSubscriptionRow"),
}));

const EVENTS = ["invoice.paid", "checkout.session.completed", "customer.subscription.updated", "checkout.session.async_payment_succeeded"];

async function post(headers: Record<string, string>, payload: string) {
  vi.resetModules();
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", headers, body: payload }));
}

describe("Stripe webhook bez STRIPE_WEBHOOK_SECRET — fail-closed (K-1)", () => {
  beforeEach(() => {
    touched.mockClear();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_not_a_real_key");
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const secret of [undefined, ""]) {
    it.each(EVENTS)(`sekret ${secret === undefined ? "nieustawiony" : "pusty"}: %s z poprawnym podpisem dla pustego sekretu → 503, nic nie przetworzone`, async (type) => {
      if (secret === undefined) vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);
      else vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
      const payload = JSON.stringify({ id: "evt_forged", object: "event", type, data: { object: { id: "x", metadata: { kind: "deposit" } } } });
      const signature = new Stripe("sk_test_not_a_real_key").webhooks.generateTestHeaderString({ payload, secret: "" });
      const res = await post({ "content-type": "application/json", "stripe-signature": signature }, payload);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Webhook not configured" });
      expect(touched).not.toHaveBeenCalled();
    });
  }

  it("bez nagłówka podpisu i z dowolną treścią → 503 (sprawdzenie konfiguracji przed czymkolwiek)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", undefined);
    for (const body of ["", "not json", JSON.stringify({ type: "invoice.paid" })]) {
      const res = await post({ "content-type": "application/json" }, body);
      expect(res.status).toBe(503);
    }
    expect(touched).not.toHaveBeenCalled();
  });

  it("kontrola: z ustawionym sekretem ten sam fałszywy podpis daje 400, nie 503 (test widzi różnicę)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_real_test_secret");
    const payload = JSON.stringify({ id: "evt_forged", object: "event", type: "invoice.paid", data: { object: {} } });
    const signature = new Stripe("sk_test_not_a_real_key").webhooks.generateTestHeaderString({ payload, secret: "" });
    const res = await post({ "content-type": "application/json", "stripe-signature": signature }, payload);
    expect(res.status).toBe(400);
    expect(touched).not.toHaveBeenCalled();
  });
});
