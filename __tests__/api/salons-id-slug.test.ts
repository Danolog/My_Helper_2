/**
 * PUT /api/salons/[id]/slug — zmiana krótkiego adresu salonu `/s/<slug>`.
 *
 * Kontrakt: 401 bez sesji, 400 zły id / zły slug / zły JSON, 404 brak salonu,
 * 403 nie właściciel, 409 SLUG_TAKEN (23505 na salons_slug_uq), 500 inny błąd,
 * 200 z zapisanym slugiem. Dostęp tylko przez forSalon(id z URL) — atrapa
 * repozytorium sprawdza, że każde zapytanie biegnie w kontekście tego salonu.
 */
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, createRouteParams, parseResponse } from "./helpers";

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_A = "user-owner-a";
const OTHER_USER = "user-other";

type SalonRow = { id: string; ownerId: string | null };

const state = vi.hoisted(() => ({
  salons: [] as { id: string; ownerId: string | null }[],
  /** Błąd rzucany przez UPDATE (null = zapis się udaje). */
  updateError: null as unknown,
  /** Błąd rzucany przez SELECT własności (null = odczyt się udaje). */
  selectError: null as unknown,
  forSalonIds: [] as string[],
  updates: [] as { set: unknown; where: unknown }[],
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ type: "eq", args }),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, col) => (col === "_table" ? name : typeof col === "symbol" ? undefined : `${name}.${String(col)}`) });
  return { salons: table("salons") };
});

vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => {
    state.forSalonIds.push(salonId);
    return {
      raw: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({
            from: () => ({
              where: (w: { args: unknown[] }) => {
                if (state.selectError) return Promise.reject(state.selectError);
                const id = w.args[1];
                return Promise.resolve(state.salons.filter((s: SalonRow) => s.id === id));
              },
            }),
          }),
          update: () => ({
            set: (set: unknown) => ({
              where: (where: unknown) => {
                if (state.updateError) return Promise.reject(state.updateError);
                state.updates.push({ set, where });
                return Promise.resolve([]);
              },
            }),
          }),
        };
        return fn(tx);
      },
    };
  },
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PUT } from "@/app/api/salons/[id]/slug/route";

function put(id: string, body: unknown) {
  return PUT(
    createMockRequest(`http://localhost:3000/api/salons/${id}/slug`, { method: "PUT", body }),
    createRouteParams(id)
  ).then(parseResponse);
}

function signInAs(userId: string) {
  mockRequireAuth.mockResolvedValue({ session: { user: { id: userId } }, user: { id: userId } });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.salons = [{ id: SALON_A, ownerId: OWNER_A }];
  state.updateError = null;
  state.selectError = null;
  state.forSalonIds = [];
  state.updates = [];
  signInAs(OWNER_A);
});

describe("PUT /api/salons/[id]/slug", () => {
  it("200: właściciel zmienia adres; zapis tylko kolumny slug, w kontekście swojego salonu", async () => {
    const { status, body } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: { slug: "salon-ada" } });
    expect(state.updates).toEqual([
      { set: { slug: "salon-ada" }, where: { type: "eq", args: ["salons.id", SALON_A] } },
    ]);
    expect(state.forSalonIds.every((id) => id === SALON_A)).toBe(true);
  });

  it("200: spacje na brzegach i wielkie litery poprawione przed zapisem", async () => {
    const { status, body } = await put(SALON_A, { slug: "  Salon-ADA  " });

    expect(status).toBe(200);
    expect(body.data).toEqual({ slug: "salon-ada" });
    expect(state.updates[0]!.set).toEqual({ slug: "salon-ada" });
  });

  it("401: bez sesji — bez zapytań", async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }));

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(401);
    expect(state.forSalonIds).toEqual([]);
  });

  it("400: id salonu nie jest UUID — bez zapytań", async () => {
    const { status } = await put("not-a-uuid", { slug: "salon-ada" });

    expect(status).toBe(400);
    expect(state.forSalonIds).toEqual([]);
  });

  it.each([
    ["za krótki", "ab"],
    ["za długi", "x".repeat(51)],
    ["podkreślnik", "salon_ada"],
    ["polskie znaki", "sałon-ada"],
    ["myślnik na końcu", "salon-"],
    ["podwójny myślnik", "salon--ada"],
    ["słowo zastrzeżone", "admin"],
    ["słowo zastrzeżone (dashboard)", "dashboard"],
  ])("400: %s (%s) — bez zapisu, komunikat w details.slug", async (_name, slug) => {
    const { status, body } = await put(SALON_A, { slug });

    expect(status).toBe(400);
    expect((body.details as Record<string, string>).slug).toBeTruthy();
    expect(state.updates).toEqual([]);
  });

  it.each([
    ["brak pola", {}],
    ["nie napis", { slug: 123 }],
    ["null", { slug: null }],
  ])("400: %s — bez zapisu", async (_name, payload) => {
    const { status } = await put(SALON_A, payload);
    expect(status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("400: treść nie jest JSON-em", async () => {
    const request = new Request(`http://localhost:3000/api/salons/${SALON_A}/slug`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{nie-json",
    });
    const { status } = await PUT(request, createRouteParams(SALON_A)).then(parseResponse);
    expect(status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("403: zalogowany, ale nie właściciel salonu — bez zapisu", async () => {
    signInAs(OTHER_USER);

    const { status } = await put(SALON_A, { slug: "przejety-adres" });

    expect(status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("403: salon bez właściciela — bez zapisu", async () => {
    state.salons = [{ id: SALON_A, ownerId: null }];

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("404: salon nie istnieje", async () => {
    state.salons = [];

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(404);
    expect(state.updates).toEqual([]);
  });

  it("409 SLUG_TAKEN: adres zajęty przez inny salon (23505 na salons_slug_uq, opakowany)", async () => {
    state.updateError = Object.assign(new Error("db"), {
      cause: { code: "23505", constraint_name: "salons_slug_uq" },
    });

    const { status, body } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(409);
    expect(body.code).toBe("SLUG_TAKEN");
    expect(body.error).toContain("zajęty");
  });

  it("500: inny konflikt unikalności nie udaje zajętego adresu", async () => {
    state.updateError = Object.assign(new Error("db"), { code: "23505", constraint_name: "salons_owner_id_uq" });

    const { status } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(500);
  });

  it("500: błąd bazy przy odczycie własności, bez szczegółów błędu w odpowiedzi", async () => {
    state.selectError = new Error("connection refused 10.0.0.5");

    const { status, body } = await put(SALON_A, { slug: "salon-ada" });

    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });
});
