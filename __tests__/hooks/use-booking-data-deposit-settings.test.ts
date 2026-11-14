import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// P1 (IDOR /api/clients/deposit-settings): hook rezerwacji pyta o ustawienia
// zadatku zalogowanego klienta bez e-maila w URL — trasa bierze go z sesji.

const SALON_ID = "salon-1";
const USER_EMAIL = "klient.zalogowany@example.com";

const mockSession: { data: unknown } = { data: null };

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: SALON_ID }),
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => mockSession,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith(`/api/salons/${SALON_ID}`)
    ? { success: true, data: { id: SALON_ID, name: "Salon", services: [] } }
    : { success: true, data: { found: false, requireDeposit: false, depositType: null, depositValue: null } };
  return { ok: true, json: async () => body } as Response;
});
global.fetch = mockFetch as unknown as typeof fetch;

import { useBookingData } from "@/app/(client)/salons/[id]/book/_hooks/use-booking-data";

function calledUrls(): string[] {
  return mockFetch.mock.calls.map(([input]) => String(input));
}

describe("useBookingData — ustawienia zadatku bez e-maila w URL", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockSession.data = { user: { email: USER_EMAIL } };
  });

  it("zalogowany klient: wywolanie deposit-settings tylko z salonId, bez e-maila", async () => {
    renderHook(() => useBookingData());

    await waitFor(() =>
      expect(calledUrls().some((u) => u.startsWith("/api/clients/deposit-settings"))).toBe(true)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const depositCalls = calledUrls().filter((u) => u.startsWith("/api/clients/deposit-settings"));
    expect(depositCalls).toEqual([`/api/clients/deposit-settings?salonId=${SALON_ID}`]);
    expect(calledUrls().some((u) => u.includes("email="))).toBe(false);
    expect(calledUrls().some((u) => u.includes(encodeURIComponent(USER_EMAIL)))).toBe(false);
  });

  it("gosc: brak wywolania deposit-settings", async () => {
    mockSession.data = null;
    const { result } = renderHook(() => useBookingData());
    await waitFor(() => expect(result.current.salon).not.toBeNull());

    expect(calledUrls().some((u) => u.startsWith("/api/clients/deposit-settings"))).toBe(false);
  });
});
