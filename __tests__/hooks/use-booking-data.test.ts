import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Regresja (dane osobowe w logach): hook rezerwacji nie moze wysylac e-maila
// goscia/klienta w adresie URL do /api/promotions/check-first-visit. Query
// string trafia do logow zadan (Vercel, proxy), a trasa po decyzji Sophii
// (aneks B2) i tak zawsze zwraca eligible:false.

const SALON_ID = "salon-1";
const SERVICE_ID = "service-1";
const GUEST_EMAIL = "gosc.testowy+promo@example.com";
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

const salonDetail = {
  id: SALON_ID,
  name: "Salon Testowy",
  services: [
    {
      id: SERVICE_ID,
      name: "Strzyzenie",
      basePrice: "100.00",
      baseDuration: 60,
      variants: [],
      depositRequired: false,
      depositPercentage: null,
    },
  ],
};

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith(`/api/salons/${SALON_ID}`)
    ? { success: true, data: salonDetail }
    : url.startsWith("/api/promotions/check-first-visit")
      ? { success: true, data: { eligible: true, discountPercent: 20 } }
      : { success: true, data: [] };
  return { ok: true, json: async () => body } as Response;
});
global.fetch = mockFetch as unknown as typeof fetch;

import { useBookingData } from "@/app/(client)/salons/[id]/book/_hooks/use-booking-data";

function calledUrls(): string[] {
  return mockFetch.mock.calls.map(([input]) => String(input));
}

async function renderWithSelectedService() {
  const hook = renderHook(() => useBookingData());
  await waitFor(() => expect(hook.result.current.salon).not.toBeNull());
  act(() => {
    hook.result.current.handleServiceSelect(SERVICE_ID);
  });
  return hook;
}

describe("useBookingData — brak e-maila w URL sprawdzenia pierwszej wizyty", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockSession.data = null;
  });

  it("gosc: wpisany e-mail nie trafia do zadnego URL i nie ma wywolania check-first-visit", async () => {
    const { result } = await renderWithSelectedService();

    act(() => {
      result.current.setGuestEmail(GUEST_EMAIL);
    });
    // Daj efektom szanse sie wykonac po zmianie e-maila.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const urls = calledUrls();
    expect(urls.some((u) => u.includes("check-first-visit"))).toBe(false);
    expect(urls.some((u) => u.includes(encodeURIComponent(GUEST_EMAIL)))).toBe(false);
    expect(urls.some((u) => u.includes(GUEST_EMAIL))).toBe(false);
  });

  it("zalogowany klient: brak wywolania check-first-visit z e-mailem sesji", async () => {
    mockSession.data = { user: { email: USER_EMAIL } };
    await renderWithSelectedService();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(calledUrls().some((u) => u.includes("check-first-visit"))).toBe(false);
  });

  it("brak rabatu pierwszej wizyty po stronie klienta (cena = cena bazowa)", async () => {
    const { result } = await renderWithSelectedService();
    act(() => {
      result.current.setGuestEmail(GUEST_EMAIL);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.firstVisitPromo).toBeNull();
    expect(result.current.derived.firstVisitDiscountAmount).toBe(0);
    expect(result.current.derived.activePromoType).toBe("none");
    expect(result.current.derived.effectivePrice).toBe(100);
  });
});
