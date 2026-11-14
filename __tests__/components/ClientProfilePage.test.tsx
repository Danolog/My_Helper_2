import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ClientProfilePage from "@/app/dashboard/clients/[id]/page";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES, type ModulesState } from "@/lib/features";

// Stabilny obiekt routera — strona ma go w zależnościach efektów pobierania.
const router = vi.hoisted(() => ({ push: () => {}, replace: () => {}, back: () => {} }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "client-1" }),
  useRouter: () => router,
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

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

// Zakładki mają własne pobieranie danych — tutaj interesuje nas tylko to,
// które zakładki strona w ogóle pokazuje.
vi.mock("@/components/clients/client-profile-header", () => ({
  ClientProfileHeader: () => <div data-testid="stub-header" />,
}));
vi.mock("@/components/clients/client-profile-tab", () => ({
  ClientProfileTab: () => <div data-testid="stub-profile" />,
}));
vi.mock("@/components/clients/client-history-tab", () => ({
  ClientHistoryTab: () => <div data-testid="stub-history" />,
}));
vi.mock("@/components/clients/client-insights-tab", () => ({
  ClientInsightsTab: () => <div data-testid="stub-insights" />,
}));
vi.mock("@/components/clients/client-loyalty-tab", () => ({
  ClientLoyaltyTab: () => <div data-testid="stub-loyalty" />,
}));

const CLIENT = {
  id: "client-1",
  salonId: "salon-1",
  firstName: "Anna",
  lastName: "Nowak",
  phone: null,
  email: null,
  notes: null,
  preferences: null,
  allergies: null,
  favoriteEmployeeId: null,
  birthday: null,
  requireDeposit: false,
  depositType: null,
  depositValue: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/clients/client-1")) {
      return { ok: true, json: async () => ({ success: true, data: CLIENT }) } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
  });
}

function renderPage(modules: ModulesState = DEFAULT_MODULES) {
  return render(
    <ModulesProvider modules={modules}>
      <ClientProfilePage />
    </ModulesProvider>
  );
}

describe("ClientProfilePage — zakładka punktów lojalnościowych", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lojalność zamrożona: zakładki punktów nie ma, pozostałe są", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("client-tabs")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("tab-loyalty")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/lojalno/i);

    expect(screen.getByTestId("tab-profile")).toBeInTheDocument();
    expect(screen.getByTestId("tab-history")).toBeInTheDocument();
    expect(screen.getByTestId("tab-ai-insights")).toBeInTheDocument();
  });

  it("lojalność zamrożona: strona nie pyta API o punkty klienta", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("client-tabs")).toBeInTheDocument();
    });

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0])
    );
    expect(calls.filter((u) => u.includes("loyalty"))).toEqual([]);
  });

  it("kontrola: przy module lojalności włączonym zakładka wraca", async () => {
    renderPage({ ...DEFAULT_MODULES, loyalty: true });

    await waitFor(() => {
      expect(screen.getByTestId("tab-loyalty")).toBeInTheDocument();
    });
  });
});
