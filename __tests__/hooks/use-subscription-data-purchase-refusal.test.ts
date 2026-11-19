import { renderHook, waitFor, act } from "@testing-library/react";
import { toast } from "sonner";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSubscriptionData } from "@/app/dashboard/subscription/_hooks/use-subscription-data";
import { mutationFetch } from "@/lib/api-client";

// Zakup planu w panelu: po odpowiedzi 409 trasy zakupu komunikat z tekstem
// trasy i ponowne pobranie bieżącej subskrypcji; przy innych błędach
// i po sukcesie bez ponownego pobrania.

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const FIRST_UNTIL = "2026-12-19T12:00:00.000Z";
const SECOND_UNTIL = "2027-01-19T12:00:00.000Z";
const ROUTE_ERROR = "Tekst odmowy z trasy zakupu.";
const FALLBACK_ERROR = "Nie udalo sie zmienic planu";
const EXCEPTION_ERROR = "Wystapil blad podczas zmiany planu";

const SUBSCRIPTION = {
  id: "sub-row-1",
  salonId: "salon-1",
  planId: "plan-basic",
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

let purchaseBlockedUntilInResponse: string | null;

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  let body: unknown = { success: true, data: [] };
  if (url === "/api/subscriptions/current") {
    body = {
      success: true,
      subscription: SUBSCRIPTION,
      plan: null,
      scheduledPlan: null,
      access: { state: "canceled", mode: "full", planSlug: "basic", until: FIRST_UNTIL },
      purchaseBlockedUntil: purchaseBlockedUntilInResponse,
    };
  } else if (url === "/api/subscriptions/expiration-warning") {
    body = { success: false };
  }
  return new Response(JSON.stringify(body), { status: 200 });
});

function currentFetchCount(): number {
  return mockFetch.mock.calls.filter(([u]) => String(u) === "/api/subscriptions/current").length;
}

function checkoutResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function renderLoaded() {
  const hook = renderHook(() => useSubscriptionData());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(currentFetchCount()).toBe(1);
  return hook;
}

const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  purchaseBlockedUntilInResponse = FIRST_UNTIL;
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});

describe("useSubscriptionData — zakup planu a odpowiedź trasy zakupu", () => {
  it("409 z error: toast.error z dokładnym tekstem trasy, drugie pobranie bieżącej subskrypcji i purchaseBlockedUntil z drugiej odpowiedzi", async () => {
    const { result } = await renderLoaded();
    expect(result.current.purchaseBlockedUntil).toBe(FIRST_UNTIL);

    vi.mocked(mutationFetch).mockResolvedValueOnce(
      checkoutResponse(409, { success: false, code: "PURCHASE_BLOCKED_UNTIL_PERIOD_END", error: ROUTE_ERROR }),
    );
    purchaseBlockedUntilInResponse = SECOND_UNTIL;

    await act(async () => {
      await result.current.handleChangePlan("pro");
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(ROUTE_ERROR);
    expect(currentFetchCount()).toBe(2);
    expect(result.current.purchaseBlockedUntil).toBe(SECOND_UNTIL);
    expect(result.current.changePlanLoading).toBe(false);
  });

  it("409 bez error: toast.error z tekstem zastępczym i drugie pobranie bieżącej subskrypcji", async () => {
    const { result } = await renderLoaded();

    vi.mocked(mutationFetch).mockResolvedValueOnce(checkoutResponse(409, { success: false }));

    await act(async () => {
      await result.current.handleChangePlan("pro");
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(FALLBACK_ERROR);
    expect(currentFetchCount()).toBe(2);
  });

  it("502 z error: toast.error z tekstem trasy, bez drugiego pobrania bieżącej subskrypcji", async () => {
    const { result } = await renderLoaded();

    vi.mocked(mutationFetch).mockResolvedValueOnce(
      checkoutResponse(502, { success: false, error: ROUTE_ERROR }),
    );

    await act(async () => {
      await result.current.handleChangePlan("pro");
    });

    expect(toast.error).toHaveBeenCalledWith(ROUTE_ERROR);
    expect(currentFetchCount()).toBe(1);
    expect(result.current.changePlanLoading).toBe(false);
  });

  it("200 z url: przejście pod url, bez komunikatu o błędzie i bez drugiego pobrania bieżącej subskrypcji", async () => {
    const { result } = await renderLoaded();
    const location = { href: "" };
    Object.defineProperty(window, "location", {
      value: location,
      writable: true,
      configurable: true,
    });

    vi.mocked(mutationFetch).mockResolvedValueOnce(
      checkoutResponse(200, { success: true, url: "https://checkout.example.test/session" }),
    );

    await act(async () => {
      await result.current.handleChangePlan("pro");
    });

    expect(location.href).toBe("https://checkout.example.test/session");
    expect(toast.error).not.toHaveBeenCalled();
    expect(currentFetchCount()).toBe(1);
  });

  it("wyjątek przy wywołaniu trasy zakupu: toast.error z komunikatem o błędzie, bez drugiego pobrania bieżącej subskrypcji", async () => {
    const { result } = await renderLoaded();

    vi.mocked(mutationFetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await act(async () => {
      await result.current.handleChangePlan("pro");
    });

    expect(toast.error).toHaveBeenCalledWith(EXCEPTION_ERROR);
    expect(currentFetchCount()).toBe(1);
    expect(result.current.changePlanLoading).toBe(false);
  });
});
