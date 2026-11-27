/**
 * Portal klienta: /api/client/waiting-list i /api/client/waiting-list/[id].
 *
 * P1 (audyt bezpieczeństwa, ocena w #29): dopasowanie konta z sesji do rekordu `clients` po
 * e-mailu dziala tylko dla zweryfikowanego e-maila. Konto z niezweryfikowanym
 * e-mailem rownym e-mailowi klienta B nie moze widziec ani zmieniac wpisow B
 * na liscie oczekujacych (we wszystkich salonach).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { createMockRequest, parseResponse } from "./helpers";

const SALON_UUID = "11111111-1111-4111-8111-111111111111";
const CLIENT_B_UUID = "33333333-3333-4333-8333-333333333333";
const ENTRY_UUID = "55555555-5555-4555-8555-555555555555";
const EMAIL_B = "osoba.b@example.com";

// Kolejka wynikow kolejnych db.select(...) (mock ignoruje where/join).
const selectResults: unknown[][] = [];
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "select", "from", "where", "limit", "leftJoin", "innerJoin", "orderBy",
    "values", "returning", "set",
  ]) {
    c[m] = vi.fn(() => c);
  }
  c.then = (resolve: (v: unknown[]) => unknown) => resolve(result());
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return chain(() => selectResults.shift() ?? []);
    },
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return chain(() => [{ id: "new-row" }]);
    },
    delete: (...args: unknown[]) => {
      mockDelete(...args);
      return chain(() => [{ id: ENTRY_UUID }]);
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return chain(() => [{ id: ENTRY_UUID }]);
    },
  },
}));

vi.mock("@/lib/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, col) => `${name}.${String(col)}` });
  return {
    waitingList: table("waitingList"),
    clients: table("clients"),
    services: table("services"),
    employees: table("employees"),
    salons: table("salons"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
}));

const mockRequireAuth = vi.fn();
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  isAuthError: (r: unknown) => r instanceof NextResponse,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/waiting-list", () => ({
  acceptEarlierSlot: vi.fn(),
  declineEarlierSlot: vi.fn(),
}));

// Sprawdzenie blokady ma własne testy (online-booking-block, pg); tu tylko
// to, że trasa je woła i zwraca jego odpowiedź. Domyślnie: bez blokady.
vi.mock("@/lib/online-booking-block", () => ({
  onlineBookingBlockResponse: vi.fn(),
}));

import { GET, POST } from "@/app/api/client/waiting-list/route";
import { onlineBookingBlockResponse } from "@/lib/online-booking-block";
import { acceptEarlierSlot } from "@/lib/waiting-list";
import {
  POST as respondToEntry,
  DELETE as deleteEntry,
} from "@/app/api/client/waiting-list/[id]/route";

function sessionUser(emailVerified: boolean | undefined, email: string | null = EMAIL_B) {
  const user = { id: "user-x", name: "Konto X", email, emailVerified };
  mockRequireAuth.mockResolvedValue({ session: { user }, user });
}

/** Wiersz z zapytania listy (wpis B w salonie) — tak jak zwraca go baza. */
const entryRowOfB = {
  entry: {
    id: ENTRY_UUID,
    salonId: SALON_UUID,
    clientId: CLIENT_B_UUID,
    serviceId: "svc-1",
    preferredEmployeeId: "emp-1",
    preferredDate: new Date("2026-08-01T00:00:00Z"),
    notifiedAt: null,
    accepted: null,
    offeredStartTime: null,
    offeredEndTime: null,
    offeredEmployeeId: null,
    existingAppointmentId: null,
    acceptToken: "sekretny-token",
    createdAt: new Date("2026-07-01T00:00:00Z"),
  },
  client: {
    id: CLIENT_B_UUID,
    firstName: "Barbara",
    lastName: "Bielska",
    phone: "600700800",
    email: EMAIL_B,
    notes: "alergia na lateks",
  },
  service: { name: "Strzyzenie" },
  employee: { firstName: "Ewa", lastName: "Nowak" },
  salon: { name: "Salon Testowy" },
};

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  vi.mocked(onlineBookingBlockResponse).mockResolvedValue(null);
});

const BLOCKED_MESSAGE = "Rezerwacja online jest niedostępna. Zadzwoń do salonu: +48 91 000 00 00";
const blockedResponse = () =>
  NextResponse.json(
    { success: false, code: "ONLINE_BOOKING_UNAVAILABLE", error: BLOCKED_MESSAGE },
    { status: 403 }
  );

describe("GET /api/client/waiting-list — dopasowanie tylko po zweryfikowanym e-mailu", () => {
  it("niezweryfikowany e-mail rowny e-mailowi klienta B => pusta lista, bez zapytan o klientow", async () => {
    sessionUser(false);
    selectResults.push([{ id: CLIENT_B_UUID }], [entryRowOfB]);

    const { status, body } = await parseResponse<{ data: unknown[]; count: number }>(await GET());

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("brak flagi emailVerified w sesji => traktowane jak niezweryfikowane", async () => {
    sessionUser(undefined);
    selectResults.push([{ id: CLIENT_B_UUID }], [entryRowOfB]);

    const { body } = await parseResponse<{ data: unknown[] }>(await GET());

    expect(body.data).toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("zweryfikowany e-mail => wpisy wlasciciela, tylko pola uzywane przez portal", async () => {
    sessionUser(true);
    selectResults.push([{ id: CLIENT_B_UUID }], [entryRowOfB]);

    const { status, body } = await parseResponse<{ data: Record<string, unknown>[] }>(await GET());

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(Object.keys(body.data[0]!).sort()).toEqual(
      [
        "id",
        "salonName",
        "serviceName",
        "preferredEmployeeName",
        "notifiedAt",
        "accepted",
        "offeredStartTime",
        "offeredEndTime",
        "offeredEmployeeName",
        "existingAppointmentId",
        "createdAt",
      ].sort()
    );
    const serialized = JSON.stringify(body);
    for (const secret of ["Barbara", "600700800", "lateks", "sekretny-token", CLIENT_B_UUID]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("zapytanie listy nie pobiera calego wiersza klienta", async () => {
    sessionUser(true);
    selectResults.push([{ id: CLIENT_B_UUID }], []);

    await GET();

    const listSelection = mockSelect.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(listSelection).toBeDefined();
    expect(listSelection).not.toHaveProperty("client");
  });

  it("brak sesji => 401", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ success: false, error: "Wymagane logowanie" }, { status: 401 })
    );

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("POST /api/client/waiting-list — zapis tylko ze zweryfikowanym e-mailem", () => {
  const joinRequest = () =>
    createMockRequest("http://localhost:3000/api/client/waiting-list", {
      method: "POST",
      body: { salonId: SALON_UUID },
    });

  it("niezweryfikowany e-mail => 403, bez podpinania pod rekord B i bez tworzenia klienta", async () => {
    sessionUser(false);
    selectResults.push([{ id: SALON_UUID }], [{ id: CLIENT_B_UUID, email: EMAIL_B }]);

    const res = await POST(joinRequest());

    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("zweryfikowany e-mail => 201", async () => {
    sessionUser(true);
    selectResults.push([{ id: SALON_UUID }], [{ id: CLIENT_B_UUID, email: EMAIL_B }]);

    const res = await POST(joinRequest());

    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onlineBookingBlockResponse)).toHaveBeenCalledWith({
      salonId: SALON_UUID,
      sessionUser: expect.objectContaining({ email: EMAIL_B, emailVerified: true }),
    });
  });

  it("karta klienta z blokadą rezerwacji online => 403 z kodem i komunikatem blokady, bez zapisu", async () => {
    sessionUser(true);
    selectResults.push([{ id: SALON_UUID }], [{ id: CLIENT_B_UUID, email: EMAIL_B }]);
    vi.mocked(onlineBookingBlockResponse).mockResolvedValue(blockedResponse());

    const { status, body } = await parseResponse(await POST(joinRequest()));

    expect(status).toBe(403);
    expect(body).toEqual({ success: false, code: "ONLINE_BOOKING_UNAVAILABLE", error: BLOCKED_MESSAGE });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("salon nie istnieje => 404 przed sprawdzeniem blokady", async () => {
    sessionUser(true);
    selectResults.push([]);

    const res = await POST(joinRequest());

    expect(res.status).toBe(404);
    expect(vi.mocked(onlineBookingBlockResponse)).not.toHaveBeenCalled();
  });

  it("błąd sprawdzenia blokady => 500, bez zapisu", async () => {
    sessionUser(true);
    selectResults.push([{ id: SALON_UUID }]);
    vi.mocked(onlineBookingBlockResponse).mockRejectedValue(new Error("db down"));

    const res = await POST(joinRequest());

    expect(res.status).toBe(500);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/client/waiting-list/[id] — akceptacja oferty przy blokadzie karty", () => {
  const params = { params: Promise.resolve({ id: ENTRY_UUID }) };
  const notifiedEntryWithToken = () => [
    { entry: { ...entryRowOfB.entry, notifiedAt: new Date() }, client: { email: EMAIL_B } },
  ];
  const accept = () =>
    respondToEntry(createMockRequest("http://localhost/x", { method: "POST", body: { accepted: true } }), params);

  it("acceptEarlierSlot odmawia z kodem blokady => 403 z tym samym kodem i komunikatem", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());
    vi.mocked(acceptEarlierSlot).mockResolvedValue({
      success: false,
      code: "ONLINE_BOOKING_UNAVAILABLE",
      message: BLOCKED_MESSAGE,
    });

    const { status, body } = await parseResponse(await accept());

    expect(status).toBe(403);
    expect(body).toEqual({ success: false, code: "ONLINE_BOOKING_UNAVAILABLE", error: BLOCKED_MESSAGE });
  });

  it("nowa wizyta: zablokowana karta wpisu albo inna z tym samym e-mailem lub numerem => 403 przed acceptEarlierSlot", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());
    vi.mocked(onlineBookingBlockResponse).mockResolvedValue(blockedResponse());

    const { status, body } = await parseResponse(await accept());

    expect(status).toBe(403);
    expect(body).toEqual({ success: false, code: "ONLINE_BOOKING_UNAVAILABLE", error: BLOCKED_MESSAGE });
    // Telefon i e-mail karty czyta helper w kontekście salonu po id karty —
    // trasa przekazuje tylko id karty wpisu, bez danych z surowego odczytu.
    expect(vi.mocked(onlineBookingBlockResponse)).toHaveBeenCalledWith({
      salonId: SALON_UUID,
      sessionUser: expect.objectContaining({ email: EMAIL_B, emailVerified: true }),
      clientId: CLIENT_B_UUID,
    });
    expect(vi.mocked(acceptEarlierSlot)).not.toHaveBeenCalled();
  });

  it("nowa wizyta bez blokady => sprawdzenie po karcie, potem acceptEarlierSlot i 200", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());
    vi.mocked(acceptEarlierSlot).mockResolvedValue({ success: true, message: "Utworzono", appointmentId: "appt-new" });

    const { status, body } = await parseResponse<{ success: boolean; data: { appointmentId: string } }>(
      await accept()
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.appointmentId).toBe("appt-new");
    expect(vi.mocked(onlineBookingBlockResponse)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(acceptEarlierSlot)).toHaveBeenCalledWith(ENTRY_UUID, "sekretny-token");
  });

  it("przeniesienie istniejącej wizyty (existingAppointmentId) => bez sprawdzenia blokady w trasie, 200", async () => {
    sessionUser(true);
    selectResults.push([
      {
        entry: { ...entryRowOfB.entry, notifiedAt: new Date(), existingAppointmentId: "appt-old" },
        client: { email: EMAIL_B },
      },
    ]);
    // Gdyby trasa sprawdzała blokadę, ta odpowiedź zatrzymałaby przyjęcie.
    vi.mocked(onlineBookingBlockResponse).mockResolvedValue(blockedResponse());
    vi.mocked(acceptEarlierSlot).mockResolvedValue({
      success: true,
      message: "Wizyta przeniesiona",
      appointmentId: "appt-old",
    });

    const { status, body } = await parseResponse<{ success: boolean; data: { appointmentId: string } }>(
      await accept()
    );

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.appointmentId).toBe("appt-old");
    expect(vi.mocked(onlineBookingBlockResponse)).not.toHaveBeenCalled();
    expect(vi.mocked(acceptEarlierSlot)).toHaveBeenCalledWith(ENTRY_UUID, "sekretny-token");
  });

  it("wpis jeszcze nie powiadomiony => 400 przed sprawdzeniem blokady", async () => {
    sessionUser(true);
    selectResults.push([{ entry: { ...entryRowOfB.entry, notifiedAt: null }, client: { email: EMAIL_B } }]);
    vi.mocked(onlineBookingBlockResponse).mockResolvedValue(blockedResponse());

    const res = await accept();

    expect(res.status).toBe(400);
    expect(vi.mocked(onlineBookingBlockResponse)).not.toHaveBeenCalled();
  });

  it("wpis już rozstrzygnięty => 409 przed sprawdzeniem blokady", async () => {
    sessionUser(true);
    selectResults.push([
      { entry: { ...entryRowOfB.entry, notifiedAt: new Date(), accepted: false }, client: { email: EMAIL_B } },
    ]);
    vi.mocked(onlineBookingBlockResponse).mockResolvedValue(blockedResponse());

    const res = await accept();

    expect(res.status).toBe(409);
    expect(vi.mocked(onlineBookingBlockResponse)).not.toHaveBeenCalled();
  });

  it("błąd sprawdzenia blokady => 500, bez acceptEarlierSlot", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());
    vi.mocked(onlineBookingBlockResponse).mockRejectedValue(new Error("db down"));

    const res = await accept();

    expect(res.status).toBe(500);
    expect(vi.mocked(acceptEarlierSlot)).not.toHaveBeenCalled();
  });

  it("odczyt wpisu nie bierze telefonu karty (surowy odczyt tylko e-mail do własności)", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());
    vi.mocked(acceptEarlierSlot).mockResolvedValue({ success: true, message: "ok" });

    await accept();

    expect(mockSelect).toHaveBeenLastCalledWith({ entry: expect.anything(), client: { email: "clients.email" } });
  });

  it("odrzucenie oferty nie sprawdza blokady", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());

    await respondToEntry(
      createMockRequest("http://localhost/x", { method: "POST", body: { accepted: false } }),
      params
    );

    expect(vi.mocked(onlineBookingBlockResponse)).not.toHaveBeenCalled();
  });

  it("inna odmowa acceptEarlierSlot (bez kodu) => dotychczasowe 200 z success=false", async () => {
    sessionUser(true);
    selectResults.push(notifiedEntryWithToken());
    vi.mocked(acceptEarlierSlot).mockResolvedValue({ success: false, message: "Termin jest juz zajety" });

    const { status, body } = await parseResponse<{ success: boolean; message: string }>(await accept());

    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toBe("Termin jest juz zajety");
  });
});

describe("POST/DELETE /api/client/waiting-list/[id] — wlasnosc tylko po zweryfikowanym e-mailu", () => {
  const params = { params: Promise.resolve({ id: ENTRY_UUID }) };
  const ownedEntry = () => [
    {
      entry: { ...entryRowOfB.entry, notifiedAt: new Date(), acceptToken: null },
      client: { email: EMAIL_B },
    },
  ];

  it("DELETE: niezweryfikowany e-mail rowny e-mailowi B => 403, nic nie usuniete", async () => {
    sessionUser(false);
    selectResults.push(ownedEntry());

    const res = await deleteEntry(createMockRequest("http://localhost/x", { method: "DELETE" }), params);

    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("DELETE: zweryfikowany wlasciciel => 200", async () => {
    sessionUser(true);
    selectResults.push(ownedEntry());

    const res = await deleteEntry(createMockRequest("http://localhost/x", { method: "DELETE" }), params);

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("POST: niezweryfikowany e-mail rowny e-mailowi B => 403, brak decyzji", async () => {
    sessionUser(false);
    selectResults.push(ownedEntry());

    const res = await respondToEntry(
      createMockRequest("http://localhost/x", { method: "POST", body: { accepted: true } }),
      params
    );

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("POST: zweryfikowany wlasciciel => 200", async () => {
    sessionUser(true);
    selectResults.push(ownedEntry());

    const res = await respondToEntry(
      createMockRequest("http://localhost/x", { method: "POST", body: { accepted: false } }),
      params
    );
    const { status } = await parseResponse(res);

    expect(status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  // Strażnik zwraca null dla niezweryfikowanego konta. Gdyby zabrakło
  // warunku `!userEmail ||`, porównanie null !== null przepuściłoby konto
  // do wpisu klienta bez e-maila (clients.email = null) w obcym salonie.
  const foreignEntryWithoutEmail = (acceptToken: string | null) => [
    {
      entry: {
        ...entryRowOfB.entry,
        salonId: "99999999-9999-4999-8999-999999999999",
        notifiedAt: new Date(),
        acceptToken,
      },
      client: { email: null },
    },
  ];

  it.each([
    ["niezweryfikowane konto", false, EMAIL_B],
    ["konto bez e-maila", true, null],
  ])("DELETE: %s, wpis klienta bez e-maila w obcym salonie => 403, nic nie usuniete", async (_l, verified, email) => {
    sessionUser(verified, email);
    selectResults.push(foreignEntryWithoutEmail(null));

    const res = await deleteEntry(createMockRequest("http://localhost/x", { method: "DELETE" }), params);

    expect(res.status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it.each([
    ["niezweryfikowane konto", false, EMAIL_B],
    ["konto bez e-maila", true, null],
  ])("POST: %s, wpis klienta bez e-maila w obcym salonie => 403, brak decyzji", async (_l, verified, email) => {
    sessionUser(verified, email);
    selectResults.push(foreignEntryWithoutEmail(null));

    const res = await respondToEntry(
      createMockRequest("http://localhost/x", { method: "POST", body: { accepted: true } }),
      params
    );

    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("POST: niezweryfikowane konto, wpis z tokenem bez e-maila klienta => 403, bez akceptacji terminu", async () => {
    sessionUser(false);
    selectResults.push(foreignEntryWithoutEmail("token-obcego-wpisu"));

    const res = await respondToEntry(
      createMockRequest("http://localhost/x", { method: "POST", body: { accepted: true } }),
      params
    );

    expect(res.status).toBe(403);
    expect(vi.mocked(acceptEarlierSlot)).not.toHaveBeenCalled();
  });
});
