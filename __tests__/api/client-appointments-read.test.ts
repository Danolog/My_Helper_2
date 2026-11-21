import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as detailGET } from "@/app/api/client/appointments/[id]/route";
import { GET as listGET } from "@/app/api/client/appointments/route";
import { appointments, depositPayments, treatmentHistory } from "@/lib/schema";

// Portal klienta nie zwraca notatek personelu (appointments.notes) ani treści
// treatment_history (ADR-002 §2.5). Testy pilnują kluczy odpowiedzi i tego,
// że treatment_history w ogóle nie jest czytane.

const h = vi.hoisted(() => {
  const state = {
    fromCalls: [] as unknown[],
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
  db: { select: () => h.makeChain() },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => h.state.requireAuth(...args),
  isAuthError: (result: unknown) => result instanceof Response,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    expect(body.data).not.toHaveProperty("notes");
    expect(body.data.treatment).toBeNull();
    expect(body.data.depositPayment).not.toBeNull();
    expect(h.state.fromCalls).toEqual([appointments, depositPayments]);
  });

  it("200: wizyta scheduled — bez notes, treatment null", async () => {
    h.state.results.push([appointmentRow({ status: "scheduled" })]);
    const res = await detailRequest(APPOINTMENT_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
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
