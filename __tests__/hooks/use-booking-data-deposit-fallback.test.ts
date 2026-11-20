import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// #67: create-session odpowiada 400 DEPOSIT_NOT_APPLICABLE, gdy serwer
// (depositDecision) nie pobierze zadatku (kwota ≤ 0 przy required albo
// nieaktualne ustawienia we froncie). Portal ma wtedy zarezerwować zwykłą
// ścieżką (/api/appointments), a nie skończyć błędem — inaczej gość nie
// zarezerwowałby wcale.

const SALON_ID = "salon-1";
const SERVICE_ID = "service-1";
const EMPLOYEE_ID = "employee-1";

// Ten plik testuje ścieżkę płatności online (create-session) — przełącznik
// zadatku BLIK przypięty na false, żeby zmiana jego ciała nie zmieniła testu.
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isBlikDepositFlow: () => false,
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: SALON_ID }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const mutationFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ mutationFetch }));

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

global.fetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith(`/api/salons/${SALON_ID}`)
    ? { success: true, data: salonDetail }
    : { success: true, data: [] };
  return { ok: true, json: async () => body } as Response;
}) as unknown as typeof fetch;

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

function calledUrls(): string[] {
  return mutationFetch.mock.calls.map(([url]) => String(url));
}

describe("useBookingData — zadatek niepobierany po stronie serwera (#67)", () => {
  beforeEach(() => {
    mutationFetch.mockReset();
    vi.clearAllMocks();
  });

  it("400 DEPOSIT_NOT_APPLICABLE z create-session → zwykła rezerwacja przez /api/appointments, sukces", async () => {
    mutationFetch
      .mockResolvedValueOnce(response(400, { success: false, code: "DEPOSIT_NOT_APPLICABLE", error: "x" }))
      .mockResolvedValueOnce(response(201, { success: true, data: { id: "apt-1" } }));
    const { result } = await readyToBook();

    await act(async () => {
      await result.current.handleBookAppointment();
    });

    expect(calledUrls()).toEqual(["/api/deposits/create-session", "/api/appointments"]);
    const sent = JSON.parse(String((mutationFetch.mock.calls[1]![1] as RequestInit).body));
    expect(sent).toMatchObject({ salonId: SALON_ID, serviceId: SERVICE_ID, employeeId: EMPLOYEE_ID });
    expect(result.current.bookingSuccess).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("inny błąd 400 z create-session → komunikat, BEZ rezerwacji bez zadatku", async () => {
    mutationFetch.mockResolvedValueOnce(response(400, { success: false, error: "Nieprawidlowa kwota zadatku" }));
    const { result } = await readyToBook();

    await act(async () => {
      await result.current.handleBookAppointment();
    });

    expect(calledUrls()).toEqual(["/api/deposits/create-session"]);
    expect(toast.error).toHaveBeenCalledWith("Nieprawidlowa kwota zadatku");
    expect(result.current.bookingSuccess).toBe(false);
  });

  it("409 z create-session → komunikat o zajętym terminie, bez drugiego wywołania", async () => {
    mutationFetch.mockResolvedValueOnce(response(409, { success: false, error: "zajety" }));
    const { result } = await readyToBook();

    await act(async () => {
      await result.current.handleBookAppointment();
    });

    expect(calledUrls()).toEqual(["/api/deposits/create-session"]);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/zajety/));
  });

  it("404 MODULE_DISABLED z create-session (stara karta po wyłączeniu płatności online) → komunikat, nie pusty ekran", async () => {
    mutationFetch.mockResolvedValueOnce(
      response(404, { success: false, code: "MODULE_DISABLED", error: "Ta funkcja jest obecnie niedostępna." }),
    );
    const { result } = await readyToBook();

    await act(async () => {
      await result.current.handleBookAppointment();
    });

    expect(calledUrls()).toEqual(["/api/deposits/create-session"]);
    expect(toast.error).toHaveBeenCalledWith("Ta funkcja jest obecnie niedostępna.");
    expect(result.current.isProcessingPayment).toBe(false);
    expect(result.current.bookingSuccess).toBe(false);
    expect(result.current.selectedServiceId).toBe(SERVICE_ID);
  });
});
