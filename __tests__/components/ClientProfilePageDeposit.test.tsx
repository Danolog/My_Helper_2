import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ClientProfilePage from "@/app/dashboard/clients/[id]/page";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES, DEPOSITS_DISABLED_MESSAGE } from "@/lib/features";

// Edycja klienta a wyłączony zadatek (isDepositEnabled): formularz nie wysyła
// pól zadatku, więc klient zapisany wcześniej z flagą `true` nie dostaje 409
// DEPOSITS_DISABLED przy każdej edycji. Po włączeniu zadatku pola wracają.

const flags = vi.hoisted(() => ({ deposit: false }));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isDepositEnabled: () => flags.deposit,
}));

const router = vi.hoisted(() => ({ push: () => {}, replace: () => {}, back: () => {} }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "client-1" }),
  useRouter: () => router,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false }),
}));

vi.mock("@/hooks/use-salon-id", () => ({
  useSalonId: () => ({ salonId: "salon-1", loading: false }),
}));

const mutationFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ mutationFetch }));

// Nagłówek zastąpiony przyciskiem zapisu; zakładki bez własnego pobierania.
vi.mock("@/components/clients/client-profile-header", () => ({
  ClientProfileHeader: ({ onSave }: { onSave: () => void }) => (
    <button type="button" data-testid="stub-save" onClick={onSave}>
      Zapisz
    </button>
  ),
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

/** Klient zapisany przed wyłączeniem zadatku — z flagą „Wymagaj zadatku”. */
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
  healthDataConsentAt: null,
  healthDataConsentBy: null,
  favoriteEmployeeId: null,
  birthday: null,
  requireDeposit: true,
  depositType: "fixed",
  depositValue: "50.00",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function response(status: number, json: unknown) {
  return { status, ok: status < 400, json: async () => json } as Response;
}

async function renderAndSave() {
  render(
    <ModulesProvider modules={DEFAULT_MODULES}>
      <ClientProfilePage />
    </ModulesProvider>
  );
  await waitFor(() => expect(screen.getByTestId("stub-save")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("stub-save"));
  await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
}

function sentBody(): Record<string, unknown> {
  const [url, init] = mutationFetch.mock.calls[0]!;
  expect(url).toBe("/api/clients/client-1");
  expect((init as RequestInit).method).toBe("PUT");
  return JSON.parse(String((init as RequestInit).body));
}

describe("ClientProfilePage — pola zadatku przy zapisie", () => {
  beforeEach(() => {
    flags.deposit = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/api/clients/client-1")
          ? response(200, { success: true, data: CLIENT })
          : response(200, { success: true, data: [] })
      )
    );
    mutationFetch.mockResolvedValue(response(200, { success: true, data: CLIENT }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mutationFetch.mockReset();
  });

  it("zadatek wyłączony: klient z zapisaną flagą true — PUT bez pól zadatku", async () => {
    await renderAndSave();

    const body = sentBody();
    expect(body).toMatchObject({ firstName: "Anna", lastName: "Nowak" });
    expect(body).not.toHaveProperty("requireDeposit");
    expect(body).not.toHaveProperty("depositType");
    expect(body).not.toHaveProperty("depositValue");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Dane klienta zostaly zapisane"));
  });

  it("zadatek włączony: PUT wysyła zapisane pola zadatku", async () => {
    flags.deposit = true;
    await renderAndSave();

    expect(sentBody()).toMatchObject({
      requireDeposit: true,
      depositType: "fixed",
      depositValue: "50.00",
    });
  });

  it("409 DEPOSITS_DISABLED: komunikat mówi wprost, że trzeba odznaczyć zadatek", async () => {
    flags.deposit = true;
    mutationFetch.mockResolvedValue(
      response(409, { success: false, code: "DEPOSITS_DISABLED", error: DEPOSITS_DISABLED_MESSAGE })
    );
    await renderAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const message = String(toast.error.mock.calls[0]![0]);
    expect(message).toMatch(/zadatki są obecnie wyłączone/i);
    expect(message).toMatch(/odznacz zadatek/i);
    expect(message).toContain("„Wymagaj zadatku” na „Nie”");
    expect(toast.error).not.toHaveBeenCalledWith(DEPOSITS_DISABLED_MESSAGE);
    expect(toast.error).not.toHaveBeenCalledWith("Nie udalo sie zapisac danych klienta");
  });

  it("409 DEPOSITS_DISABLED bez tekstu w odpowiedzi: ten sam komunikat o odznaczeniu", async () => {
    flags.deposit = true;
    mutationFetch.mockResolvedValue(response(409, { success: false, code: "DEPOSITS_DISABLED" }));
    await renderAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(String(toast.error.mock.calls[0]![0])).toMatch(/odznacz zadatek/i);
  });

  it("inne 409: komunikat z API, bez polecenia odznaczenia zadatku", async () => {
    flags.deposit = true;
    mutationFetch.mockResolvedValue(response(409, { success: false, code: "CONFLICT", error: "Konflikt danych" }));
    await renderAndSave();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Konflikt danych"));
    expect(String(toast.error.mock.calls[0]![0])).not.toMatch(/odznacz zadatek/i);
  });
});
