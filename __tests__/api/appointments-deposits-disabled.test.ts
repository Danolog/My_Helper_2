/**
 * POST /api/appointments przy wyłączonym zadatku — stan dzisiejszej produkcji.
 *
 * Usługa ma `deposit_required = true`, a klient `require_deposit = true`
 * zapisane w bazie wcześniej, ale `isDepositEnabled()` (rejestr PRAWDZIWY,
 * bez atrapy) zwraca false. Wizyta ma powstać zwykłą ścieżką: 201, bez
 * kwoty zadatku i bez wiersza płatności.
 *
 * W odróżnieniu od appointments-deposit-guard.test.ts wyliczenie zadatku
 * (`calculateExpectedDeposit`) i strażnik (`depositGuardResponse`) są
 * prawdziwe — atrapą jest tylko baza (odczyty rozróżniane po tabeli).
 *
 * Kody: 201 (gość, klient portalu z flagą), 400 (walidacja, brak usługi),
 * 401 nie dotyczy (trasa publiczna — gość), 403 (personel innego salonu),
 * 404 (usługa nieaktywna/usunięta, wariant), 409 (kolizja), 503 (błąd odczytu
 * usługi przy wyliczeniu).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse, createChainMock } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
const OTHER_SALON = "99999999-9999-4999-8999-999999999999";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const SERVICE = "44444444-4444-4444-8444-444444444444";
const VARIANT = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  /** Wiersze zwracane przez odczyt z danej tabeli (klucz = obiekt tabeli Drizzle). */
  rows: new Map<unknown, Record<string, unknown>[]>(),
  /** Tabele, z których czytano, w kolejności odczytów. */
  readFrom: [] as unknown[],
  /** Wyjątek rzucany przy odczycie z danej tabeli. */
  failOn: new Map<unknown, Error>(),
  insert: vi.fn(),
  session: vi.fn(),
  salonCtx: vi.fn(),
  refs: vi.fn(),
  sms: vi.fn(),
}));

// Atrapa bazy: select().from(tabela) zwraca wiersze przypisane do tabeli.
// Zarówno trasa, jak i wyliczenie zadatku czytają przez forSalon(salonId).raw.
vi.mock("@/lib/server/repository", () => {
  const select = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    for (const m of ["where", "limit", "orderBy", "leftJoin", "innerJoin", "groupBy"]) {
      chain[m] = () => chain;
    }
    chain.from = (t: unknown) => {
      table = t;
      h.readFrom.push(t);
      return chain;
    };
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      const failure = h.failOn.get(table);
      if (failure) return Promise.reject(failure).then(resolve, reject);
      return Promise.resolve(h.rows.get(table) ?? []).then(resolve, reject);
    };
    return chain;
  };
  const tx = {
    select,
    insert: (...a: unknown[]) => h.insert(...a),
    update: () => createChainMockLazy(),
  };
  function createChainMockLazy() {
    const chain: Record<string, unknown> = {};
    for (const m of ["set", "where", "returning"]) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve([]);
    return chain;
  }
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (t: typeof tx) => unknown) => fn(tx) }),
  };
});
vi.mock("@/lib/session", () => ({ getOptionalSession: (...a: unknown[]) => h.session(...a) }));
vi.mock("@/lib/rate-limit", () => {
  const ok = { check: () => ({ success: true, remaining: 10, reset: 60000 }) };
  return { strictRateLimit: ok, apiRateLimit: ok, getClientIp: () => "127.0.0.1" };
});
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: (...a: unknown[]) => h.refs(...a) }));
vi.mock("@/lib/sms", () => ({ sendBookingConfirmationSms: (...a: unknown[]) => h.sms(...a) }));

import { POST } from "@/app/api/appointments/route";
import { isDepositEnabled } from "@/lib/features";
import { clients, depositPayments, promotions, serviceVariants, services } from "@/lib/schema";

const PORTAL_CLIENT = {
  user: { id: "u-client", email: "klient@test.pl", emailVerified: true },
};
const STAFF_OTHER = { user: { id: "u-staff", email: "owner@inny.pl", emailVerified: true } };
const GUEST = { guestName: "Jan Kowalski", guestPhone: "123 456 789" };

/** Usługa z flagą zadatku zapisaną wcześniej: 30% ze 100 PLN = 30 PLN przy włączonym zadatku. */
const SERVICE_WITH_DEPOSIT = {
  id: SERVICE,
  name: "Koloryzacja",
  basePrice: "100.00",
  depositRequired: true,
  depositPercentage: 30,
  isActive: true,
};
/** Klient z flagą zadatku zapisaną wcześniej: stałe 50 PLN przy włączonym zadatku. */
const CLIENT_WITH_DEPOSIT = { requireDeposit: true, depositType: "fixed", depositValue: "50.00" };

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

function post(b: Record<string, unknown>) {
  return POST(createMockRequest("http://localhost:3000/api/appointments", { method: "POST", body: b }));
}

function inserted(): Record<string, unknown> {
  return (insertChain.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
}

function insertedTables(): unknown[] {
  return h.insert.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.failOn.clear();
  h.readFrom.length = 0;
  h.rows.set(services, [SERVICE_WITH_DEPOSIT]);
  h.rows.set(clients, [CLIENT_WITH_DEPOSIT]);
  h.rows.set(serviceVariants, [{ id: VARIANT, priceModifier: "20.00" }]);
  insertChain = createChainMock([{ id: "apt-1", clientId: null }]);
  h.insert.mockReset();
  h.insert.mockReturnValue(insertChain);
  h.refs.mockResolvedValue(null);
  h.salonCtx.mockResolvedValue(null);
  h.session.mockResolvedValue(null);
});

describe("POST /api/appointments — zadatek wyłączony, flagi zadatku w danych", () => {
  it("rejestr flag jest prawdziwy: isDepositEnabled() = false", () => {
    expect(isDepositEnabled()).toBe(false);
  });

  it("gość, usługa z deposit_required → 201, bez kwoty zadatku i bez wiersza płatności", async () => {
    const res = await post(body(GUEST));
    const { status, body: json } = await parseResponse<{ success: boolean; code?: string }>(res);

    expect(status).toBe(201);
    expect(json.code).not.toBe("DEPOSIT_REQUIRED");
    expect(h.readFrom).toContain(services); // wyliczenie naprawdę czytało usługę
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(insertedTables()).not.toContain(depositPayments);
    expect(inserted()).toMatchObject({ serviceId: SERVICE, depositAmount: null });
    expect(inserted().depositPaid).not.toBe(true);
  });

  it("klient portalu z require_deposit (zweryfikowany e-mail) → 201, ustawienia klienta nieczytane", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);

    const res = await post(body());

    expect(res.status).toBe(201);
    expect(h.readFrom).toContain(services);
    expect(h.readFrom).not.toContain(clients);
    expect(insertedTables()).not.toContain(depositPayments);
    expect(inserted()).toMatchObject({ depositAmount: null });
  });

  it("z wariantem → 201, wariant sprawdzony i zapisany", async () => {
    const res = await post(body({ ...GUEST, variantId: VARIANT }));

    expect(res.status).toBe(201);
    expect(h.readFrom).toContain(serviceVariants);
    expect(inserted()).toMatchObject({ variantId: VARIANT, depositAmount: null });
  });

  it("promocje nie są czytane przy wyłączonym zadatku", async () => {
    await post(body(GUEST));
    expect(h.readFrom).not.toContain(promotions);
  });

  it("nigdy 400 DEPOSIT_REQUIRED, także dla obu flag naraz", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);
    const { status, body: json } = await parseResponse<{ code?: string }>(await post(body()));

    expect(status).not.toBe(400);
    expect(json.code).toBeUndefined();
  });
});

describe("POST /api/appointments — zadatek wyłączony, ścieżki błędu", () => {
  it("usługa nie istnieje → 404, brak zapisu", async () => {
    h.rows.set(services, []);

    const res = await post(body(GUEST));

    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("usługa nieaktywna (mimo flagi zadatku) → 404, brak zapisu", async () => {
    h.rows.set(services, [{ ...SERVICE_WITH_DEPOSIT, isActive: false }]);

    const res = await post(body(GUEST));

    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("wariant nie istnieje → 404, brak zapisu", async () => {
    h.rows.set(serviceVariants, []);

    const res = await post(body({ ...GUEST, variantId: VARIANT }));

    expect(res.status).toBe(404);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("błąd bazy przy odczycie usługi → 503 z Retry-After, brak zapisu (fail-closed)", async () => {
    h.failOn.set(services, new Error("connection terminated"));

    const res = await post(body(GUEST));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("bez usługi (spoza personelu) → 400, wyliczenie niewołane", async () => {
    const res = await post(body({ ...GUEST, serviceId: null }));
    const { status, body: json } = await parseResponse<{ error: string }>(res);

    expect(status).toBe(400);
    expect(json.error).toBe("Wybierz usługę");
    expect(h.readFrom).not.toContain(services);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("gość bez telefonu → 400, brak zapisu", async () => {
    const res = await post(body({ guestName: "Jan Kowalski" }));

    expect(res.status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("personel innego salonu → 403, brak zapisu", async () => {
    h.session.mockResolvedValue(STAFF_OTHER);
    h.salonCtx.mockResolvedValue({ salonId: OTHER_SALON, role: "owner" });

    const res = await post(body());

    expect(res.status).toBe(403);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("kolizja z inną wizytą → 409 (po przejściu strażnika), brak zapisu", async () => {
    const { appointments } = await import("@/lib/schema");
    h.rows.set(appointments, [{ id: "inna" }]);

    const res = await post(body(GUEST));

    expect(res.status).toBe(409);
    expect(h.readFrom).toContain(services);
    expect(h.insert).not.toHaveBeenCalled();
  });
});
