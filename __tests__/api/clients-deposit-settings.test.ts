/**
 * GET /api/clients/deposit-settings — P1 (audyt bezpieczeństwa): IDOR.
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

// Domyslnie konto ze zweryfikowanym e-mailem; "missing" odwzorowuje brak
// pola emailVerified w obiekcie sesji.
function loggedInAs(
  email: string | null,
  emailVerified: boolean | null | "missing" = true
) {
  const user =
    emailVerified === "missing"
      ? { id: "user-a", email }
      : { id: "user-a", email, emailVerified };
  mockRequireAuth.mockResolvedValue({ session: { user }, user });
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
    // requireDeposit maskowane przy wyłączonym zadatku (blok niżej).
    expect(body.data).toEqual({
      found: true,
      requireDeposit: false,
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

/**
 * Strażnik verifiedClientMatchEmail (PR #31): dopasowanie konta z sesji do
 * `clients` po e-mailu tylko przy emailVerified === true. Konto założone na
 * cudzy adres (bez potwierdzenia) nie może odczytać ustawień zadatku osoby,
 * której rekord personel założył z tym e-mailem. Inaczej => „nie znaleziono”.
 */
describe("GET /api/clients/deposit-settings — tylko zweryfikowany e-mail sesji", () => {
  const notFound = {
    found: false,
    requireDeposit: false,
    depositType: null,
    depositValue: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
  });

  it("zweryfikowany e-mail => szuka po e-mailu sesji i zwraca ustawienia", async () => {
    loggedInAs(EMAIL_A, true);
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(emailsQueried()).toEqual([EMAIL_A]);
    expect((body.data as { found: boolean }).found).toBe(true);
  });

  it("niezweryfikowany e-mail => 200 found:false, bez wyszukiwania klienta", async () => {
    loggedInAs(EMAIL_B, false);
    // gdyby trasa szukala klienta, baza zwrocilaby rekord osoby B
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.data).toEqual(notFound);
    expect(emailsQueried()).toEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("emailVerified: null => 200 found:false, bez wyszukiwania klienta", async () => {
    loggedInAs(EMAIL_B, null);
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.data).toEqual(notFound);
    expect(emailsQueried()).toEqual([]);
  });

  it("brak flagi emailVerified w sesji => 200 found:false, bez wyszukiwania klienta", async () => {
    loggedInAs(EMAIL_B, "missing");
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.data).toEqual(notFound);
    expect(emailsQueried()).toEqual([]);
  });

  it("zweryfikowany, ale pusty e-mail => 200 found:false, bez wyszukiwania klienta", async () => {
    loggedInAs("   ", true);
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.data).toEqual(notFound);
    expect(emailsQueried()).toEqual([]);
  });

  it("niezweryfikowany e-mail, salon nie istnieje => 404 (strażnik nie maskuje 404)", async () => {
    loggedInAs(EMAIL_B, false);
    selectResults.push([]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(404);
    expect(emailsQueried()).toEqual([]);
  });

  it("brak sesji => 401, bez zapytan do bazy", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

/**
 * Zadatek wyłączony (`isDepositEnabled()` = false, rejestr prawdziwy): klient
 * z `require_deposit = true` zapisanym wcześniej dostaje `requireDeposit:
 * false`, więc portal i stare PWA nie wołają /api/deposits/create-session.
 */
describe("GET /api/clients/deposit-settings — zadatek wyłączony", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
    loggedInAs(EMAIL_A);
  });

  it("rejestr flag jest prawdziwy: isDepositEnabled() = false", async () => {
    const { isDepositEnabled } = await import("@/lib/features");
    expect(isDepositEnabled()).toBe(false);
  });

  it("klient z require_deposit w bazie => 200, requireDeposit: false", async () => {
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse<{ success: boolean; data: Record<string, unknown> }>(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.requireDeposit).toBe(false);
    expect(body.data.found).toBe(true);
  });

  it("maskowanie nie dokłada pól (nadal bez clientId i imienia)", async () => {
    selectResults.push([{ id: SALON_UUID }], [clientB]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { body } = await parseResponse<{ data: Record<string, unknown> }>(res);

    expect(Object.keys(body.data).sort()).toEqual(["depositType", "depositValue", "found", "requireDeposit"]);
    expect(JSON.stringify(body)).not.toContain("Barbara");
    expect(JSON.stringify(body)).not.toContain(CLIENT_B_UUID);
  });

  it("klient nieznaleziony => 200, requireDeposit: false", async () => {
    selectResults.push([{ id: SALON_UUID }], []);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse<{ data: Record<string, unknown> }>(res);

    expect(status).toBe(200);
    expect(body.data).toEqual({ found: false, requireDeposit: false, depositType: null, depositValue: null });
  });

  it("salon nie istnieje => 404 (maskowanie nie zamienia 404 na 200)", async () => {
    selectResults.push([]);

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(404);
  });

  it("salonId niebedacy UUID => 400", async () => {
    const res = await GET(createMockRequest(url("salonId=nie-uuid")));
    expect(res.status).toBe(400);
  });

  it("brak sesji => 401", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));

    expect(res.status).toBe(401);
  });

  it("błąd bazy => 500 bez szczegółów", async () => {
    mockSelect.mockImplementationOnce(() => {
      throw new Error("connection terminated");
    });

    const res = await GET(createMockRequest(url(`salonId=${SALON_UUID}`)));
    const { status, body } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(500);
    expect(body.error).toBe("Failed to fetch client deposit settings");
    expect(JSON.stringify(body)).not.toContain("connection terminated");
  });
});
