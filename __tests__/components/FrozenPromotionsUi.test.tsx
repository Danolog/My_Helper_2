/**
 * Promocje złożone i generowanie grafik są zamrożone (B2). Interfejs nie może
 * pokazywać niczego, co woła zablokowane trasy albo tworzy zamrożony typ:
 * - strona promocji: bez sekcji „Generator banerow AI” (imageGen),
 * - wybór typu promocji: tylko rabat procentowy i kwotowy,
 * - portal rezerwacji: bez zapytania o happy hours, cena pełna.
 * Kontrola: przy module włączonym w kontekście (symulacja odmrożenia)
 * sekcja banera wraca.
 */
import { renderHook, render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES, type ModulesState } from "@/lib/features";

const SALON_ID = "salon-1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: SALON_ID }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
}));
vi.mock("@/hooks/use-subscription", () => ({
  // Plan Basic: bramka Pro pokazuje nazwę funkcji — po niej poznajemy sekcję.
  useSubscription: () => ({ isProPlan: false, loading: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/api-client", () => ({ mutationFetch: vi.fn() }));
vi.mock("@/components/promotions/banner-generator", () => ({
  BannerGenerator: () => <div>banner-generator</div>,
}));
vi.mock("@/app/dashboard/promotions/_hooks/use-promotions-data", () => ({
  usePromotionsData: () => ({
    session: { user: { id: "owner" } },
    isPending: false,
    salonId: SALON_ID,
    promotionsList: [],
    servicesList: [],
    loading: false,
    deleteTarget: null,
    deleting: false,
    setDeleteTarget: vi.fn(),
    fetchPromotions: vi.fn(),
    handleDelete: vi.fn(),
    handleToggleActive: vi.fn(),
    notifyPromotionsChanged: vi.fn(),
  }),
}));

const PROMOTIONS_ON: ModulesState = { ...DEFAULT_MODULES, promotions: true };

// Formularz promocji odtwarza szkic z localStorage — środowisko testu nie ma
// pełnego Storage, podmieniamy cały obiekt (jak use-form-recovery.test.ts).
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
    writable: true,
    configurable: true,
  });
});

describe("strona promocji — generator banerów (imageGen)", () => {
  async function renderPage(modules: ModulesState) {
    const { default: PromotionsPage } = await import("@/app/dashboard/promotions/page");
    return render(
      <ModulesProvider modules={modules}>
        <PromotionsPage />
      </ModulesProvider>
    );
  }

  it("moduł zamrożony: brak sekcji generatora banerów", async () => {
    await renderPage(PROMOTIONS_ON);
    expect(await screen.findByText("Promocje")).toBeInTheDocument();
    expect(screen.queryByText(/Generator banerow AI/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Imagen/)).not.toBeInTheDocument();
  });

  it("kontrola: po odmrożeniu imageGen sekcja wraca", async () => {
    await renderPage({ ...PROMOTIONS_ON, imageGen: true });
    expect((await screen.findAllByText(/Generator banerow AI/i)).length).toBeGreaterThan(0);
  });
});

describe("wybór typu promocji", () => {
  it("tylko rabat procentowy i kwotowy", async () => {
    const { AVAILABLE_PROMOTION_TYPE_OPTIONS } = await import(
      "@/app/dashboard/promotions/_components/promotion-dialog"
    );
    expect(AVAILABLE_PROMOTION_TYPE_OPTIONS.map((o) => o.value)).toEqual(["percentage", "fixed"]);
  });
});

describe("portal rezerwacji — happy hours", () => {
  const salonDetail = {
    id: SALON_ID,
    name: "Salon Testowy",
    services: [
      {
        id: "service-1",
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
    const body = url.startsWith(`/api/salons/${SALON_ID}/services`)
      ? { success: true, data: { employees: [{ id: "emp-1", firstName: "A", lastName: "B", role: "x", color: null }] } }
      : url.startsWith(`/api/salons/${SALON_ID}`)
        ? { success: true, data: salonDetail }
        : url.startsWith("/api/promotions/check-happy-hours")
          ? { success: true, data: { eligible: true, discountPercent: 50 } }
          : { success: true, data: { slots: ["10:00"] } };
    return { ok: true, json: async () => body } as Response;
  });

  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("wybór terminu nie pyta o happy hours, cena zostaje pełna", async () => {
    const { useBookingData } = await import(
      "@/app/(client)/salons/[id]/book/_hooks/use-booking-data"
    );
    const { result } = renderHook(() => useBookingData());
    await waitFor(() => expect(result.current.salon).not.toBeNull());

    act(() => result.current.handleServiceSelect("service-1"));
    act(() => result.current.handleEmployeeSelect("emp-1"));
    act(() => result.current.handleDateChange("2026-11-23"));
    act(() => result.current.setSelectedTimeSlot("10:00"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.selectedTimeSlot).toBe("10:00");
    const urls = mockFetch.mock.calls.map(([input]) => String(input));
    expect(urls.some((u) => u.includes("check-happy-hours"))).toBe(false);
    expect(result.current.happyHoursPromo).toBeNull();
    expect(result.current.derived.activePromoType).toBe("none");
    expect(result.current.derived.effectivePrice).toBe(100);
  });
});
