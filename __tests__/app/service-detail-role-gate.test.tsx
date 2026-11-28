/**
 * Strona szczegółu usługi w panelu — dostęp tylko dla właściciela, tak jak
 * lista usług. Pracownik i recepcja dostają kartę odmowy, a strona nie pyta
 * API ani o usługę, ani o ceny pracowników.
 *
 * Rola przychodzi z layoutu (serwer) przez RoleProvider — RoleGate nie ma
 * stanu ładowania. Bez providera kontekst przyjmuje domyślnie „owner”.
 * Atrapy: `next/navigation`, `next/dynamic`, `sonner`, `@/lib/auth-client`,
 * `@/hooks/use-salon-id`, globalny `fetch`.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ServiceDetailPage from "@/app/dashboard/services/[id]/page";
import { RoleProvider } from "@/components/dashboard/role-provider";
import type { SalonRole } from "@/lib/salon-context";

// Stabilny obiekt routera — hooki danych mają go w zależnościach efektów.
const router = vi.hoisted(() => ({ push: () => {}, replace: () => {}, back: () => {} }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "svc-1" }),
  useRouter: () => router,
}));

// Dialog edycji ładowany leniwie — w tym teście nieistotny.
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const session = vi.hoisted(() => ({ isPending: false }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: session.isPending ? null : { user: { id: "user-1" } },
    isPending: session.isPending,
  }),
}));

vi.mock("@/hooks/use-salon-id", () => ({
  useSalonId: () => ({ salonId: "salon-1", loading: false }),
}));

const SERVICE = {
  id: "svc-1",
  salonId: "salon-1",
  categoryId: null,
  name: "Strzyżenie damskie",
  description: null,
  basePrice: "120.00",
  baseDuration: 60,
  isActive: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  category: null,
  variants: [],
};

const DENIAL_TEXT = "Brak uprawnien do tej sekcji";
const BASE_PRICE_TEXT = /cenę bazową/;
const PRICES_URL = "/api/services/svc-1/employee-prices";

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/services/svc-1")) {
      return { ok: true, json: async () => ({ success: true, data: SERVICE }) } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
  });
}

function fetchedUrls(): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

function renderAs(role: SalonRole) {
  return render(
    <RoleProvider role={role}>
      <ServiceDetailPage />
    </RoleProvider>
  );
}

describe("ServiceDetailPage — dostęp tylko dla właściciela", () => {
  beforeEach(() => {
    session.isPending = false;
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("właściciel widzi kartę cen pracowników z ceną bazową", async () => {
    renderAs("owner");

    expect(await screen.findByTestId("employee-pricing-section")).toBeInTheDocument();
    expect(screen.getByText(BASE_PRICE_TEXT)).toHaveTextContent("120.00 PLN");
    expect(screen.queryByText(DENIAL_TEXT)).not.toBeInTheDocument();
    expect(fetchedUrls()).toContain(PRICES_URL);
  });

  it.each(["employee", "receptionist"] as const)(
    "rola %s dostaje ekran odmowy bez zapytań o usługę i ceny",
    async (role) => {
      renderAs(role);

      expect(screen.getByText(DENIAL_TEXT)).toBeInTheDocument();
      // Efekty pobierania odpaliłyby się po montażu — czekamy na ich kolej.
      await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
      expect(fetchedUrls()).not.toContain(PRICES_URL);
      expect(screen.queryByTestId("employee-pricing-section")).not.toBeInTheDocument();
      expect(screen.queryByText(BASE_PRICE_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText("Strzyżenie damskie")).not.toBeInTheDocument();
    }
  );

  it("rola pracownika przy trwającym ładowaniu sesji: odmowa zamiast spinnera, bez zapytań", async () => {
    session.isPending = true;
    renderAs("employee");

    expect(screen.getByText(DENIAL_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });

  it("bez RoleProvider bramka przyjmuje domyślną rolę właściciela", async () => {
    render(<ServiceDetailPage />);

    expect(await screen.findByTestId("employee-pricing-section")).toBeInTheDocument();
    expect(screen.queryByText(DENIAL_TEXT)).not.toBeInTheDocument();
  });

  it("zmiana roli z właściciela na pracownika chowa treść strony", async () => {
    const { rerender } = renderAs("owner");
    expect(await screen.findByTestId("employee-pricing-section")).toBeInTheDocument();

    rerender(
      <RoleProvider role="employee">
        <ServiceDetailPage />
      </RoleProvider>
    );

    expect(screen.getByText(DENIAL_TEXT)).toBeInTheDocument();
    expect(screen.queryByTestId("employee-pricing-section")).not.toBeInTheDocument();
  });
});
