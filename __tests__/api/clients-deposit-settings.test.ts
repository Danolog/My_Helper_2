/**
 * GET /api/clients/deposit-settings — P1 (Ryan): IDOR.
 *
 * Trasa brala salonId i e-mail z zapytania i wymagala tylko zalogowania, wiec
 * dowolne konto dostawalo imie i nazwisko, clientId i ustawienia zadatku
 * dowolnej osoby w dowolnym salonie. Teraz e-mail pochodzi wylacznie z sesji,
 * a odpowiedz zawiera tylko pola potrzebne rezerwacji.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockRequest, parseResponse } from "./helpers";

const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const CLIENT_B_UUID = "33333333-3333-4333-8333-333333333333";
const EMAIL_A = "konto.a@example.com";
const EMAIL_B = "osoba.b@example.com";

// Kolejka wynikow kolejnych selectow (mock ignoruje where — o tym, czego trasa
// szuka, swiadcza argumenty eq()).
const selectResults: unknown[][] = [];
const mockSelect = vi.fn();

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "leftJoin"]) {
    c[m] = vi.fn(() => c);
  }
  c.then = (resolve: (v: unknown[]) => unknown) => resolve(selectResults.shift() ?? []);
  return c;
}

vi.mock("@/lib/server/repository", () => ({
  forSalon: vi.fn(() => ({
    raw: (fn: (tx: unknown) => unknown) =>
      fn({ select: (...args: unknown[]) => (mockSelect(...args), chain()) }),
  })),
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) => ({
    id: `${name}.id`,
    salonId: `${name}.salonId`,
    email: `${name}.email`,
    firstName: `${name}.firstName`,
    lastName: `${name}.lastName`,
    requireDeposit: `${name}.requireDeposit`,
    depositType: `${name}.depositType`,
    depositValue: `${name}.depositValue`,
  });
  return { clients: table("clients"), salons: table("salons") };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { eq } from "drizzle-orm";
import { GET } from "@/app/api/clients/deposit-settings/route";

const clientB = {
  id: CLIENT_B_UUID,
  firstName: "Barbara",
  lastName: "Bielska",
  requireDeposit: true,
  depositType: "fixed",
  depositValue: "50.00",
};

function loggedInAs(email: string | null) {
  mockRequireAuth.mockResolvedValue({
    session: { user: { id: "user-a", email } },
    user: { id: "user-a", email },
  });
}

function url(query: string) {
  return `http://localhost:3000/api/clients/deposit-settings?${query}`;
}

function emailsQueried(): unknown[] {
  return vi
    .mocked(eq)
    .mock.calls.filter(([col]) => (col as unknown) === "clients.email")
    .map(([, value]) => value);
}

describe("GET /api/clients/deposit-settings — e-mail tylko z sesji (P1 IDOR)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    loggedInAs(EMAIL_A);
  });

  it("konto A pytajace o e-mail osoby B nie dostaje jej danych (szuka po e-mailu z sesji)", async () => {
    // salon istnieje; rekord klienta zwrocony przez baze
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(
      createMockRequest(url(`salonId=${SALON_UUID}&email=${encodeURIComponent(EMAIL_B)}`))
    );
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(emailsQueried()).toEqual([EMAIL_A]);
    expect(emailsQueried()).not.toContain(EMAIL_B);
    expect(JSON.stringify(body)).not.toContain("Barbara");
    expect(JSON.stringify(body)).not.toContain(CLIENT_B_UUID);
  });

  it("odpowiedz zawiera tylko pola potrzebne rezerwacji (bez clientId i imienia)", async () => {
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.data).toEqual({
      found: true,
      requireDeposit: true,
      depositType: "fixed",
      depositValue: "50.00",
    });
  });

  it("e-mail w zapytaniu nie jest wymagany i jest ignorowany", async () => {
    selectResults.push([{ id: SALON_UUID }], []);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(200);
    expect(emailsQueried()).toEqual([EMAIL_A]);
  });

  it("brak sesji => 401, bez zapytan do bazy", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("salon nie istnieje => 404, bez wyszukiwania klienta", async () => {
    selectResults.push([]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(404);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(emailsQueried()).toEqual([]);
  });

  it("klient nie istnieje w salonie => 200 found:false z domyslnymi ustawieniami", async () => {
    selectResults.push([{ id: SALON_UUID }], []);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.data).toEqual({
      found: false,
      requireDeposit: false,
      depositType: null,
      depositValue: null,
    });
  });

  it("sesja bez e-maila => found:false, bez wyszukiwania klienta", async () => {
    loggedInAs(null);
    selectResults.push([{ id: SALON_UUID }]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect((body.data as { found: boolean }).found).toBe(false);
    expect(emailsQueried()).toEqual([]);
  });

  it("brak salonId => 400", async () => {
    const res = await GET(createMockRequest(url("")));
    expect(res.status).toBe(400);
  });

  it("salonId niebedacy UUID => 400, bez zapytan do bazy", async () => {
    const res = await GET(createMockRequest(url("salonId=nie-uuid")));
    expect(res.status).toBe(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
