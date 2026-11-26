import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Portal rezerwacji a wyłączony zadatek (isDepositEnabled): hook nie liczy
// zadatku, nie pyta o ustawienia zadatku klienta i rezerwuje zwykłą ścieżką
// (/api/appointments), nawet gdy dane salonu albo klienta niosą stare flagi.
// Po włączeniu zadatku ta sama usługa prowadzi do płatności zadatku.

const SALON_ID = "salon-1";
const SERVICE_ID = "service-1";
const EMPLOYEE_ID = "employee-1";

const flags = vi.hoisted(() => ({ deposit: false }));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isDepositEnabled: () => flags.deposit,
  isBlikDepositFlow: () => false,
}));

const sessionState = vi.hoisted(() => ({
  data: null as null | { user: { id: string; email: string } },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: SALON_ID }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: sessionState.data }) }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const mutationFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ mutationFetch }));

/** Usługa zapisana przed wyłączeniem zadatku — z flagą zadatku 30%. */
const salonDetail = {
  id: SALON_ID,
  name: "Salon Testowy",
  services: [
    {
      id: SERVICE_ID,
      name: "Koloryzacja",
      basePrice: "100.00",
      baseDuration: 60,
      variants: [],
      depositRequired: true,
      depositPercentage: 30,
    },
  ],
};

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  let body: unknown = { success: true, data: [] };
  if (url.startsWith(`/api/salons/${SALON_ID}`)) body = { success: true, data: salonDetail };
  if (url.startsWith("/api/clients/deposit-settings")) {
    body = { success: true, data: { found: true, requireDeposit: true, depositType: "fixed", depositValue: "40" } };
  }
  return { ok: true, json: async () => body } as Response;
});
global.fetch = mockFetch as unknown as typeof fetch;

import { useBookingData } from "@/app/(client)/salons/[id]/book/_hooks/use-booking-data";

function response(status: number, json: unknown) {
  return { status, ok: status < 400, json: async () => json } as Response;
}

async function readyToBook() {
  const hook = renderHook(() => useBookingData());
  await waitFor(() => expect(hook.result.current.salon).not.toBeNull());
  act(() => hook.result.current.handleServiceSelect(SERVICE_ID));
  act(() => hook.result.current.handleEmployeeSelect(EMPLOYEE_ID));
  act(() => hook.result.current.handleDateChange("2026-12-01"));
  act(() => {
    hook.result.current.setSelectedTimeSlot("10:00");
    hook.result.current.setGuestName("Jan Kowalski");
    hook.result.current.setGuestPhone("123 456 789");
  });
  return hook;
}

function fetchedUrls(): string[] {
  return mockFetch.mock.calls.map(([input]) => String(input));
}

function mutatedUrls(): string[] {
  return mutationFetch.mock.calls.map(([url]) => String(url));
}

describe("useBookingData — zadatek wyłączony", () => {
  beforeEach(() => {
    flags.deposit = false;
    sessionState.data = null;
    mockFetch.mockClear();
    mutationFetch.mockReset();
    vi.clearAllMocks();
  });

  it("usługa z flagą zadatku: brak zadatku w wartościach pochodnych", async () => {
    const { result } = await readyToBook();

    expect(result.current.derived.depositRequired).toBe(false);
    expect(result.current.derived.depositAmount).toBe(0);
    expect(result.current.derived.canShowSummaryStep).toBe(true);
  });

  it("rezerwacja idzie zwykłą ścieżką, bez create-session i blik-booking", async () => {
    mutationFetch.mockResolvedValueOnce(response(201, { success: true, data: { id: "apt-1" } }));
    const { result } = await readyToBook();

    await act(async () => {
      await result.current.handleBookAppointment();
    });

    expect(mutatedUrls()).toEqual(["/api/appointments"]);
    expect(result.current.bookingSuccess).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("zalogowany klient: bez zapytania o ustawienia zadatku i bez zadatku klienta", async () => {
    sessionState.data = { user: { id: "user-1", email: "klient@example.com" } };
    const { result } = await readyToBook();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(fetchedUrls().some((u) => u.startsWith("/api/clients/deposit-settings"))).toBe(false);
    expect(result.current.derived.depositRequired).toBe(false);
    expect(result.current.derived.depositAmount).toBe(0);
  });
});

describe("useBookingData — zadatek włączony (kontrola logiki)", () => {
  beforeEach(() => {
    flags.deposit = true;
    sessionState.data = null;
    mockFetch.mockClear();
    mutationFetch.mockReset();
    vi.clearAllMocks();
  });

  it("usługa z flagą zadatku: zadatek 30% z 100 PLN", async () => {
    const { result } = await readyToBook();

    expect(result.current.derived.depositRequired).toBe(true);
    expect(result.current.derived.depositAmount).toBe(30);
    expect(result.current.derived.depositPercentage).toBe(30);
  });

  it("rezerwacja idzie przez create-session", async () => {
    mutationFetch.mockResolvedValueOnce(response(409, { success: false, error: "zajety" }));
    const { result } = await readyToBook();

    await act(async () => {
      await result.current.handleBookAppointment();
    });

    expect(mutatedUrls()).toEqual(["/api/deposits/create-session"]);
  });

  it("zalogowany klient: zadatek klienta (stała kwota) ma pierwszeństwo przed usługą", async () => {
    sessionState.data = { user: { id: "user-1", email: "klient@example.com" } };
    const { result } = await readyToBook();

    await waitFor(() => expect(result.current.derived.depositAmount).toBe(40));
    expect(fetchedUrls()).toContain(`/api/clients/deposit-settings?salonId=${SALON_ID}`);
    expect(result.current.derived.depositRequired).toBe(true);
    expect(result.current.derived.depositPercentage).toBe(0);
  });
});
