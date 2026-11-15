/**
 * #63: POST /api/appointments nie tworzy wizyty usługi z zadatkiem bez
 * wpłaty. Prawdziwy strażnik (src/lib/deposit-guard.ts) + atrapa wyliczenia
 * (calculateExpectedDeposit testowane w deposit-calculation.test.ts).
 *
 * Kody: 201 (zapis), 400 (DEPOSIT_REQUIRED, walidacja, brak usługi),
 * 401 nie dotyczy (trasa publiczna — gość), 403 (personel INNEGO salonu,
 * UAT X-1, przed strażnikiem), 404 (usługa/wariant), 409 (kolizja), 500
 * (wyjątek zapisu), 503 (wyliczenie niedostępne).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, createChainMock } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
const OTHER_SALON = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const SERVICE = "44444444-4444-4444-8444-444444444444";
const VARIANT = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  session: vi.fn(),
  salonCtx: vi.fn(),
  refs: vi.fn(),
  calc: vi.fn(),
  sms: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (...a: unknown[]) => h.select(...a),
    insert: (...a: unknown[]) => h.insert(...a),
    update: (...a: unknown[]) => h.update(...a),
  },
}));
vi.mock("@/lib/session", () => ({ getOptionalSession: (...a: unknown[]) => h.session(...a) }));
vi.mock("@/lib/rate-limit", () => {
  const ok = { check: () => ({ success: true, remaining: 10, reset: 60000 }) };
  return { strictRateLimit: ok, apiRateLimit: ok, getClientIp: () => "127.0.0.1" };
});
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: (...a: unknown[]) => h.refs(...a) }));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));
vi.mock("@/lib/sms", () => ({ sendBookingConfirmationSms: (...a: unknown[]) => h.sms(...a) }));

import { POST } from "@/app/api/appointments/route";

const PORTAL_CLIENT = { user: { id: "u-client", email: "klient@test.pl", emailVerified: true } };
const STAFF = { user: { id: "u-staff", email: "owner@salon.pl", emailVerified: true } };

const REQUIRED = { ok: true, required: true, amount: 30, serviceName: "Koloryzacja" };
const NOT_REQUIRED = { ok: true, required: false, amount: 0, serviceName: "Strzyzenie" };

let insertChain: ReturnType<typeof createChainMock>;

function body(extra: Record<string, unknown> = {}) {
  return {
    salonId: SALON,
    employeeId: EMPLOYEE,
    serviceId: SERVICE,
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
    notes: "Rezerwacja online: Koloryzacja",
    ...extra,
  };
}
const GUEST = { guestName: "Jan Kowalski", guestPhone: "123 456 789" };

function post(b: Record<string, unknown>) {
  return POST(createMockRequest("http://localhost:3000/api/appointments", { method: "POST", body: b }));
}

function inserted(): Record<string, unknown> {
  return (insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.select.mockReset();
  h.select
    .mockReturnValueOnce(createChainMock([])) // kolizje wizyt
    .mockReturnValueOnce(createChainMock([])) // blokady czasu
    .mockReturnValue(createChainMock([])); // szczegóły do SMS
  insertChain = createChainMock([{ id: "apt-1", clientId: null }]);
  h.insert.mockReset();
  h.insert.mockReturnValue(insertChain);
  h.refs.mockResolvedValue(null);
  h.salonCtx.mockResolvedValue(null);
  h.calc.mockResolvedValue(NOT_REQUIRED);
});

describe("#63: usługa/klient z zadatkiem → 400 DEPOSIT_REQUIRED (nie 409)", () => {
  it("gość → 400 DEPOSIT_REQUIRED, bez kolizji i zapisu", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue(REQUIRED);

    const res = await post(body(GUEST));
    const { status, body: json } = await parseResponse<{ success: boolean; code: string; error: string }>(res);

    expect(status).toBe(400);
    expect(json).toMatchObject({ success: false, code: "DEPOSIT_REQUIRED" });
    expect(json.error).toMatch(/zadatku/);
    expect(h.select).not.toHaveBeenCalled(); // wyliczenie PRZED kolizjami
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("klient portalu (zalogowany, bez kontekstu salonu) → 400, sesja przekazana do wyliczenia", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);
    h.calc.mockResolvedValue(REQUIRED);

    const res = await post(body({ variantId: VARIANT }));
    const { status, body: json } = await parseResponse<{ code: string }>(res);

    expect(status).toBe(400);
    expect(json.code).toBe("DEPOSIT_REQUIRED");
    expect(h.calc).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: SALON,
        serviceId: SERVICE,
        variantId: VARIANT,
        sessionUser: PORTAL_CLIENT.user,
      })
    );
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ten sam komunikat niezależnie od flagi (usługa vs klient — wyliczenie zwraca to samo)", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);
    h.calc.mockResolvedValue(REQUIRED);
    const a = await parseResponse<{ error: string }>(await post(body()));
    h.calc.mockResolvedValue({ ...REQUIRED, amount: 50 }); // np. stała kwota klienta
    const b = await parseResponse<{ error: string }>(await post(body()));
    expect(a.body.error).toBe(b.body.error);
  });

  it("personel INNEGO salonu → 403 (UAT X-1, przed strażnikiem), wymóg niesprawdzany, brak zapisu", async () => {
    h.session.mockResolvedValue(STAFF);
    h.salonCtx.mockResolvedValue({ salonId: OTHER_SALON, role: "owner" });
    h.calc.mockResolvedValue(REQUIRED);

    const res = await post(body());

    expect(res.status).toBe(403);
    expect(h.calc).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it.each(["owner", "receptionist", "employee"])(
    "personel TEGO salonu (%s) → wyjątek: 201, wymóg zadatku nie jest liczony",
    async (role) => {
      h.session.mockResolvedValue(STAFF);
      h.salonCtx.mockResolvedValue({ salonId: SALON, role });
      h.calc.mockResolvedValue(REQUIRED);

      const res = await post(body());

      expect(res.status).toBe(201);
      expect(h.calc).not.toHaveBeenCalled();
      expect(h.insert).toHaveBeenCalledTimes(1);
    }
  );

  it("wymóg zadatku z kwotą 0 (np. klient z wartością 0) → 201, jak front i create-session", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);
    h.calc.mockResolvedValue({ ...REQUIRED, amount: 0 });

    const res = await post(body());
    expect(res.status).toBe(201);
  });

  it("usługa bez zadatku → 201 (gość)", async () => {
    h.session.mockResolvedValue(null);
    const res = await post(body(GUEST));
    expect(res.status).toBe(201);
  });
});

describe("#63: wyliczenie niedostępne / nieznana usługa", () => {
  it("wyjątek wyliczenia → 503 z Retry-After, bez kolizji i zapisu", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockRejectedValue(new Error("connection terminated"));

    const res = await post(body(GUEST));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(h.select).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("usługa/wariant nie istnieje → 404, brak zapisu", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);
    h.calc.mockResolvedValue({ ok: false, error: "variant_not_found" });

    const res = await post(body({ variantId: VARIANT }));
    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("rezerwacja spoza personelu bez usługi → 400 (zadatku nie da się sprawdzić)", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);
    const res = await post(body({ serviceId: null }));
    const { status, body: json } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(400);
    expect(json.error).toBe("Wybierz usługę");
    expect(h.calc).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("personel tego salonu bez usługi → 201 (panel: wizyta bez usługi dozwolona)", async () => {
    h.session.mockResolvedValue(STAFF);
    h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });
    const res = await post(body({ serviceId: undefined }));
    expect(res.status).toBe(201);
  });
});

describe("#64 pkt 4: telefon gościa zapisywany w E.164", () => {
  beforeEach(() => h.session.mockResolvedValue(null));

  it.each([
    ["+48 123 456 789", "+48123456789"],
    ["123456789", "+48123456789"],
    ["123-456-789", "+48123456789"],
    ["(12) 345 67 89", "+48123456789"],
  ])("%s → zapis %s", async (input, stored) => {
    const res = await post(body({ ...GUEST, guestPhone: input }));
    expect(res.status).toBe(201);
    expect(inserted()).toMatchObject({ guestPhone: stored, guestName: "Jan Kowalski" });
  });

  it.each(["12345", "+49 123 456 789", "48123456789"])("%s → 400 z komunikatem o telefonie, brak zapisu", async (input) => {
    const res = await post(body({ ...GUEST, guestPhone: input }));
    const { status, body: json } = await parseResponse<{ error: string }>(res);
    expect(status).toBe(400);
    expect(json.error).toMatch(/numer telefonu/);
    expect(h.calc).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("imię gościa przycinane przed zapisem", async () => {
    const res = await post(body({ ...GUEST, guestName: "  Jan Kowalski  " }));
    expect(res.status).toBe(201);
    expect(inserted()).toMatchObject({ guestName: "Jan Kowalski" });
  });

  it("jednoznakowe imię → 400 z dedykowanym komunikatem", async () => {
    const res = await post(body({ ...GUEST, guestName: "J" }));
    const { status, body: json } = await parseResponse<{ error: string }>(res);
    expect(status).toBe(400);
    expect(json.error).toContain("min. 2 znaki");
  });
});

describe("pozostałe kody", () => {
  it("409: kolizja z wizytą (po przejściu strażnika) — brak zapisu", async () => {
    h.session.mockResolvedValue(null);
    h.select.mockReset();
    h.select.mockReturnValueOnce(createChainMock([{ id: "inna" }]));
    const res = await post(body(GUEST));
    expect(res.status).toBe(409);
    expect(h.calc).toHaveBeenCalledTimes(1);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("500: wyjątek zapisu", async () => {
    h.session.mockResolvedValue(null);
    h.insert.mockReset();
    h.insert.mockImplementation(() => {
      throw new Error("insert failed");
    });
    const res = await post(body(GUEST));
    expect(res.status).toBe(500);
  });
});

describe("#67: wycena i zapis z jednego obiektu (wariant)", () => {
  it("gość z wariantem: wyceniony wariant = zapisany wariant (i ten sam termin)", async () => {
    h.session.mockResolvedValue(null);
    const res = await post(body({ ...GUEST, variantId: VARIANT }));

    expect(res.status).toBe(201);
    const calcArgs = h.calc.mock.calls[0]![0] as { variantId: string; startTime: Date };
    expect(calcArgs.variantId).toBe(VARIANT);
    expect(inserted().variantId).toBe(VARIANT);
    expect((inserted().startTime as Date).getTime()).toBe(calcArgs.startTime.getTime());
  });

  it("bez wariantu: wycena i zapis z variantId null", async () => {
    h.session.mockResolvedValue(null);
    await post(body(GUEST));
    expect((h.calc.mock.calls[0]![0] as { variantId: unknown }).variantId).toBeNull();
    expect(inserted().variantId).toBeNull();
  });

  it("wariant sprawdzany w salonie razem z usługą (także dla personelu)", async () => {
    h.session.mockResolvedValue(STAFF);
    h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });
    const res = await post(body({ variantId: VARIANT }));

    expect(res.status).toBe(201);
    expect(h.refs).toHaveBeenCalledWith(SALON, expect.objectContaining({ serviceId: SERVICE, variantId: VARIANT }));
    expect(inserted().variantId).toBe(VARIANT);
  });

  it("wariant innej usługi / innego salonu (salon-refs) → 400, bez wyceny i zapisu", async () => {
    h.session.mockResolvedValue(null);
    const { NextResponse } = await import("next/server");
    h.refs.mockResolvedValue(
      NextResponse.json({ success: false, error: "Nieprawidlowe dane dla tego salonu" }, { status: 400 })
    );
    const res = await post(body({ ...GUEST, variantId: VARIANT }));

    expect(res.status).toBe(400);
    expect(h.calc).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe("#67: depositDecision w /api/appointments — trzy gałęzie", () => {
  it("none: wariant zerujący kwotę przy required, gość → 201 bez zadatku + warn bez danych osobowych", async () => {
    const { logger } = await import("@/lib/logger");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ...REQUIRED, amount: 0 });

    const res = await post(body({ ...GUEST, variantId: VARIANT, guestEmail: "jan@test.pl" }));

    expect(res.status).toBe(201);
    expect(inserted()).toMatchObject({ variantId: VARIANT, depositAmount: null });
    const call = warn.mock.calls.find(([msg]) => /amount is <= 0/.test(String(msg)));
    expect(call).toBeDefined();
    const logged = JSON.stringify(call);
    expect(logged).toContain(VARIANT);
    expect(logged).not.toContain("Jan");
    expect(logged).not.toContain("123456789");
    expect(logged).not.toContain("jan@test.pl");
    warn.mockRestore();
  });

  it("none: ten sam wariant dla personelu tego salonu → 201 (bez wyceny)", async () => {
    h.session.mockResolvedValue(STAFF);
    h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });
    h.calc.mockResolvedValue({ ...REQUIRED, amount: 0 });
    const res = await post(body({ variantId: VARIANT }));
    expect(res.status).toBe(201);
    expect(h.calc).not.toHaveBeenCalled();
  });

  it("none: kwota ujemna przy required → 201 (kwota ≤ 0 = brak zadatku)", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ...REQUIRED, amount: -10 });
    const res = await post(body(GUEST));
    expect(res.status).toBe(201);
  });

  it("error: kwota NaN → 503, bez kolizji i zapisu", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ...REQUIRED, amount: Number.NaN });
    const res = await post(body(GUEST));
    expect(res.status).toBe(503);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("error: NaN także bez required (wycena zepsuta) → 503", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ...NOT_REQUIRED, amount: Number.NaN });
    const res = await post(body(GUEST));
    expect(res.status).toBe(503);
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe("#69: usługa usunięta lub wyłączona (portal z nieaktualnej pamięci podręcznej)", () => {
  it("usługa wyłączona/usunięta (wyliczenie: service_not_found) → 404, nic nie zapisane", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ok: false, error: "service_not_found" });
    const res = await post(body(GUEST));
    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("wariant usunięty → 404, nic nie zapisane", async () => {
    h.session.mockResolvedValue(null);
    h.calc.mockResolvedValue({ ok: false, error: "variant_not_found" });
    const res = await post(body({ ...GUEST, variantId: VARIANT }));
    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });
});
