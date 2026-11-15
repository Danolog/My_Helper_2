import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AppointmentDetailPage from "@/app/dashboard/appointments/[id]/page";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES, type ModulesState } from "@/lib/features";

// Stabilny obiekt routera — strona ma go w zależnościach efektów pobierania.
const router = vi.hoisted(() => ({ push: () => {}, replace: () => {}, back: () => {} }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "appt-1" }),
  useRouter: () => router,
}));

// Dialogi ładowane leniwie nie są przedmiotem testu.
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false }),
}));

vi.mock("@/hooks/use-salon-id", () => ({
  useSalonId: () => ({ salonId: "salon-1", loading: false }),
}));

vi.mock("@/hooks/use-tab-sync", () => ({
  useTabSync: vi.fn(),
}));

// Karty szczegółów wizyty mają własne testy; tu liczy się, o co strona pyta API.
vi.mock("@/components/appointments/detail", () => ({
  AppointmentHeader: () => <div data-testid="stub-header" />,
  AppointmentInfoCard: () => null,
  AppointmentRefundStatus: () => null,
  AppointmentNotes: () => null,
  AppointmentTreatment: () => null,
  AppointmentCommission: () => null,
  AppointmentInvoiceCard: () => <div data-testid="stub-invoice-card" />,
  AppointmentMaterials: () => null,
}));

const APPOINTMENT = {
  id: "appt-1",
  salonId: "salon-1",
  status: "completed",
  startTime: "2026-11-10T10:00:00.000Z",
  endTime: "2026-11-10T10:30:00.000Z",
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/appointments/appt-1")) {
      return { ok: true, json: async () => ({ success: true, data: APPOINTMENT }) } as Response;
    }
    if (url.endsWith("/api/appointments/appt-1/invoice")) {
      return {
        ok: true,
        json: async () => ({ success: true, hasInvoice: true, data: { id: "inv-1" } }),
      } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
  });
}

function renderPage(modules: ModulesState = DEFAULT_MODULES) {
  return render(
    <ModulesProvider modules={modules}>
      <AppointmentDetailPage />
    </ModulesProvider>
  );
}

function fetchedUrls(): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

describe("AppointmentDetailPage — faktury zamrożone", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("nie pyta API o fakturę wizyty i nie pokazuje karty faktury", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("stub-header")).toBeInTheDocument();
    });

    expect(fetchedUrls()).toContain("/api/appointments/appt-1");
    expect(fetchedUrls().filter((u) => u.includes("/invoice"))).toEqual([]);
    expect(screen.queryByTestId("stub-invoice-card")).not.toBeInTheDocument();
  });

  it("fiskalizacja usunięta (B5): zakończona wizyta renderuje się bez pytania o paragon i bez błędów", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("stub-header")).toBeInTheDocument();
    });

    expect(fetchedUrls().filter((u) => u.includes("fiscal-receipt"))).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fiskalizacja usunięta (B5): nawet flaga fiscal w stanie modułów nie przywraca pytania o paragon", async () => {
    renderPage({ ...DEFAULT_MODULES, fiscal: true });

    await waitFor(() => {
      expect(screen.getByTestId("stub-header")).toBeInTheDocument();
    });

    expect(fetchedUrls()).toContain("/api/appointments/appt-1");
    expect(fetchedUrls().filter((u) => u.includes("fiscal"))).toEqual([]);
  });

  it("kontrola: przy module faktur włączonym strona pobiera fakturę i pokazuje kartę", async () => {
    renderPage({ ...DEFAULT_MODULES, invoices: true });

    await waitFor(() => {
      expect(screen.getByTestId("stub-invoice-card")).toBeInTheDocument();
    });
    expect(fetchedUrls()).toContain("/api/appointments/appt-1/invoice");
  });
});
