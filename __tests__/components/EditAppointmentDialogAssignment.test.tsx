/**
 * Okno edycji wizyty: pola przypisania według roli, 403 przypisania
 * u pracownika (ponowny odczyt wizyty), 404 (zamknięcie i przejście dalej),
 * koniec wizyty zakończonej z zapisanego czasu trwania i tytuł toasta błędu.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditAppointmentDialog } from "@/components/appointments/edit-appointment-dialog";
import { RoleProvider } from "@/components/dashboard/role-provider";
import type { SalonRole } from "@/lib/salon-context";

const mutationFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ mutationFetch: (...a: unknown[]) => mutationFetch(...a) }));
// salonId null: okno nie pobiera list (klienci, usługi, pracownicy).
const salon = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/hooks/use-salon-id", () => ({ useSalonId: () => ({ salonId: salon.id }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const fetchMock = vi.fn();

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
future.setHours(10, 0, 0, 0);

type Appointment = Parameters<typeof EditAppointmentDialog>[0]["appointment"];

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    salonId: "salon-a",
    clientId: "client-1",
    employeeId: "emp-1",
    serviceId: "svc-1",
    startTime: future.toISOString(),
    endTime: new Date(future.getTime() + 3600 * 1000).toISOString(),
    status: "scheduled",
    notes: "Stara notatka",
    depositAmount: null,
    depositPaid: false,
    client: {
      id: "client-1",
      firstName: "Ewa",
      lastName: "Kowalska",
      phone: null,
      email: "ewa@example.invalid",
      allergies: null,
    },
    employee: { id: "emp-1", firstName: "Anna", lastName: "Nowak", color: null },
    service: { id: "svc-1", name: "Strzyżenie", basePrice: "100.00", baseDuration: 60 },
    ...overrides,
  };
}

/** Wizyta po zmianie przez właściciela: inny klient i usługa. */
const FRESH = appointment({
  clientId: "client-2",
  serviceId: "svc-2",
  client: {
    id: "client-2",
    firstName: "Jan",
    lastName: "Wiśniewski",
    phone: null,
    email: "jan@example.invalid",
    allergies: null,
  },
  service: { id: "svc-2", name: "Koloryzacja", basePrice: "200.00", baseDuration: 120 },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ASSIGNMENT_403 = {
  success: false,
  code: "APPOINTMENT_ASSIGNMENT_FORBIDDEN",
  error: "Pracownika, klienta i usługę wizyty zmienia właściciel albo recepcja.",
};
const NOT_FOUND_404 = {
  success: false,
  code: "APPOINTMENT_NOT_FOUND",
  error: "Nie znaleziono wizyty. Odśwież kalendarz.",
};

/** Odpowiedź ponownego odczytu wizyty (GET); listy zwracają puste dane. */
let appointmentGet: () => Promise<Response>;
/** Lista usług, gdy test ustawia salonId. */
let servicesList: unknown[] = [];

function renderDialog(
  role: SalonRole | null,
  props: Partial<Parameters<typeof EditAppointmentDialog>[0]> = {},
  { withGone = true }: { withGone?: boolean } = {}
) {
  const handlers = {
    onOpenChange: vi.fn(),
    onAppointmentUpdated: vi.fn(),
    onAppointmentGone: vi.fn(),
  };
  const dialog = (
    <EditAppointmentDialog
      open
      appointment={appointment()}
      onOpenChange={handlers.onOpenChange}
      onAppointmentUpdated={handlers.onAppointmentUpdated}
      {...(withGone ? { onAppointmentGone: handlers.onAppointmentGone } : {})}
      {...props}
    />
  );
  render(role ? <RoleProvider role={role}>{dialog}</RoleProvider> : dialog);
  return handlers;
}

function bodyOf(call: number): Record<string, unknown> {
  const [, init] = mutationFetch.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

async function moveTimeAndNotes() {
  fireEvent.change(await screen.findByTestId("edit-appointment-time-input"), { target: { value: "12:15" } });
  fireEvent.change(screen.getByTestId("edit-appointment-notes-input"), { target: { value: "Nowa notatka" } });
  fireEvent.click(screen.getByTestId("save-edit-btn"));
  await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
}

function appointmentGetCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/appointments/appt-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  mutationFetch.mockReset();
  salon.id = null;
  servicesList = [];
  appointmentGet = async () => jsonResponse(200, { success: true, data: FRESH });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/appointments/appt-1") return appointmentGet();
    if (url.startsWith("/api/services?")) return jsonResponse(200, { success: true, data: servicesList });
    return jsonResponse(200, { success: true, data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ASSIGNMENT_FIELDS = [
  "edit-client-search-input",
  "edit-client-select",
  "edit-service-select",
  "edit-employee-select",
];

const READONLY_FIELDS = ["edit-client-readonly", "edit-service-readonly", "edit-employee-readonly"];

describe("EditAppointmentDialog — pola przypisania według roli", () => {
  it("pracownik: pracownik, klient i usługa jako tekst; termin i notatka edytowalne", async () => {
    renderDialog("employee");
    await screen.findByTestId("edit-appointment-time-input");
    for (const id of ASSIGNMENT_FIELDS) expect(screen.queryByTestId(id)).toBeNull();
    for (const id of READONLY_FIELDS) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId("edit-appointment-date-input")).not.toBeDisabled();
    expect(screen.getByTestId("edit-appointment-time-input")).not.toBeDisabled();
    expect(screen.getByTestId("edit-appointment-notes-input")).not.toBeDisabled();
  });

  it.each<SalonRole>(["owner", "receptionist"])("%s: pola przypisania edytowalne", async (role) => {
    renderDialog(role);
    await screen.findByTestId("edit-appointment-time-input");
    for (const id of ASSIGNMENT_FIELDS) expect(screen.getByTestId(id)).not.toBeDisabled();
    for (const id of READONLY_FIELDS) expect(screen.queryByTestId(id)).toBeNull();
  });

  it("bez dostawcy roli (domyślnie właściciel): pola przypisania edytowalne", async () => {
    renderDialog(null);
    await screen.findByTestId("edit-appointment-time-input");
    for (const id of ASSIGNMENT_FIELDS) expect(screen.getByTestId(id)).not.toBeDisabled();
    for (const id of READONLY_FIELDS) expect(screen.queryByTestId(id)).toBeNull();
  });

  it("pracownik: zapis terminu wysyła zapisanego pracownika, klienta i usługę", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(200, { success: true }));
    const handlers = renderDialog("employee");
    await moveTimeAndNotes();
    const body = bodyOf(0);
    expect(body.employeeId).toBe("emp-1");
    expect(body.clientId).toBe("client-1");
    expect(body.serviceId).toBe("svc-1");
    expect(body.notes).toBe("Nowa notatka");
    await waitFor(() => expect(handlers.onAppointmentUpdated).toHaveBeenCalledTimes(1));
  });
});

describe("EditAppointmentDialog — 403 przypisania w oknie pracownika", () => {
  it("wczytuje wizytę ponownie, podstawia przypisanie, zostawia termin i notatkę, okno otwarte", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(403, ASSIGNMENT_403))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    const handlers = renderDialog("employee");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Wizyta zmieniła się w międzyczasie", {
        description: "Wczytaliśmy aktualne dane wizyty. Sprawdź je i zapisz ponownie.",
      })
    );
    expect(appointmentGetCalls()).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(handlers.onOpenChange).not.toHaveBeenCalled();
    expect(handlers.onAppointmentUpdated).not.toHaveBeenCalled();
    expect(handlers.onAppointmentGone).not.toHaveBeenCalled();
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("12:15");
    expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Nowa notatka");
    // Dane klienta z nowego odczytu.
    expect(screen.getByTestId("edit-client-readonly")).toHaveTextContent("Jan Wiśniewski");
    expect(screen.getByTestId("edit-service-readonly")).toHaveTextContent("Koloryzacja");

    // Ponowny zapis: przypisanie z nowego odczytu, termin i notatka z okna.
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(2));
    const first = bodyOf(0);
    const second = bodyOf(1);
    expect(second.employeeId).toBe("emp-1");
    expect(second.clientId).toBe("client-2");
    expect(second.serviceId).toBe("svc-2");
    expect(second.startTime).toBe(first.startTime);
    expect(second.notes).toBe("Nowa notatka");
    await waitFor(() => expect(handlers.onAppointmentUpdated).toHaveBeenCalledTimes(1));
  });

  it("właściciel z tym kodem: bez ponownego odczytu, ogólny toast z tekstem serwera", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    const handlers = renderDialog("owner");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
        description: "Pracownika, klienta i usługę wizyty zmienia właściciel albo recepcja.",
      })
    );
    expect(appointmentGetCalls()).toHaveLength(0);
    expect(toast.info).not.toHaveBeenCalled();
    expect(handlers.onOpenChange).not.toHaveBeenCalled();
  });

  it("pracownik, 403 bez kodu przypisania: bez ponownego odczytu", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, { success: false, error: "Brak uprawnień" }));
    renderDialog("employee");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", { description: "Brak uprawnień" })
    );
    expect(appointmentGetCalls()).toHaveLength(0);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("ponowny odczyt 404: okno się zamyka i strona przechodzi dalej", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    appointmentGet = async () => jsonResponse(404, NOT_FOUND_404);
    const handlers = renderDialog("employee");
    await moveTimeAndNotes();

    await waitFor(() => expect(handlers.onAppointmentGone).toHaveBeenCalledTimes(1));
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);
    expect(handlers.onAppointmentUpdated).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
      description: "Nie znaleziono wizyty. Odśwież kalendarz.",
    });
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("ponowny odczyt 500: własny tekst okna, bez tekstu serwera, okno otwarte", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    appointmentGet = async () => jsonResponse(500, { success: false, error: "Failed to fetch appointment" });
    const handlers = renderDialog("employee");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
        description: "Nie udało się wczytać aktualnych danych wizyty. Odśwież stronę i spróbuj ponownie.",
      })
    );
    expect(JSON.stringify(toast.error.mock.calls)).not.toContain("Failed to fetch appointment");
    expect(toast.info).not.toHaveBeenCalled();
    expect(handlers.onOpenChange).not.toHaveBeenCalled();
    expect(handlers.onAppointmentGone).not.toHaveBeenCalled();
    // Przypisanie zostaje z otwarcia okna.
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1).clientId).toBe("client-1");
  });

  it("ponowny odczyt bez sieci albo bez JSON-a: własny tekst okna", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    appointmentGet = async () => new Response("<html>błąd</html>", { status: 502 });
    renderDialog("employee");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
        description: "Nie udało się wczytać aktualnych danych wizyty. Odśwież stronę i spróbuj ponownie.",
      })
    );

    toast.error.mockClear();
    appointmentGet = async () => {
      throw new TypeError("Failed to fetch");
    };
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
        description: "Nie udało się wczytać aktualnych danych wizyty. Odśwież stronę i spróbuj ponownie.",
      })
    );
  });
});

describe("EditAppointmentDialog — 404 z zapisu", () => {
  it("okno się zamyka, strona przechodzi dalej, toast z tekstem serwera", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(404, NOT_FOUND_404));
    const handlers = renderDialog("employee");
    await moveTimeAndNotes();

    await waitFor(() => expect(handlers.onAppointmentGone).toHaveBeenCalledTimes(1));
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);
    expect(handlers.onAppointmentUpdated).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
      description: "Nie znaleziono wizyty. Odśwież kalendarz.",
    });
    expect(appointmentGetCalls()).toHaveLength(0);
  });

  it("bez onAppointmentGone: okno się zamyka i woła odświeżenie", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(404, NOT_FOUND_404));
    const handlers = renderDialog("owner", {}, { withGone: false });
    await moveTimeAndNotes();

    await waitFor(() => expect(handlers.onAppointmentUpdated).toHaveBeenCalledTimes(1));
    expect(handlers.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("404 z innym kodem (brak salonu): okno zostaje otwarte", async () => {
    mutationFetch.mockImplementation(async () =>
      jsonResponse(404, { success: false, code: "SALON_NOT_FOUND", error: "Nie znaleziono salonu powiązanego z tym kontem." })
    );
    const handlers = renderDialog("owner");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", {
        description: "Nie znaleziono salonu powiązanego z tym kontem.",
      })
    );
    expect(handlers.onOpenChange).not.toHaveBeenCalled();
    expect(handlers.onAppointmentGone).not.toHaveBeenCalled();
  });
});

describe("EditAppointmentDialog — koniec wizyty", () => {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  const SERVICE_90 = {
    id: "svc-1",
    name: "Strzyżenie",
    basePrice: "100.00",
    baseDuration: 90,
    isActive: true,
    category: null,
  };

  async function saveNotesOnly(appt: Appointment) {
    mutationFetch.mockImplementation(async () => jsonResponse(200, { success: true }));
    renderDialog("owner", { appointment: appt });
    fireEvent.change(await screen.findByTestId("edit-appointment-notes-input"), {
      target: { value: "Nowa notatka" },
    });
  }

  it("zakończona: sama notatka przy zmienionym czasie trwania usługi => koniec z zapisanej wizyty", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_90];
    const start = today;
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    await saveNotesOnly(
      appointment({ status: "completed", startTime: start.toISOString(), endTime: end.toISOString() })
    );
    // Lista usług z czasem 90 min jest wczytana (wybór w liście ma 90 min),
    // a podsumowanie pokazuje zapisane 60 min.
    await screen.findByText(/Strzyżenie - 100.00 PLN \(90 min\)/);
    expect(screen.queryByText("1h 30 min")).toBeNull();
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
    const body = bodyOf(0);
    expect(body.startTime).toBe(start.toISOString());
    expect(body.endTime).toBe(end.toISOString());
    expect(body.notes).toBe("Nowa notatka");
  });

  it("zakończona bez listy usług: koniec z zapisanej wizyty, nie domyślne 60 min", async () => {
    const start = today;
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    await saveNotesOnly(
      appointment({ status: "completed", startTime: start.toISOString(), endTime: end.toISOString() })
    );
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).endTime).toBe(end.toISOString());
  });

  it("niezakończona, usługa bez zmian: koniec z zapisanego czasu trwania, nie z usługi", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_90];
    await saveNotesOnly(appointment());
    // Podsumowanie pokazuje zapisane 60 min, nie 90 min usługi.
    await waitFor(() => expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h"));
    expect(screen.queryByText("1h 30 min")).toBeNull();
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
    const body = bodyOf(0);
    expect(body.startTime).toBe(future.toISOString());
    expect(body.endTime).toBe(new Date(future.getTime() + 60 * 60 * 1000).toISOString());
  });
});

describe("EditAppointmentDialog — tytuł toasta błędu zapisu", () => {
  it("polskie znaki w tytule, opis z odpowiedzi", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(409, { success: false, error: "Termin zajęty" }));
    renderDialog("owner");
    await moveTimeAndNotes();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zaktualizować wizyty", { description: "Termin zajęty" })
    );
    expect(toast.error).not.toHaveBeenCalledWith("Nie udalo sie zaktualizowac wizyty", expect.anything());
  });
});
