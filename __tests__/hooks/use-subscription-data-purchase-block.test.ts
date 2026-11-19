import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSubscriptionData } from "@/app/dashboard/subscription/_hooks/use-subscription-data";

// Termin odmowy nowego zakupu pochodzi z pola `purchaseBlockedUntil`
// odpowiedzi GET /api/subscriptions/current; brak pola oznacza null.

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const FIRST_UNTIL = "2026-12-19T12:00:00.000Z";
const SECOND_UNTIL = "2027-01-19T12:00:00.000Z";

const SUBSCRIPTION = {
  id: "sub-row-1",
  salonId: "salon-1",
  planId: "plan-pro",
  stripeSubscriptionId: "sub_1Real",
  stripeCustomerId: "cus_1",
  status: "canceled",
  trialEndsAt: null,
  currentPeriodStart: "2026-11-19T12:00:00.000Z",
  currentPeriodEnd: FIRST_UNTIL,
  canceledAt: "2026-11-10T12:00:00.000Z",
  scheduledPlanId: null,
  scheduledChangeAt: null,
  createdAt: "2026-10-19T12:00:00.000Z",
};

let currentBody: Record<string, unknown>;

function currentResponse(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    success: true,
    subscription: SUBSCRIPTION,
    plan: null,
    scheduledPlan: null,
    access: { state: "canceled", mode: "full", planSlug: "pro", until: FIRST_UNTIL },
    ...extra,
  };
}

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  let body: unknown = { success: true, data: [] };
  if (url === "/api/subscriptions/current") body = currentBody;
  else if (url === "/api/subscription-plans") body = { success: true, data: [] };
  else if (url === "/api/subscriptions/expiration-warning") body = { success: false };
  return new Response(JSON.stringify(body), { status: 200 });
});

beforeEach(() => {
  mockFetch.mockClear();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSubscriptionData — purchaseBlockedUntil z odpowiedzi serwera", () => {
  it("odpowiedź z polem ISO: hak zwraca tę wartość", async () => {
    currentBody = currentResponse({ purchaseBlockedUntil: FIRST_UNTIL });
    const { result } = renderHook(() => useSubscriptionData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.purchaseBlockedUntil).toBe(FIRST_UNTIL);
  });

  it("odpowiedź z polem null: hak zwraca null", async () => {
    currentBody = currentResponse({ purchaseBlockedUntil: null });
    const { result } = renderHook(() => useSubscriptionData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscription).not.toBeNull();
    expect(result.current.purchaseBlockedUntil).toBeNull();
  });

  it("odpowiedź bez pola: hak zwraca null", async () => {
    currentBody = currentResponse({});
    const { result } = renderHook(() => useSubscriptionData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscription).not.toBeNull();
    expect(result.current.purchaseBlockedUntil).toBeNull();
  });

  it("ponowne pobranie z inną wartością: hak zwraca nową wartość", async () => {
    currentBody = currentResponse({ purchaseBlockedUntil: FIRST_UNTIL });
    const { result } = renderHook(() => useSubscriptionData());

    await waitFor(() => expect(result.current.purchaseBlockedUntil).toBe(FIRST_UNTIL));

    currentBody = currentResponse({ purchaseBlockedUntil: SECOND_UNTIL });
    await act(async () => {
      await result.current.fetchSubscription();
    });

    expect(result.current.purchaseBlockedUntil).toBe(SECOND_UNTIL);
  });
});
