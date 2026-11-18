/**
 * Salon bez ważnej subskrypcji działa w trybie tylko do odczytu.
 *
 * Stan docelowy:
 * - rezerwacja online w salonie bez ważnej subskrypcji -> 403
 *   `SALON_BOOKING_UNAVAILABLE`,
 * - zapis personelu w takim salonie -> 403 `SUBSCRIPTION_READ_ONLY`,
 * - brak wiersza subskrypcji nie daje pełnego dostępu,
 * - `canceled` zachowuje plan do końca opłaconego okresu.
 *
 * Stan subskrypcji salonu jest opisany na poziomie bazy (atrapa oddaje wiersze
 * tabeli `salon_subscriptions` po tabeli z `from(...)`), więc test nie zależy
 * od tego, którą funkcją trasa odczyta subskrypcję, o ile odczyt idzie przez `select().from(salonSubscriptions)` i zwraca płaskie pola wiersza.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSubscriptionRows, mockInsertRows, mockGetOptionalSession } = vi.hoisted(() => ({
  mockSubscriptionRows: vi.fn(),
  mockInsertRows: vi.fn(),
  mockGetOptionalSession: vi.fn(),
}));

// Każde select() to osobny łańcuch; wynik zależy od tabeli przekazanej do from().
// Tabela salon_subscriptions -> wiersze przypadku, pozostałe -> brak wierszy.
vi.mock("@/lib/db", async () => {
  const { salonSubscriptions } = await import("@/lib/schema");
  const selectChain = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    for (const m of ["innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy", "for"]) {
      chain[m] = () => chain;
    }
    chain.from = (t: unknown) => {
      table = t;
      return chain;
    };
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => (table === salonSubscriptions ? mockSubscriptionRows() : []))
        .then(res, rej);
    return chain;
  };
  const insertChain = () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["values", "returning", "onConflictDoNothing"]) chain[m] = () => chain;
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mockInsertRows()).then(res, rej);
    return chain;
  };
  const tx = {
    select: () => selectChain(),
    insert: () => insertChain(),
    execute: () => Promise.resolve(undefined),
  };
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/session", () => ({ getOptionalSession: () => mockGetOptionalSession() }));
vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: vi.fn().mockResolvedValue(null),
  getUserSalon: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: vi.fn().mockResolvedValue(null),
  hasFeatureAccess: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { check: vi.fn().mockReturnValue({ success: true, remaining: 4, reset: 60000 }) },
  apiRateLimit: { check: vi.fn().mockReturnValue({ success: true, remaining: 59, reset: 60000 }) },
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/salon-refs", () => ({
  assertSalonRefs: vi.fn(async () => null),
  SALON_REF_ERROR: "Nieprawidlowe dane dla tego salonu",
}));
vi.mock("@/lib/deposit-guard", () => ({ depositGuardResponse: vi.fn(async () => null) }));
vi.mock("@/lib/sms", () => ({ sendBookingConfirmationSms: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as createAppointment } from "@/app/api/appointments/route";
import { logger } from "@/lib/logger";
import { getCurrentPlan } from "@/lib/subscription";
import { createMockRequest, makeAppointment, parseResponse, TEST_IDS } from "./helpers";

const SALON = TEST_IDS.SALON_UUID;
const NOW = new Date("2026-11-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** Wiersz subskrypcji salonu z polami tabeli i polami odczytu planu. */
function subscriptionRow(status: string, planSlug: "basic" | "pro", dates: {
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  canceledAt?: Date | null;
}) {
  return {
    salonId: SALON,
    planId: TEST_IDS.VALID_UUID,
    status,
    trialEndsAt: dates.trialEndsAt ?? null,
    currentPeriodEnd: dates.currentPeriodEnd ?? null,
    canceledAt: dates.canceledAt ?? null,
    createdAt: new Date(NOW.getTime() - 60 * DAY),
    planSlug,
    planName: planSlug === "pro" ? "Pro" : "Basic",
  };
}

const ACTIVE_PRO = subscriptionRow("active", "pro", {
  currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
});

function guestBookingRequest() {
  return createMockRequest("http://localhost:3000/api/appointments", {
    method: "POST",
    body: {
      salonId: SALON,
      employeeId: TEST_IDS.EMPLOYEE_UUID,
      serviceId: TEST_IDS.SERVICE_UUID,
      startTime: "2026-11-20T10:00:00Z",
      endTime: "2026-11-20T11:00:00Z",
      guestName: "Jan Kowalski",
      guestPhone: "123456789",
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockSubscriptionRows.mockReset().mockReturnValue([]);
  mockGetOptionalSession.mockReset().mockResolvedValue(null);
  vi.mocked(logger.error).mockClear();
  mockInsertRows.mockReset().mockReturnValue([
    makeAppointment({
      clientId: null,
      guestName: "Jan Kowalski",
      guestPhone: "+48123456789",
      startTime: new Date("2026-11-20T10:00:00Z"),
      endTime: new Date("2026-11-20T11:00:00Z"),
    }),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rezerwacja online gościa a subskrypcja salonu", () => {
  // Przypadek opisuje zachowanie docelowe; po wejściu poprawki `it.fails` zmienia się w `it`.
  it.fails("gość nie zarezerwuje wizyty w salonie po zakończeniu okresu próbnego (403 SALON_BOOKING_UNAVAILABLE)", async () => {
    mockSubscriptionRows.mockReturnValue([
      subscriptionRow("trialing", "pro", {
        trialEndsAt: new Date(NOW.getTime() - DAY),
        currentPeriodEnd: new Date(NOW.getTime() - DAY),
      }),
    ]);

    const { status, body } = await parseResponse(await createAppointment(guestBookingRequest()));

    expect(status).toBe(403);
    expect(body).toMatchObject({ success: false, code: "SALON_BOOKING_UNAVAILABLE" });
    expect(mockInsertRows).not.toHaveBeenCalled();
  });

  it("gość rezerwuje wizytę w salonie z ważną subskrypcją (201)", async () => {
    mockSubscriptionRows.mockReturnValue([ACTIVE_PRO]);

    const { status, body } = await parseResponse(await createAppointment(guestBookingRequest()));

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(mockInsertRows).toHaveBeenCalledTimes(1);
  });
});

describe("getCurrentPlan — brak wiersza, anulowanie z opłaconym okresem", () => {
  it("wiersz active planu Pro daje plan Pro ze statusem active", async () => {
    mockSubscriptionRows.mockReturnValue([ACTIVE_PRO]);
    expect(await getCurrentPlan(SALON)).toMatchObject({ slug: "pro", status: "active" });
  });

  it("salon bez wiersza subskrypcji nie dostaje statusu active", async () => {
    mockSubscriptionRows.mockReturnValue([]);
    const plan = await getCurrentPlan(SALON);
    expect(plan.status).not.toBe("active");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.todo("anulowana subskrypcja Pro z opłaconym okresem w przyszłości zachowuje plan Pro do końca okresu");
});

describe("zapis personelu a subskrypcja salonu", () => {
  it.todo("zapis personelu (POST /api/services) w salonie po zakończeniu okresu próbnego -> 403 SUBSCRIPTION_READ_ONLY");
});
