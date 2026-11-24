/**
 * Okno usuwania klienta w panelu salonu:
 * - liczba wizyt, które stracą notatki i karty zabiegów (z listy wizyt klienta);
 * - 409: co zrobić z przyszłymi wizytami i zadatkami do zwrotu;
 * - 503: „spróbuj ponownie”;
 * - 200: przejście do listy klientów.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClientProfileHeader,
  countAppointmentsLosingNotes,
} from "@/components/clients/client-profile-header";
import type { AppointmentData, ClientData } from "@/components/clients/types";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  mutationFetch: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({
  mutationFetch: (...args: unknown[]) => mocks.mutationFetch(...args),
}));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

const client = {
  id: CLIENT_ID,
  firstName: "Anna",
  lastName: "Testowa",
} as ClientData;

function appointment(overrides: Partial<AppointmentData> = {}): AppointmentData {
  return {
    id: `a-${Math.random()}`,
    notes: null,
    treatment: null,
    materials: [],
    ...overrides,
  } as AppointmentData;
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function renderHeader() {
  render(
    <ClientProfileHeader
      client={client}
      clientId={CLIENT_ID}
      displayFirstName="Anna"
      displayLastName="Testowa"
      saving={false}
      onSave={() => {}}
    />
  );
}

async function openDialogAndSubmit() {
  fireEvent.click(screen.getByTestId("delete-client-btn"));
  fireEvent.change(await screen.findByTestId("delete-password-input"), { target: { value: "haslo" } });
  fireEvent.click(screen.getByTestId("confirm-delete-btn"));
}

describe("countAppointmentsLosingNotes", () => {
  it("liczy wizyty z notatką, kartą zabiegu albo uwagą do materiału; pomija puste", () => {
    expect(
      countAppointmentsLosingNotes([
        appointment({ notes: "Uwaga" }),
        appointment({ notes: "   " }),
        appointment({ treatment: { id: "t", recipe: null, techniques: null, materialsJson: [], notes: null, createdAt: "" } }),
        appointment({ materials: [{ notes: "zuzyte" } as AppointmentData["materials"][number]] }),
        appointment({ materials: [{ notes: null } as AppointmentData["materials"][number]] }),
        appointment(),
      ])
    ).toBe(3);
  });

  it("pusta lista → 0", () => {
    expect(countAppointmentsLosingNotes([])).toBe(0);
  });
});

describe("ClientProfileHeader — usuwanie klienta", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { success: true, data: [appointment({ notes: "x" }), appointment({ notes: "y" }), appointment()] })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("okno pokazuje, z ilu wizyt znikną notatki i karty zabiegów", async () => {
    renderHeader();
    fireEvent.click(screen.getByTestId("delete-client-btn"));

    expect(await screen.findByTestId("delete-impact-count")).toHaveTextContent("2");
    expect(screen.getByTestId("delete-impact")).toHaveTextContent("Notatki i karty zabiegów znikną z 2 wizyt");
    expect(fetchMock).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/appointments`, expect.anything());
    expect(screen.getByTestId("delete-impact-reviews")).toHaveTextContent(
      "Treść opinii tego klienta i odpowiedź salonu też znikną. Ocena zostanie."
    );
  });

  it("bez notatek: informacja, że nic nie zniknie", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: [appointment()] }));
    renderHeader();
    fireEvent.click(screen.getByTestId("delete-client-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-impact")).toHaveTextContent("Żadna wizyta tego klienta nie ma notatek")
    );
  });

  it("błąd listy wizyt: ostrzeżenie bez liczby", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { success: false }));
    renderHeader();
    fireEvent.click(screen.getByTestId("delete-client-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-impact")).toHaveTextContent("Nie udało się sprawdzić historii wizyt")
    );
  });

  it("409: pokazuje liczby i co zrobić; okno zostaje otwarte", async () => {
    mocks.mutationFetch.mockResolvedValue(
      jsonResponse(409, {
        success: false,
        code: "CLIENT_HAS_PENDING_OBLIGATIONS",
        error: "x",
        futureAppointments: 2,
        depositsToRefund: 1,
      })
    );
    renderHeader();
    await openDialogAndSubmit();

    expect(await screen.findByTestId("delete-blockers-future")).toHaveTextContent("Przyszłe wizyty: 2. Odwołaj je");
    expect(screen.getByTestId("delete-blockers-deposits")).toHaveTextContent(
      "zadatki przy odwołanych wizytach: 1. Zwróć zadatek klientowi i odznacz wpłatę"
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("409 tylko z zadatkiem: bez punktu o przyszłych wizytach", async () => {
    mocks.mutationFetch.mockResolvedValue(
      jsonResponse(409, { success: false, code: "CLIENT_HAS_PENDING_OBLIGATIONS", futureAppointments: 0, depositsToRefund: 1 })
    );
    renderHeader();
    await openDialogAndSubmit();

    expect(await screen.findByTestId("delete-blockers-deposits")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-blockers-future")).not.toBeInTheDocument();
  });

  it("503: komunikat „spróbuj ponownie”", async () => {
    mocks.mutationFetch.mockResolvedValue(
      jsonResponse(503, { success: false, code: "CLIENT_DELETE_RETRY", error: "Spróbuj ponownie za chwilę" })
    );
    renderHeader();
    await openDialogAndSubmit();

    expect(await screen.findByTestId("delete-error-message")).toHaveTextContent("Spróbuj ponownie za chwilę");
    expect(screen.queryByTestId("delete-blockers")).not.toBeInTheDocument();
  });

  it("200: komunikat i powrót do listy klientów", async () => {
    mocks.mutationFetch.mockResolvedValue(jsonResponse(200, { success: true, data: { id: CLIENT_ID } }));
    renderHeader();
    await openDialogAndSubmit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard/clients"));
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });
});
