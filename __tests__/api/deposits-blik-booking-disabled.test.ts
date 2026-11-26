/**
 * POST /api/deposits/blik-booking przy wyłączonym zadatku — stan dzisiejszej produkcji.
 *
 * Usługa ma `deposit_required = true`, a klient `require_deposit = true`
 * zapisane w bazie wcześniej, ale `isDepositEnabled()` (rejestr PRAWDZIWY,
 * bez atrapy) zwraca false. Trasa ma odmówić 400 `DEPOSIT_NOT_APPLICABLE`,
 * zanim przeczyta numer BLIK salonu: bez zapisu wizyty, bez odczytu tabeli
 * salonów (tam jest numer BLIK), bez blokady i liczników limitów, bez SMS-a.
 *
 * W odróżnieniu od deposits-blik-booking.test.ts wyliczenie zadatku
 * (`calculateExpectedDeposit`) i reguła (`depositDecision`) są prawdziwe —
 * atrapą jest tylko baza (odczyty rozróżniane po tabeli), sesja, kontekst
 * salonu, przynależność refów, limit IP i wysyłka SMS.
 *
 * Kody: 400 (brak zadatku, walidacja, termin w przeszłości, gość bez telefonu,
 * obce refy), 401/403 nie dotyczą (trasa publiczna), 404 (usługa nieaktywna
 * albo usunięta, wariant), 429 (limit IP), 503 (błąd odczytu usługi).
 */
import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";

const SALON = "11111111-1111-4111-8111-111111111111";
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
  execute: vi.fn(),
  forSalon: vi.fn(),
  dbTouched: vi.fn(),
  session: vi.fn(),
  salonCtx: vi.fn(),
  refs: vi.fn(),
  rate: vi.fn(),
  sms: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Atrapa bazy: select().from(tabela) zwraca wiersze przypisane do tabeli.
// Trasa i wyliczenie zadatku czytają przez forSalon(salonId).raw.
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
    execute: (...a: unknown[]) => {
      h.execute(...a);
      return Promise.resolve([]);
    },
    insert: (...a: unknown[]) => {
      h.insert(...a);
      throw new Error("zapis przy wyłączonym zadatku");
    },
  };
  return {
    forSalon: (salonId: string) => {
      h.forSalon(salonId);
      return { salonId, raw: (fn: (t: typeof tx) => unknown) => Promise.resolve().then(() => fn(tx)) };
    },
  };
});
// Trasa i wyliczenie nie używają surowego db — każde dotknięcie atrapy jest błędem testu.
vi.mock("@/lib/db", () => {
  const touched = (..._a: unknown[]) => {
    h.dbTouched();
    throw new Error("surowe db w trasie blik-booking");
  };
  return { db: { select: touched, insert: touched, update: touched, delete: touched, transaction: touched } };
});
vi.mock("@/lib/session", () => ({ getOptionalSession: (...a: unknown[]) => h.session(...a) }));
vi.mock("@/lib/salon-context", () => ({ getSalonContext: (...a: unknown[]) => h.salonCtx(...a) }));
vi.mock("@/lib/salon-refs", () => ({ assertSalonRefs: (...a: unknown[]) => h.refs(...a) }));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: (...a: unknown[]) => h.rate(...a) },
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));
// Atrapa częściowa: stałe błędów SMS prawdziwe, wysyłka podmieniona.
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendBlikDepositBookingSms: (...a: unknown[]) => h.sms(...a),
}));

import { POST } from "@/app/api/deposits/blik-booking/route";
import { isBlikDepositFlow, isDepositEnabled } from "@/lib/features";
import { appointments, clients, promotions, salons, serviceVariants, services } from "@/lib/schema";
import { TEST_PHONE } from "@/lib/test-phone";

/** Zegar testu: termin 10:00–11:00 tego dnia jest w przyszłości. */
const NOW = new Date("2026-12-01T09:00:00.000Z");

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
/** Salon z numerem BLIK i zgodą — gdyby trasa doszła do odczytu, miałaby czym zapłacić. */
const SALON_WITH_BLIK = {
  name: "Salon Testowy",
  phone: "+48000600704",
  blikPhone: "+48000600703",
  blikConsentAt: "2026-11-21T00:00:00.000Z",
  serviceDuration: 60,
  variantRowId: null,
  variantDurationModifier: null,
};

const PORTAL_CLIENT = { user: { id: "u-client", email: "klient@test.pl", emailVerified: true } };
const GUEST = { guestName: "Jan Testowy", guestPhone: TEST_PHONE };

function body(extra: Record<string, unknown> = {}) {
  return {
    salonId: SALON,
    employeeId: EMPLOYEE,
    serviceId: SERVICE,
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
    depositAmount: 30,
    ...GUEST,
    ...extra,
  };
}

function post(b: Record<string, unknown>) {
  return POST(createMockRequest("http://localhost:3000/api/deposits/blik-booking", { method: "POST", body: b }));
}

type Err = { success: false; error: string; code?: string };

/** Odmowa bez skutków: brak zapisu, brak odczytu numeru BLIK, brak limitów, brak SMS-a. */
function expectNoBookingEffects() {
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.readFrom).not.toContain(salons);
  expect(h.readFrom).not.toContain(appointments);
  expect(h.execute).not.toHaveBeenCalled();
  expect(h.sms).not.toHaveBeenCalled();
  expect(h.dbTouched).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  h.rows.clear();
  h.failOn.clear();
  h.readFrom.length = 0;
  h.rows.set(services, [SERVICE_WITH_DEPOSIT]);
  h.rows.set(clients, [CLIENT_WITH_DEPOSIT]);
  h.rows.set(serviceVariants, [{ id: VARIANT, priceModifier: "20.00" }]);
  h.rows.set(salons, [SALON_WITH_BLIK]);
  h.session.mockResolvedValue(null);
  h.salonCtx.mockResolvedValue(null);
  h.refs.mockResolvedValue(null);
  h.rate.mockReturnValue({ success: true, remaining: 4, reset: 60_000 });
  h.sms.mockResolvedValue({ success: true, notificationId: "notif-1" });
});

afterEach(() => {
  vi.useRealTimers();
  // Żadna ścieżka tego pliku nie dochodzi do numeru BLIK ani do SMS-a.
  expectNoBookingEffects();
});

describe("POST /api/deposits/blik-booking — zadatek wyłączony, flagi zadatku w danych", () => {
  it("rejestr flag jest prawdziwy: isDepositEnabled() = false, ścieżka BLIK nieprzełączona", () => {
    expect(isDepositEnabled()).toBe(false);
    expect(isBlikDepositFlow()).toBe(false);
  });

  it("gość, usługa z deposit_required → 400 DEPOSIT_NOT_APPLICABLE, bez zapisu, numeru BLIK i SMS-a", async () => {
    const { status, body: json } = await parseResponse<Err>(await post(body()));

    expect(status).toBe(400);
    expect(json).toEqual({
      success: false,
      error: "Zadatek nie jest wymagany dla tej rezerwacji",
      code: "DEPOSIT_NOT_APPLICABLE",
    });
    expect(h.readFrom).toContain(services); // wyliczenie naprawdę czytało usługę
    expect(h.readFrom).not.toContain(promotions);
    expect(h.forSalon.mock.calls.map((c) => c[0])).toEqual([SALON]); // tylko wyliczenie
    expect(JSON.stringify(json)).not.toContain(SALON_WITH_BLIK.blikPhone);
  });

  it("klient portalu z require_deposit (zweryfikowany e-mail) → 400 DEPOSIT_NOT_APPLICABLE, ustawienia klienta nieczytane", async () => {
    h.session.mockResolvedValue(PORTAL_CLIENT);

    const { status, body: json } = await parseResponse<Err>(
      await post(body({ guestName: undefined, guestPhone: undefined }))
    );

    expect(status).toBe(400);
    expect(json.code).toBe("DEPOSIT_NOT_APPLICABLE");
    expect(h.readFrom).toContain(services);
    expect(h.readFrom).not.toContain(clients);
  });

  it("z wariantem → 400 DEPOSIT_NOT_APPLICABLE, wariant sprawdzony", async () => {
    const { status, body: json } = await parseResponse<Err>(await post(body({ variantId: VARIANT })));

    expect(status).toBe(400);
    expect(json.code).toBe("DEPOSIT_NOT_APPLICABLE");
    expect(h.readFrom).toContain(serviceVariants);
  });

  it("personel tego salonu z kwotą zadatku → też 400 DEPOSIT_NOT_APPLICABLE", async () => {
    h.session.mockResolvedValue({ user: { id: "u-owner", email: "owner@salon.pl", emailVerified: true } });
    h.salonCtx.mockResolvedValue({ salonId: SALON, role: "owner" });

    const { status, body: json } = await parseResponse<Err>(await post(body()));

    expect(status).toBe(400);
    expect(json.code).toBe("DEPOSIT_NOT_APPLICABLE");
  });

  it("odpowiedź nie zależy od kwoty z body (30 albo 50) — zawsze 400 DEPOSIT_NOT_APPLICABLE", async () => {
    for (const depositAmount of [30, 50, "0.01"]) {
      const { status, body: json } = await parseResponse<Err>(await post(body({ depositAmount })));
      expect(status).toBe(400);
      expect(json.code).toBe("DEPOSIT_NOT_APPLICABLE");
    }
  });
});

describe("POST /api/deposits/blik-booking — zadatek wyłączony, ścieżki błędu", () => {
  it("usługa nie istnieje → 404, bez zapisu", async () => {
    h.rows.set(services, []);

    const { status, body: json } = await parseResponse<Err>(await post(body()));

    expect(status).toBe(404);
    expect(json.error).toBe("Wybrana usluga nie jest juz dostepna. Odswiez strone i wybierz ponownie.");
  });

  it("usługa nieaktywna (mimo flagi zadatku) → 404, bez zapisu", async () => {
    h.rows.set(services, [{ ...SERVICE_WITH_DEPOSIT, isActive: false }]);

    const res = await post(body());

    expect(res.status).toBe(404);
  });

  it("wariant nie istnieje → 404, bez zapisu", async () => {
    h.rows.set(serviceVariants, []);

    const { status, body: json } = await parseResponse<Err>(await post(body({ variantId: VARIANT })));

    expect(status).toBe(404);
    expect(json.error).toBe("Wybrany wariant uslugi nie jest juz dostepny. Odswiez strone i wybierz ponownie.");
  });

  it("błąd bazy przy odczycie usługi → 503 z Retry-After, bez zapisu (fail-closed)", async () => {
    h.failOn.set(services, new Error("connection terminated"));

    const res = await post(body());

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("limit IP przekroczony → 429 z Retry-After, przed walidacją i bazą", async () => {
    h.rate.mockReturnValue({ success: false, remaining: 0, reset: 30_000 });

    const { status, body: json } = await parseResponse<Err>(await post(body()));

    expect(status).toBe(429);
    expect(json.error).toBe("Zbyt wiele żądań. Spróbuj ponownie później.");
    expect(h.forSalon).not.toHaveBeenCalled();
    expect(h.session).not.toHaveBeenCalled();
  });

  it("walidacja (kwota 0, brak pracownika) → 400 VALIDATION_FAILED, bez wyliczenia", async () => {
    for (const patch of [{ depositAmount: 0 }, { employeeId: undefined }]) {
      const { status, body: json } = await parseResponse<Err>(await post(body(patch)));
      expect(status).toBe(400);
      expect(json.code).toBe("VALIDATION_FAILED");
    }
    expect(h.forSalon).not.toHaveBeenCalled();
  });

  it("termin w przeszłości → 400 VALIDATION_FAILED przed sesją i bazą", async () => {
    const { status, body: json } = await parseResponse<Err>(
      await post(body({ startTime: "2026-12-01T08:00:00.000Z", endTime: "2026-12-01T09:00:00.000Z" }))
    );

    expect(status).toBe(400);
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(h.session).not.toHaveBeenCalled();
    expect(h.forSalon).not.toHaveBeenCalled();
  });

  it("gość bez telefonu → 400, bez wyliczenia", async () => {
    const { status, body: json } = await parseResponse<Err>(await post(body({ guestPhone: undefined })));

    expect(status).toBe(400);
    expect(json.error).toBe("Podaj prawidłowy numer telefonu (9 cyfr)");
    expect(h.forSalon).not.toHaveBeenCalled();
  });

  it("obcy pracownik albo usługa (assertSalonRefs) → 400 z refów, bez wyliczenia", async () => {
    h.refs.mockResolvedValue(
      NextResponse.json({ success: false, error: "Nieprawidlowe dane dla tego salonu" }, { status: 400 })
    );

    const { status, body: json } = await parseResponse<Err>(await post(body()));

    expect(status).toBe(400);
    expect(json.error).toBe("Nieprawidlowe dane dla tego salonu");
    expect(h.readFrom).not.toContain(services);
  });
});
