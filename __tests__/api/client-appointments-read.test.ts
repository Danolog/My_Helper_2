import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as detailGET } from "@/app/api/client/appointments/[id]/route";
import { GET as listGET } from "@/app/api/client/appointments/route";
import { appointments, depositPayments, serviceVariants, treatmentHistory } from "@/lib/schema";

// Portal klienta nie zwraca notatek personelu (appointments.notes) ani treści
// treatment_history (ADR-002 §2.5). Testy pilnują kluczy odpowiedzi i tego,
// że treatment_history w ogóle nie jest czytane.

const h = vi.hoisted(() => {
  const state = {
    fromCalls: [] as unknown[],
    selectArgs: [] as unknown[],
    results: [] as Array<unknown[] | Error>,
    requireAuth: vi.fn(),
  };
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = (table: unknown) => {
      state.fromCalls.push(table);
      return chain;
    };
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => {
      const next = state.results.shift() ?? [];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    };
    return chain;
  };
  return { state, makeChain };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: (fields?: unknown) => {
      h.state.selectArgs.push(fields);
      return h.makeChain();
    },
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => h.state.requireAuth(...args),
  isAuthError: (result: unknown) => result instanceof Response,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Dokładne zbiory kluczy odpowiedzi — każde nowe pole wymaga świadomej zmiany testu.
const LIST_ITEM_KEYS = [
  "id",
  "salonId",
  "salonName",
  "salonAddress",
  "employeeName",
  "employeeColor",
  "serviceName",
  "servicePrice",
  "serviceDuration",
  "startTime",
  "endTime",
  "status",
  "depositAmount",
  "depositPaid",
  "createdAt",
];

const DETAIL_KEYS = [
  "id",
  "salonId",
  "salonName",
  "salonAddress",
  "salonPhone",
  "salonEmail",
  "employeeName",
  "employeeColor",
  "serviceName",
  "serviceDescription",
  "servicePrice",
  "serviceDuration",
  "variantName",
  "variantPriceModifier",
  "variantDurationModifier",
  "startTime",
  "endTime",
  "status",
  "depositAmount",
  "depositPaid",
  "createdAt",
  "treatment",
  "depositPayment",
];

const DEPOSIT_PAYMENT_KEYS = [
  "amount",
  "currency",
  "paymentMethod",
  "blikPhoneNumber",
  "status",
  "paidAt",
];

const VARIANT_SELECT_KEYS = ["name", "priceModifier", "durationModifier"];

const USER_ID = "user-1";
const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    appointment: {
      id: APPOINTMENT_ID,
      salonId: "22222222-2222-4222-8222-222222222222",
      startTime: new Date("2026-11-20T10:00:00Z"),
      endTime: new Date("2026-11-20T11:00:00Z"),
      status: "completed",
      notes: "notatka personelu",
      depositAmount: "0",
      depositPaid: false,
      variantId: null,
      createdAt: new Date("2026-11-01T10:00:00Z"),
      ...overrides,
    },
    employee: { firstName: "Anna", lastName: "Nowak", color: "#fff" },
    service: { name: "Strzyżenie", description: "opis", basePrice: "100", baseDuration: 60 },
    salon: { name: "Salon", address: "ul. Testowa 1", phone: "123", email: "salon@example.invalid" },
  };
}

function detailRequest(id: string) {
  return detailGET(new Request(`http://localhost/api/client/appointments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  h.state.fromCalls.length = 0;
  h.state.selectArgs.length = 0;
  h.state.results.length = 0;
  h.state.requireAuth.mockReset();
  h.state.requireAuth.mockResolvedValue({ session: {}, user: { id: USER_ID } });
});

describe("GET /api/client/appointments (lista)", () => {
  it("200: żaden element listy nie ma klucza notes", async () => {
    h.state.results.push([
      appointmentRow(),
      appointmentRow({ id: "33333333-3333-4333-8333-333333333333", status: "scheduled" }),
    ]);

    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    for (const item of body.data) {
      expect(Object.keys(item).sort()).toEqual([...LIST_ITEM_KEYS].sort());
      expect(item).not.toHaveProperty("notes");
      expect(item.id).toBeDefined();
      expect(item.status).toBeDefined();
    }
    expect(JSON.stringify(body)).not.toContain("notatka personelu");
  });

  it("200: pusta lista", async () => {
    h.state.results.push([]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("401: brak sesji", async () => {
    h.state.requireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );
    const res = await listGET();
    expect(res.status).toBe(401);
    expect(h.state.fromCalls).toHaveLength(0);
  });

  it("500: błąd bazy", async () => {
    h.state.results.push(new Error("db down"));
    const res = await listGET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe("GET /api/client/appointments/[id] (szczegół)", () => {
  it("200: wizyta completed — bez notes, treatment null, bez zapytania o treatment_history", async () => {
    h.state.results.push([appointmentRow()]);

    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual([...DETAIL_KEYS].sort());
    expect(body.data).not.toHaveProperty("notes");
    expect(body.data.treatment).toBeNull();
    expect(JSON.stringify(body)).not.toContain("notatka personelu");
    expect(h.state.fromCalls).not.toContain(treatmentHistory);
    expect(h.state.fromCalls).toEqual([appointments]);
  });

  it("200: wizyta completed z zadatkiem — treatment_history nadal nieczytane", async () => {
    h.state.results.push([appointmentRow({ depositAmount: "50" })]);
    h.state.results.push([
      {
        amount: "50",
        currency: "PLN",
        paymentMethod: "blik",
        blikPhoneNumber: null,
        status: "pending",
        paidAt: null,
      },
    ]);

    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual([...DETAIL_KEYS].sort());
    expect(body.data).not.toHaveProperty("notes");
    expect(body.data.treatment).toBeNull();
    // Dokładny kształt depositPayment pilnuje osobny test.
    expect(body.data.depositPayment).not.toBeNull();
    expect(h.state.fromCalls).toEqual([appointments, depositPayments]);
  });

  it("200: depositPayment — dokładny zbiór kluczy, bez identyfikatorów Stripe i powodu zwrotu", async () => {
    h.state.results.push([appointmentRow({ depositAmount: "50" })]);
    // Atrapa zwraca też kolumny zakazane — trasa nie może ich przepuścić.
    h.state.results.push([
      {
        id: "44444444-4444-4444-8444-444444444444",
        appointmentId: APPOINTMENT_ID,
        salonId: "22222222-2222-4222-8222-222222222222",
        amount: "50",
        currency: "PLN",
        paymentMethod: "stripe",
        blikPhoneNumber: null,
        stripePaymentIntentId: "pi_secret_value",
        stripeRefundId: "re_secret_value",
        status: "refunded",
        paidAt: new Date("2026-11-02T10:00:00Z"),
        refundedAt: new Date("2026-11-03T10:00:00Z"),
        refundReason: "powod zwrotu salonu",
        createdAt: new Date("2026-11-01T10:00:00Z"),
      },
    ]);

    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    const dp = body.data.depositPayment;
    expect(Object.keys(dp).sort()).toEqual([...DEPOSIT_PAYMENT_KEYS].sort());
    expect(dp).not.toHaveProperty("stripePaymentIntentId");
    expect(dp).not.toHaveProperty("stripeRefundId");
    expect(dp).not.toHaveProperty("refundReason");
    expect(dp.amount).toBe("50");
    expect(dp.status).toBe("refunded");
    const text = JSON.stringify(body);
    expect(text).not.toContain("pi_secret_value");
    expect(text).not.toContain("re_secret_value");
    expect(text).not.toContain("powod zwrotu salonu");

    // Zapytanie o płatność ma jawną listę kolumn (nie select() całego wiersza).
    const depositIdx = h.state.fromCalls.indexOf(depositPayments);
    expect(depositIdx).toBeGreaterThan(-1);
    const depositSelect = h.state.selectArgs[depositIdx] as Record<string, unknown> | undefined;
    expect(depositSelect).toBeDefined();
    expect(Object.keys(depositSelect!).sort()).toEqual([...DEPOSIT_PAYMENT_KEYS].sort());
    expect(depositSelect!.amount).toBe(depositPayments.amount);
    expect(depositSelect!.blikPhoneNumber).toBe(depositPayments.blikPhoneNumber);
  });

  it("200: wariant — tylko nazwa i modyfikatory, jawna lista kolumn w zapytaniu", async () => {
    const VARIANT_ID = "55555555-5555-4555-8555-555555555555";
    h.state.results.push([appointmentRow({ variantId: VARIANT_ID })]);
    h.state.results.push([
      {
        id: VARIANT_ID,
        serviceId: "66666666-6666-4666-8666-666666666666",
        name: "Długie włosy",
        priceModifier: "20",
        durationModifier: 15,
        createdAt: new Date("2026-10-01T10:00:00Z"),
      },
    ]);

    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual([...DETAIL_KEYS].sort());
    expect(body.data.variantName).toBe("Długie włosy");
    expect(body.data.variantPriceModifier).toBe("20");
    expect(body.data.variantDurationModifier).toBe(15);
    expect(JSON.stringify(body)).not.toContain("66666666-6666-4666-8666-666666666666");
    expect(h.state.fromCalls).toEqual([appointments, serviceVariants]);

    const variantSelect = h.state.selectArgs[1] as Record<string, unknown> | undefined;
    expect(variantSelect).toBeDefined();
    expect(Object.keys(variantSelect!).sort()).toEqual([...VARIANT_SELECT_KEYS].sort());
    expect(variantSelect!.name).toBe(serviceVariants.name);
    expect(variantSelect!.priceModifier).toBe(serviceVariants.priceModifier);
    expect(variantSelect!.durationModifier).toBe(serviceVariants.durationModifier);
  });

  it("200: wizyta scheduled — bez notes, treatment null", async () => {
    h.state.results.push([appointmentRow({ status: "scheduled" })]);
    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual([...DETAIL_KEYS].sort());
    expect(body.data).not.toHaveProperty("notes");
    expect(body.data.treatment).toBeNull();
  });

  it("400: niepoprawny format id", async () => {
    const res = await detailRequest("nie-uuid");
    expect(res.status).toBe(400);
    expect(h.state.fromCalls).toHaveLength(0);
  });

  it("401: brak sesji", async () => {
    h.state.requireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );
    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(401);
    expect(h.state.fromCalls).toHaveLength(0);
  });

  it("404: wizyta nie należy do użytkownika / nie istnieje", async () => {
    h.state.results.push([]);
    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(404);
  });

  it("500: błąd bazy", async () => {
    h.state.results.push(new Error("db down"));
    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
