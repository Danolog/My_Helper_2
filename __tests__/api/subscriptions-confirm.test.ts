/**
 * POST /api/subscriptions/confirm — brak Stripe to błąd, nie sukces.
 *
 * Przed poprawką, gdy Stripe nie był skonfigurowany, trasa zwracała
 * `{ success: true, alreadyConfirmed: true }` z komunikatem, że subskrypcja
 * „została utworzona podczas checkoutu” — nieprawda od PR #36 (checkout bez
 * Stripe nic nie tworzy). Strona sukcesu pokazywała wtedy „płatność
 * potwierdzona”, choć nic nie zapisano.
 *
 * Kontrakt po poprawce: brak Stripe → 503 STRIPE_UNAVAILABLE (ten sam kod
 * co checkout w PR #36), zero zapisów. Ścieżka Stripe bez zmian.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/subscriptions/confirm/route";

const {
  selectQueue,
  mockUpdate,
  mockInsert,
  mockTransaction,
  mockRequireAuth,
  mockIsAuthError,
  mockGetUserSalonId,
  mockGetStripe,
} = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockTransaction: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockIsAuthError: vi.fn(),
  mockGetUserSalonId: vi.fn(),
  mockGetStripe: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const selectChain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "where", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return builder;
  };
  // Zapis zwraca wiersz, żeby stary kod doszedł do końca i test pokazał
  // realny efekt (200 + zapis), a nie wyjątek z mocka.
  const writeChain = (spy: (...a: unknown[]) => unknown) => (...args: unknown[]) => {
    spy(...args);
    const builder: Record<string, unknown> = {};
    for (const method of ["set", "values", "where", "onConflictDoNothing"]) {
      builder[method] = (...a: unknown[]) => {
        spy(method, ...a);
        return builder;
      };
    }
    builder.returning = () => Promise.resolve([{ id: "row-written" }]);
    builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject);
    return builder;
  };
  const tx = {
    select: () => selectChain(),
    update: writeChain(mockUpdate),
    insert: writeChain(mockInsert),
  };
  return {
    db: {
      select: () => selectChain(),
      update: writeChain(mockUpdate),
      insert: writeChain(mockInsert),
      transaction: (fn: (t: typeof tx) => unknown) => {
        mockTransaction();
        return fn(tx);
      },
    },
  };
});

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => mockGetUserSalonId(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Atrapa klienta Stripe — zero wywołań sieciowych.
vi.mock("@/lib/stripe", () => ({
  getStripe: (...a: unknown[]) => mockGetStripe(...a),
}));

const PLAN_PRO = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  isActive: true,
};

function confirmRequest(body: unknown) {
  return new Request("http://localhost/api/subscriptions/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function expectNoWrites() {
  expect(mockTransaction).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockRequireAuth.mockResolvedValue({ user: { id: "owner-1" } });
  mockIsAuthError.mockReturnValue(false);
  mockGetUserSalonId.mockResolvedValue("salon-1");
  mockGetStripe.mockReturnValue(null);
});

describe("POST /api/subscriptions/confirm", () => {
  it("bez Stripe: 503 STRIPE_UNAVAILABLE zamiast fałszywego sukcesu, zero zapisów", async () => {
    selectQueue.push([]); // brak płatności z tym sessionId

    const res = await POST(confirmRequest({ sessionId: "cs_test_123" }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.code).toBe("STRIPE_UNAVAILABLE");
    expect(body).not.toHaveProperty("alreadyConfirmed");
    expectNoWrites();
  });

  it("ze Stripe, sesja opłacona: zapisuje subskrypcję i płatność (bez zmian)", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      payment_status: "paid",
      metadata: { salonId: "salon-1", planId: PLAN_PRO.id },
      subscription: "sub_stripe_1",
      customer: "cus_stripe_1",
    });
    mockGetStripe.mockReturnValue({ checkout: { sessions: { retrieve } } });
    selectQueue.push([]); // idempotencja: brak płatności
    selectQueue.push([PLAN_PRO]); // plan
    selectQueue.push([]); // brak aktywnej subskrypcji -> insert

    const res = await POST(confirmRequest({ sessionId: "cs_test_123" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(retrieve).toHaveBeenCalledWith("cs_test_123", expect.anything());
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalled();
  });

  it("ze Stripe, sesja nieopłacona: 400 i zero zapisów", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      payment_status: "unpaid",
      metadata: { salonId: "salon-1", planId: PLAN_PRO.id },
    });
    mockGetStripe.mockReturnValue({ checkout: { sessions: { retrieve } } });
    selectQueue.push([]);

    const res = await POST(confirmRequest({ sessionId: "cs_test_123" }));

    expect(res.status).toBe(400);
    expectNoWrites();
  });

  it("ze Stripe, błąd Stripe: 502 i zero zapisów", async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error("network"));
    mockGetStripe.mockReturnValue({ checkout: { sessions: { retrieve } } });
    selectQueue.push([]);

    const res = await POST(confirmRequest({ sessionId: "cs_test_123" }));

    expect(res.status).toBe(502);
    expectNoWrites();
  });

  it("brak sessionId: 400", async () => {
    const res = await POST(confirmRequest({}));

    expect(res.status).toBe(400);
    expectNoWrites();
  });

  it("niezalogowany: 401 i zero zapisów", async () => {
    mockRequireAuth.mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    mockIsAuthError.mockReturnValue(true);

    const res = await POST(confirmRequest({ sessionId: "cs_test_123" }));

    expect(res.status).toBe(401);
    expectNoWrites();
  });

  it("brak salonu: 404", async () => {
    mockGetUserSalonId.mockResolvedValue(null);

    const res = await POST(confirmRequest({ sessionId: "cs_test_123" }));

    expect(res.status).toBe(404);
  });
});
