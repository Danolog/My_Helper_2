import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Kazdy wolajacy /api/available-slots wysyla salonId swojego kontekstu
// (salon z sesji panelu albo params.id portalu klienta), a bez salonu
// nie pyta trasy wcale. Trasa jeszcze nie czyta tego parametru.

const SALON_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "service-1";
const PACKAGE_ID = "package-1";
const EMPLOYEE_ID = "employee-1";
const DATE = "2026-12-01";

const routeParams: { id: string } = { id: SALON_ID };

vi.mock("next/navigation", () => ({
  useParams: () => routeParams,
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

// Pakiety sa zamrozone (FROZEN_PROMOTION_TYPES); tu odmrazamy je, zeby dojsc do zapytania
// o terminy w hooku pakietow. Atrapa czesciowa: reszta rejestru (w tym
// isBlikDepositFlow) jest prawdziwa.
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isPromotionTypeFrozen: () => false,
}));

const service = {
  id: SERVICE_ID,
  name: "Strzyzenie",
  basePrice: "100.00",
  baseDuration: 60,
  variants: [],
  depositRequired: false,
  depositPercentage: null,
};

const employee = {
  id: EMPLOYEE_ID,
  firstName: "Anna",
  lastName: "Nowak",
  role: "stylist",
  color: null,
  isActive: true,
};

function bodyFor(url: string): unknown {
  if (url.startsWith("/api/available-slots")) {
    return { success: true, data: { slots: [] } };
  }
  if (url.startsWith("/api/services?")) {
    return { success: true, data: [service] };
  }
  if (url.includes("/employee-assignments")) {
    return { success: true, data: [{ employee }] };
  }
  if (url.startsWith("/api/promotions/check-package")) {
    return { success: true, data: [{ id: PACKAGE_ID, totalDuration: 90 }] };
  }
  if (url.startsWith("/api/employees?")) {
    return { success: true, data: [employee] };
  }
  if (/^\/api\/salons\/[^/]*\/services\//.test(url)) {
    return { success: true, data: { employees: [employee] } };
  }
  if (url.startsWith("/api/salons/")) {
    return { success: true, data: { id: routeParams.id, name: "Salon", services: [service] } };
  }
  return { success: true, data: [] };
}

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const body = bodyFor(String(input));
  return { ok: true, json: async () => body } as Response;
});
global.fetch = mockFetch as unknown as typeof fetch;

import { useBookingData } from "@/app/(client)/salons/[id]/book/_hooks/use-booking-data";
import { usePackageBooking } from "@/app/dashboard/booking/_hooks/use-package-booking";
import { useServiceBooking } from "@/app/dashboard/booking/_hooks/use-service-booking";

function slotUrls(): URL[] {
  return mockFetch.mock.calls
    .map(([input]) => String(input))
    .filter((u) => u.startsWith("/api/available-slots"))
    .map((u) => new URL(u, "http://localhost"));
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  mockFetch.mockClear();
  routeParams.id = SALON_ID;
});

describe("useServiceBooking — salonId w zapytaniu o wolne terminy", () => {
  async function renderReady(initial: string | null) {
    const hook = renderHook(({ salonId }) => useServiceBooking({ salonId }), {
      initialProps: { salonId: initial },
    });
    await settle();
    act(() => hook.result.current.handleServiceChange(SERVICE_ID));
    await settle();
    act(() => hook.result.current.handleEmployeeSelect(EMPLOYEE_ID));
    act(() => hook.result.current.handleDateChange(DATE));
    await settle();
    return hook;
  }

  it("wysyla salonId salonu z sesji panelu", async () => {
    await renderReady(SALON_ID);

    await waitFor(() => expect(slotUrls().length).toBeGreaterThan(0));
    for (const url of slotUrls()) {
      expect(url.searchParams.get("salonId")).toBe(SALON_ID);
      expect(url.searchParams.get("employeeId")).toBe(EMPLOYEE_ID);
      expect(url.searchParams.get("date")).toBe(DATE);
    }
  });

  it("bez salonu nie pyta o terminy", async () => {
    await renderReady(null);
    expect(slotUrls()).toHaveLength(0);
  });

  it("utrata salonu po wyborze terminu nie wysyla zapytania bez salonId", async () => {
    const hook = await renderReady(SALON_ID);
    await waitFor(() => expect(slotUrls().length).toBeGreaterThan(0));
    mockFetch.mockClear();

    hook.rerender({ salonId: null });
    await settle();

    expect(slotUrls()).toHaveLength(0);
    expect(hook.result.current.slotsData).toBeNull();
  });
});

describe("usePackageBooking — salonId w zapytaniu o wolne terminy", () => {
  async function renderReady(initial: string | null) {
    const hook = renderHook(
      ({ salonId }) => usePackageBooking({ salonId, selectedClientId: "" }),
      { initialProps: { salonId: initial } },
    );
    await settle();
    act(() => hook.result.current.handleSelectPackage(PACKAGE_ID));
    act(() => hook.result.current.handlePackageEmployeeSelect(EMPLOYEE_ID));
    act(() => hook.result.current.handlePackageDateChange(DATE));
    await settle();
    return hook;
  }

  it("wysyla salonId salonu z sesji panelu", async () => {
    await renderReady(SALON_ID);

    await waitFor(() => expect(slotUrls().length).toBeGreaterThan(0));
    for (const url of slotUrls()) {
      expect(url.searchParams.get("salonId")).toBe(SALON_ID);
      expect(url.searchParams.get("employeeId")).toBe(EMPLOYEE_ID);
      expect(url.searchParams.get("duration")).toBe("90");
    }
  });

  it("bez salonu nie pyta o terminy", async () => {
    await renderReady(null);
    expect(slotUrls()).toHaveLength(0);
  });

  it("utrata salonu po wyborze terminu nie wysyla zapytania bez salonId", async () => {
    const hook = await renderReady(SALON_ID);
    await waitFor(() => expect(slotUrls().length).toBeGreaterThan(0));
    mockFetch.mockClear();

    hook.rerender({ salonId: null });
    await settle();

    expect(slotUrls()).toHaveLength(0);
    expect(hook.result.current.packageSlotsData).toBeNull();
  });
});

describe("useBookingData (portal klienta) — salonId w zapytaniu o wolne terminy", () => {
  async function renderReady() {
    const hook = renderHook(() => useBookingData());
    await waitFor(() => expect(hook.result.current.salon).not.toBeNull());
    act(() => hook.result.current.handleServiceSelect(SERVICE_ID));
    await settle();
    act(() => hook.result.current.handleEmployeeSelect(EMPLOYEE_ID));
    act(() => hook.result.current.handleDateChange(DATE));
    await settle();
    return hook;
  }

  it("wysyla salonId rowny params.id", async () => {
    await renderReady();

    await waitFor(() => expect(slotUrls().length).toBeGreaterThan(0));
    for (const url of slotUrls()) {
      expect(url.searchParams.get("salonId")).toBe(SALON_ID);
      expect(url.searchParams.get("employeeId")).toBe(EMPLOYEE_ID);
      expect(url.searchParams.get("date")).toBe(DATE);
    }
  });

  it("koduje salonId z adresu", async () => {
    routeParams.id = "a&b=c";
    await renderReady();

    await waitFor(() => expect(slotUrls().length).toBeGreaterThan(0));
    for (const url of slotUrls()) {
      expect(url.searchParams.get("salonId")).toBe("a&b=c");
      expect(url.searchParams.get("b")).toBeNull();
    }
  });

  it("bez params.id nie pyta o terminy", async () => {
    routeParams.id = "";
    await renderReady();
    expect(slotUrls()).toHaveLength(0);
  });
});
