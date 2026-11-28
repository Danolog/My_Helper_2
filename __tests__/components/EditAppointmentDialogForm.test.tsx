/**
 * Okno edycji wizyty: przypisanie jako tekst u pracownika, brak obietnicy
 * powiadomienia klienta, czas trwania przy zmianie samego terminu, wizyta
 * zakończona (termin z zapisu), zamknięcie okna w trakcie ponownego odczytu
 * i po nim, wypełnianie formularza tylko przy otwarciu, polskie napisy.
 */
import { createContext, useContext, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditAppointmentDialog } from "@/components/appointments/edit-appointment-dialog";
import { RoleProvider } from "@/components/dashboard/role-provider";
import type { SalonRole } from "@/lib/salon-context";

const mutationFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ mutationFetch: (...a: unknown[]) => mutationFetch(...a) }));
const salon = vi.hoisted(() => ({ id: null as string | null }));
vi.mock("@/hooks/use-salon-id", () => ({ useSalonId: () => ({ salonId: salon.id }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// Select z przyciskami zamiast Radix (jsdom nie obsługuje jego wskaźnika).
// Pozycje są w tym samym węźle co przycisk wyzwalacza.
vi.mock("@/components/ui/select", () => {
  const Ctx = createContext<{ value?: string | undefined; onValueChange?: ((v: string) => void) | undefined }>({});
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: ReactNode }) => (
      <Ctx.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </Ctx.Provider>
    ),
    SelectTrigger: ({ children, ...rest }: { children: ReactNode; "data-testid"?: string; className?: string }) => {
      const ctx = useContext(Ctx);
      return (
        <button type="button" data-testid={rest["data-testid"]} data-value={ctx.value}>
          {children}
        </button>
      );
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const ctx = useContext(Ctx);
      return (
        <button type="button" data-option={value} onClick={() => ctx.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

const fetchMock = vi.fn();

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
future.setHours(10, 0, 0, 0);
const MIN = 60 * 1000;

type Appointment = Parameters<typeof EditAppointmentDialog>[0]["appointment"];

/** Wizyta 90 min, usługa 60 min (np. wariant +30 min przy rezerwacji). */
function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    salonId: "salon-a",
    clientId: "client-1",
    employeeId: "emp-1",
    serviceId: "svc-1",
    startTime: future.toISOString(),
    endTime: new Date(future.getTime() + 90 * MIN).toISOString(),
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

const SERVICE_60 = { id: "svc-1", name: "Strzyżenie", basePrice: "100.00", baseDuration: 60, isActive: true, category: null };
const SERVICE_120 = { id: "svc-2", name: "Koloryzacja", basePrice: "200.00", baseDuration: 120, isActive: true, category: null };
const VARIANT_15 = { id: "var-1", serviceId: "svc-1", name: "Długie włosy", priceModifier: "20.00", durationModifier: 15 };

const FRESH = appointment({
  clientId: "client-2",
  serviceId: "svc-2",
  client: { id: "client-2", firstName: "Jan", lastName: "Wiśniewski", phone: null, email: "jan@example.invalid", allergies: null },
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
const NOT_FOUND_404 = { success: false, code: "APPOINTMENT_NOT_FOUND", error: "Nie znaleziono wizyty. Odśwież kalendarz." };

let appointmentGet: () => Promise<Response>;
let servicesList: unknown[] = [];
let variantsList: unknown[] = [];
let employeesList: unknown[] = [];

type Props = Parameters<typeof EditAppointmentDialog>[0];

function renderDialog(role: SalonRole, props: Partial<Props> = {}) {
  const handlers = { onOpenChange: vi.fn(), onAppointmentUpdated: vi.fn(), onAppointmentGone: vi.fn() };
  const view = (p: Partial<Props>) => (
    <RoleProvider role={role}>
      <EditAppointmentDialog
        open
        appointment={appointment()}
        onOpenChange={handlers.onOpenChange}
        onAppointmentUpdated={handlers.onAppointmentUpdated}
        onAppointmentGone={handlers.onAppointmentGone}
        {...p}
      />
    </RoleProvider>
  );
  const result = render(view(props));
  return { ...handlers, rerender: (p: Partial<Props>) => result.rerender(view(p)), unmount: result.unmount };
}

function bodyOf(call: number): Record<string, unknown> {
  const [, init] = mutationFetch.mock.calls[call] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

/** Godzina 12:15 tego samego dnia co wizyta. */
const MOVED = new Date(future);
MOVED.setHours(12, 15, 0, 0);

async function moveTime() {
  fireEvent.change(await screen.findByTestId("edit-appointment-time-input"), { target: { value: "12:15" } });
}

async function save(times = 1) {
  fireEvent.click(screen.getByTestId("save-edit-btn"));
  await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(times));
}

function pick(triggerId: string, value: string) {
  const group = screen.getByTestId(triggerId).parentElement as HTMLElement;
  const option = within(group).getAllByRole("button").find((b) => b.getAttribute("data-option") === value);
  if (!option) throw new Error(`brak pozycji ${value}`);
  fireEvent.click(option);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function appointmentGetCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/appointments/appt-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  mutationFetch.mockReset();
  mutationFetch.mockImplementation(async () => jsonResponse(200, { success: true }));
  salon.id = null;
  servicesList = [];
  variantsList = [];
  employeesList = [];
  appointmentGet = async () => jsonResponse(200, { success: true, data: FRESH });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/appointments/appt-1") return appointmentGet();
    if (url.startsWith("/api/services?")) return jsonResponse(200, { success: true, data: servicesList });
    if (url.startsWith("/api/employees?")) return jsonResponse(200, { success: true, data: employeesList });
    if (url.endsWith("/variants")) return jsonResponse(200, { success: true, data: variantsList });
    return jsonResponse(200, { success: true, data: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("przypisanie jako tekst u pracownika", () => {
  it("klient, usługa nieaktywna i pracownik jako tekst z wizyty", async () => {
    salon.id = "salon-a";
    // Lista ma tylko aktywne usługi: usługi wizyty na niej nie ma.
    servicesList = [SERVICE_120];
    renderDialog("employee");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByTestId("edit-client-readonly")).toHaveTextContent(/^Ewa Kowalska$/);
    expect(screen.getByTestId("edit-service-readonly")).toHaveTextContent(/^Strzyżenie$/);
    expect(screen.getByTestId("edit-employee-readonly")).toHaveTextContent(/^Anna Nowak$/);
    expect(screen.queryByTestId("edit-client-select")).toBeNull();
    expect(screen.queryByTestId("edit-client-search-input")).toBeNull();
    expect(screen.queryByTestId("edit-service-select")).toBeNull();
    expect(screen.queryByTestId("edit-employee-select")).toBeNull();
  });

  it("wizyta bez klienta i bez usługi: „Bez klienta”, „Bez usługi”, zapis z null", async () => {
    renderDialog("employee", {
      appointment: appointment({ clientId: null, client: null, serviceId: null, service: null }),
    });
    expect(await screen.findByTestId("edit-client-readonly")).toHaveTextContent(/^Bez klienta$/);
    expect(screen.getByTestId("edit-service-readonly")).toHaveTextContent(/^Bez usługi$/);
    await moveTime();
    await save();
    expect(bodyOf(0).clientId).toBeNull();
    expect(bodyOf(0).serviceId).toBeNull();
  });

  it("po ponownym odczycie: napisy i zapis z odczytu", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(403, ASSIGNMENT_403))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(screen.getByTestId("edit-client-readonly")).toHaveTextContent(/^Jan Wiśniewski$/));
    expect(screen.getByTestId("edit-service-readonly")).toHaveTextContent(/^Koloryzacja$/);
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    await save(2);
    expect(bodyOf(1).clientId).toBe("client-2");
    expect(bodyOf(1).serviceId).toBe("svc-2");
  });

  it("ponowny odczyt 500: napisy zostają z otwarcia okna", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    appointmentGet = async () => jsonResponse(500, { success: false, error: "Failed to fetch appointment" });
    renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId("edit-client-readonly")).toHaveTextContent(/^Ewa Kowalska$/);
    expect(screen.getByTestId("edit-service-readonly")).toHaveTextContent(/^Strzyżenie$/);
  });

  it("nowy obiekt wizyty przy otwartym oknie: zapis wysyła przypisanie, które okno pokazuje", async () => {
    const view = renderDialog("employee");
    await moveTime();
    view.rerender({ appointment: FRESH });
    expect(screen.getByTestId("edit-client-readonly")).toHaveTextContent(/^Jan Wiśniewski$/);
    await save();
    expect(bodyOf(0).clientId).toBe("client-2");
    expect(bodyOf(0).serviceId).toBe("svc-2");
  });

  it("alergie klienta z wizyty widoczne u pracownika", async () => {
    renderDialog("employee", {
      appointment: appointment({
        client: { id: "client-1", firstName: "Ewa", lastName: "Kowalska", phone: null, email: null, allergies: "Lateks" },
      }),
    });
    expect(await screen.findByTestId("edit-client-allergy-warning")).toHaveTextContent("Lateks");
  });

  it.each<SalonRole>(["owner", "receptionist"])("%s: listy wyboru, bez napisów tylko do odczytu", async (role) => {
    renderDialog(role);
    await screen.findByTestId("edit-client-select");
    expect(screen.getByTestId("edit-service-select")).toBeInTheDocument();
    expect(screen.getByTestId("edit-employee-select")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-client-readonly")).toBeNull();
    expect(screen.queryByTestId("edit-service-readonly")).toBeNull();
    expect(screen.queryByTestId("edit-employee-readonly")).toBeNull();
  });
});

describe("bez obietnicy powiadomienia klienta", () => {
  it("wizyta z klientem: brak pola „Powiadom klienta”", async () => {
    renderDialog("owner");
    await screen.findByTestId("edit-appointment-time-input");
    expect(screen.queryByText(/Powiadom klienta/)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByTestId("notify-client-section")).toBeNull();
  });

  it("zapis: toast sukcesu bez opisu o powiadomieniu, body bez notifyClient", async () => {
    const h = renderDialog("owner");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success.mock.calls[0]).toEqual(["Wizyta została zaktualizowana"]);
    expect(JSON.stringify(toast.success.mock.calls)).not.toMatch(/powiadom/i);
    expect(bodyOf(0)).not.toHaveProperty("notifyClient");
    expect(h.onAppointmentUpdated).toHaveBeenCalledTimes(1);
  });

  it("błąd zapisu: bez toasta sukcesu", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(409, { success: false, error: "Termin zajęty" }));
    renderDialog("owner");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("zmiana samego terminu nie zmienia czasu trwania", () => {
  const END_90 = new Date(MOVED.getTime() + 90 * MIN).toISOString();

  it.each<SalonRole>(["employee", "owner", "receptionist"])(
    "%s: wizyta 90 min, usługa 60 min, nowa godzina => koniec po 90 min",
    async (role) => {
      salon.id = "salon-a";
      servicesList = [SERVICE_60];
      renderDialog(role);
      await waitFor(() => expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h 30 min"));
      await moveTime();
      await save();
      expect(bodyOf(0).startTime).toBe(MOVED.toISOString());
      expect(bodyOf(0).endTime).toBe(END_90);
    }
  );

  it("pracownik bez listy usług (błąd sieci): koniec po 90 min, nie domyślne 60", async () => {
    salon.id = "salon-a";
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderDialog("employee");
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(END_90);
  });

  it("pracownik z wariantami na liście: bez wyboru wariantu, koniec po 90 min", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("employee");
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/variants"))).toBe(true));
    expect(screen.queryByTestId("edit-variant-select")).toBeNull();
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(END_90);
  });

  it("wizyta bez usługi: koniec z zapisanego czasu, nie domyślne 60 min", async () => {
    const start = future;
    renderDialog("owner", {
      appointment: appointment({ serviceId: null, service: null, endTime: new Date(start.getTime() + 45 * MIN).toISOString() }),
    });
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 45 * MIN).toISOString());
  });

  it("właściciel zmienia usługę: koniec z nowej usługi", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60, SERVICE_120];
    renderDialog("owner");
    await screen.findByText(/Koloryzacja - 200.00 PLN/);
    pick("edit-service-select", "svc-2");
    await moveTime();
    await save();
    expect(bodyOf(0).serviceId).toBe("svc-2");
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 120 * MIN).toISOString());
  });

  it("właściciel zmienia usługę i wraca do zapisanej: koniec po 90 min", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60, SERVICE_120];
    renderDialog("owner");
    await screen.findByText(/Koloryzacja - 200.00 PLN/);
    pick("edit-service-select", "svc-2");
    pick("edit-service-select", "svc-1");
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(END_90);
  });

  it("recepcja wybiera wariant na nowo: koniec z usługi i wariantu", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("receptionist");
    await screen.findByTestId("edit-variant-select");
    pick("edit-variant-select", "var-1");
    await waitFor(() => expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h 15 min"));
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 75 * MIN).toISOString());
  });

  it("wariant wybrany, potem inna usługa i powrót do zapisanej: koniec po 90 min", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60, SERVICE_120];
    variantsList = [VARIANT_15];
    renderDialog("owner");
    await screen.findByTestId("edit-variant-select");
    pick("edit-variant-select", "var-1");
    pick("edit-service-select", "svc-2");
    pick("edit-service-select", "svc-1");
    await waitFor(() => expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h 30 min"));
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(END_90);
  });

  it("pracownik, usługa nieaktywna: cena z wizyty w podsumowaniu", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_120];
    renderDialog("employee");
    await waitFor(() => expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("100.00 PLN"));
  });

  it("właściciel wybiera „Wariant podstawowy”: koniec z czasu usługi", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("owner");
    await screen.findByTestId("edit-variant-select");
    pick("edit-variant-select", "none");
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 60 * MIN).toISOString());
  });
});

describe("wizyta zakończona: termin z zapisu", () => {
  // Start z sekundami: odtworzenie z „GG:MM:00” dałoby inną chwilę.
  const start = new Date(future);
  start.setHours(9, 0, 30, 0);
  const end = new Date(start.getTime() + 50 * MIN);
  const COMPLETED = appointment({ status: "completed", startTime: start.toISOString(), endTime: end.toISOString() });

  it("sama notatka: zapisane startTime i endTime bez przeliczania", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    renderDialog("owner", { appointment: COMPLETED });
    fireEvent.change(await screen.findByTestId("edit-appointment-notes-input"), { target: { value: "Nowa" } });
    await save();
    expect(bodyOf(0).startTime).toBe(start.toISOString());
    expect(bodyOf(0).endTime).toBe(end.toISOString());
    expect(bodyOf(0).notes).toBe("Nowa");
  });

  it("termin tylko do odczytu; wizyta niezakończona: termin edytowalny", async () => {
    const view = renderDialog("owner", { appointment: COMPLETED });
    expect(await screen.findByTestId("edit-appointment-date-input")).toBeDisabled();
    expect(screen.getByTestId("edit-appointment-time-input")).toBeDisabled();
    view.unmount();
    renderDialog("owner");
    expect(await screen.findByTestId("edit-appointment-date-input")).not.toBeDisabled();
    expect(screen.getByTestId("edit-appointment-time-input")).not.toBeDisabled();
  });

  it("wizyta z przeszłości: notatka zapisuje się bez błędu daty", async () => {
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    past.setHours(23, 30, 0, 0);
    const pastEnd = new Date(past.getTime() + 60 * MIN);
    renderDialog("owner", {
      appointment: appointment({ status: "completed", startTime: past.toISOString(), endTime: pastEnd.toISOString() }),
    });
    fireEvent.change(await screen.findByTestId("edit-appointment-notes-input"), { target: { value: "Nowa" } });
    await save();
    expect(screen.queryByTestId("error-edit-date")).toBeNull();
    expect(bodyOf(0).startTime).toBe(past.toISOString());
  });

  it("wizyta niezakończona z przeszłości: błąd daty, bez zapisu", async () => {
    renderDialog("owner");
    fireEvent.change(await screen.findByTestId("edit-appointment-date-input"), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByTestId("save-edit-btn"));
    expect(await screen.findByTestId("error-edit-date")).toHaveTextContent(
      /^Data nie może być z przeszłości\. Wybierz dzisiejszą lub przyszłą datę\.$/
    );
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it("403 → ponowny odczyt zwraca wizytę zakończoną: drugi zapis z terminem z odczytu", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(403, ASSIGNMENT_403))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    appointmentGet = async () =>
      jsonResponse(200, {
        success: true,
        data: { ...FRESH, status: "completed", startTime: start.toISOString(), endTime: end.toISOString() },
      });
    renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(screen.getByTestId("edit-appointment-time-input")).toBeDisabled();
    // Okno pokazuje zapisany termin, który wyśle.
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("09:00");
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    await save(2);
    expect(bodyOf(0).startTime).toBe(MOVED.toISOString());
    expect(bodyOf(1).startTime).toBe(start.toISOString());
    expect(bodyOf(1).endTime).toBe(end.toISOString());
  });
});

describe("zamknięcie okna w trakcie ponownego odczytu", () => {
  it.each([
    ["z danymi", () => jsonResponse(200, { success: true, data: FRESH })],
    ["z 404", () => jsonResponse(404, NOT_FOUND_404)],
  ])("„Anuluj” przed odpowiedzią %s: bez toasta i bez przejścia dalej", async (_name, response) => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    const pending = deferred<Response>();
    appointmentGet = () => pending.promise;
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(appointmentGetCalls()).toHaveLength(1));
    fireEvent.click(screen.getByTestId("cancel-edit-btn"));
    const [, init] = appointmentGetCalls()[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(response());
    });
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(h.onAppointmentGone).not.toHaveBeenCalled();
    expect(h.onAppointmentUpdated).not.toHaveBeenCalled();
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("strona zamyka okno w trakcie odczytu: odczyt przerwany", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    const pending = deferred<Response>();
    appointmentGet = () => pending.promise;
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(appointmentGetCalls()).toHaveLength(1));
    h.rerender({ open: false });
    await act(async () => {
      pending.resolve(jsonResponse(404, NOT_FOUND_404));
    });
    expect(h.onAppointmentGone).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("odmontowanie w trakcie odczytu: bez toasta", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    const pending = deferred<Response>();
    appointmentGet = () => pending.promise;
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(appointmentGetCalls()).toHaveLength(1));
    h.unmount();
    await act(async () => {
      pending.resolve(jsonResponse(200, { success: true, data: FRESH }));
    });
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe("zamknięcie bez zapisu po ponownym odczycie", () => {
  it("odmowa → odczyt → „Anuluj”: jedno odświeżenie strony", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("cancel-edit-btn"));
    expect(h.onAppointmentUpdated).toHaveBeenCalledTimes(1);
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("„Anuluj” bez ponownego odczytu: bez odświeżenia", async () => {
    const h = renderDialog("employee");
    await screen.findByTestId("cancel-edit-btn");
    fireEvent.click(screen.getByTestId("cancel-edit-btn"));
    expect(h.onAppointmentUpdated).not.toHaveBeenCalled();
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("odczyt 500 → „Anuluj”: bez odświeżenia", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    appointmentGet = async () => jsonResponse(500, { success: false });
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("cancel-edit-btn"));
    expect(h.onAppointmentUpdated).not.toHaveBeenCalled();
  });

  it("odczyt → udany drugi zapis: dokładnie jedno odświeżenie", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(403, ASSIGNMENT_403))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    await save(2);
    await waitFor(() => expect(h.onAppointmentUpdated).toHaveBeenCalledTimes(1));
    expect(h.onAppointmentUpdated).toHaveBeenCalledTimes(1);
  });
});

describe("wypełnianie formularza tylko przy otwarciu", () => {
  it("nowy obiekt tej samej wizyty przy otwartym oknie: termin i notatka bez zmian", async () => {
    const h = renderDialog("owner");
    await moveTime();
    fireEvent.change(screen.getByTestId("edit-appointment-notes-input"), { target: { value: "Wpisana" } });
    const other = new Date(future.getTime() + 24 * 3600 * 1000);
    h.rerender({ appointment: appointment({ startTime: other.toISOString(), notes: "Z innej karty" }) });
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("12:15");
    expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Wpisana");
    const d = future;
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(screen.getByTestId("edit-appointment-date-input")).toHaveValue(ymd);
  });

  it("ponowne otwarcie: formularz z aktualnej wizyty", async () => {
    const h = renderDialog("owner");
    await moveTime();
    h.rerender({ open: false });
    h.rerender({ open: true, appointment: appointment({ notes: "Świeża" }) });
    expect(await screen.findByTestId("edit-appointment-notes-input")).toHaveValue("Świeża");
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("10:00");
  });

  it("inna wizyta przy otwartym oknie: formularz od nowa", async () => {
    const h = renderDialog("owner");
    await moveTime();
    h.rerender({ appointment: appointment({ id: "appt-2", notes: "Druga" }) });
    await waitFor(() => expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Druga"));
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("10:00");
  });
});

describe("napisy okna z polskimi znakami", () => {
  it("tytuł, etykiety i podpowiedzi", async () => {
    renderDialog("owner");
    expect(await screen.findByText("Edytuj wizytę")).toBeInTheDocument();
    expect(screen.getByText("Usługa")).toBeInTheDocument();
    expect(screen.getByText("Notatki wewnętrzne")).toBeInTheDocument();
    expect(screen.getByTestId("edit-client-search-input")).toHaveAttribute(
      "placeholder",
      "Szukaj klienta (imię, nazwisko, telefon, e-mail)..."
    );
    expect(screen.getByTestId("edit-appointment-notes-input")).toHaveAttribute(
      "placeholder",
      "Notatki wewnętrzne dla personelu (np. preferencje klienta, uwagi, szczegóły zabiegu)..."
    );
    expect(screen.getByText("Bez usługi")).toBeInTheDocument();
    expect(screen.getByText("Brak klientów")).toBeInTheDocument();
  });

  it("wariant usługi", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("owner");
    expect(await screen.findByText("Wariant usługi")).toBeInTheDocument();
  });

  it("brak sieci przy zapisie: tytuł i rada, co zrobić", async () => {
    mutationFetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const h = renderDialog("owner");
    await moveTime();
    await save();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Błąd podczas aktualizacji wizyty", {
        description: "Sprawdź połączenie z internetem i odśwież stronę, żeby zobaczyć, czy zmiany się zapisały.",
      })
    );
    expect(h.onOpenChange).not.toHaveBeenCalled();
  });

  it("odpowiedź zapisu bez JSON-a: ten sam toast z radą", async () => {
    mutationFetch.mockImplementation(async () => new Response("<html>błąd</html>", { status: 502 }));
    renderDialog("owner");
    await moveTime();
    await save();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Błąd podczas aktualizacji wizyty", {
        description: "Sprawdź połączenie z internetem i odśwież stronę, żeby zobaczyć, czy zmiany się zapisały.",
      })
    );
  });

  it("gwiazdka „wymagane” tylko przy polach do wypełnienia", async () => {
    const view = renderDialog("owner");
    expect(await screen.findByText("Pracownik *")).toBeInTheDocument();
    expect(screen.getByText("Data i godzina *")).toBeInTheDocument();
    view.unmount();
    renderDialog("employee", { appointment: appointment({ status: "completed" }) });
    expect(await screen.findByText("Pracownik")).toBeInTheDocument();
    expect(screen.getByText("Data i godzina")).toBeInTheDocument();
    expect(screen.queryByText("Pracownik *")).toBeNull();
    expect(screen.queryByText("Data i godzina *")).toBeNull();
  });

  it("pracownik, wizyta niezakończona: termin z gwiazdką, pracownik bez", async () => {
    renderDialog("employee");
    expect(await screen.findByText("Pracownik")).toBeInTheDocument();
    expect(screen.getByText("Data i godzina *")).toBeInTheDocument();
  });
});

describe("wyjaśnienie przy terminie wizyty zakończonej", () => {
  it("wizyta zakończona: napis przy wyłączonych polach, powiązany z polami", async () => {
    renderDialog("owner", { appointment: appointment({ status: "completed" }) });
    const hint = await screen.findByTestId("edit-term-locked-hint");
    expect(hint).toHaveTextContent(/^Wizyta jest zakończona, więc jej termin się nie zmienia\. Możesz zapisać notatkę\.$/);
    expect(screen.getByTestId("edit-appointment-date-input")).toHaveAttribute("aria-describedby", hint.id);
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveAttribute("aria-describedby", hint.id);
  });

  it("wizyta niezakończona: bez napisu i bez opisu pól", async () => {
    renderDialog("owner");
    await screen.findByTestId("edit-appointment-time-input");
    expect(screen.queryByTestId("edit-term-locked-hint")).toBeNull();
    expect(screen.getByTestId("edit-appointment-time-input")).not.toHaveAttribute("aria-describedby");
  });

  it("ponowny odczyt zwraca wizytę zakończoną: napis się pojawia", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    appointmentGet = async () => jsonResponse(200, { success: true, data: { ...FRESH, status: "completed" } });
    renderDialog("employee");
    await moveTime();
    await save();
    expect(await screen.findByTestId("edit-term-locked-hint")).toBeInTheDocument();
  });
});

describe("ponowne otwarcie okna: wybór wariantu od nowa", () => {
  it("wariant wybrany, „Anuluj”, ponowne otwarcie: brak wyboru, cena bazowa", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    const h = renderDialog("owner");
    await screen.findByTestId("edit-variant-select");
    pick("edit-variant-select", "var-1");
    await waitFor(() => expect(screen.getByTestId("edit-price-row")).toHaveTextContent("120.00 PLN"));
    h.rerender({ open: false });
    h.rerender({ open: true });
    await waitFor(() => expect(screen.getByTestId("edit-variant-select")).toHaveAttribute("data-value", ""));
    expect(screen.getByTestId("edit-price-row")).toHaveTextContent("100.00 PLN");
    expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h 30 min");
  });

  it("po ponownym otwarciu zapis z zapisanym czasem trwania, nie z wariantu", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    const h = renderDialog("receptionist");
    await screen.findByTestId("edit-variant-select");
    pick("edit-variant-select", "var-1");
    h.rerender({ open: false });
    h.rerender({ open: true });
    await moveTime();
    await save();
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 90 * MIN).toISOString());
  });
});

describe("podsumowanie: cena z zapisanym wariantem przy czasie z zapisu", () => {
  it("wizyta z wariantem: cena z dopłatą wariantu i zapisany czas", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("owner", { appointment: appointment({ variantId: "var-1" }) });
    await waitFor(() => expect(screen.getByTestId("edit-price-row")).toHaveTextContent("120.00 PLN"));
    expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h 30 min");
  });

  it("pracownik, wizyta z wariantem: cena z dopłatą wariantu", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("employee", { appointment: appointment({ variantId: "var-1" }) });
    await waitFor(() => expect(screen.getByTestId("edit-price-row")).toHaveTextContent("120.00 PLN"));
  });

  it("lista wariantów się nie wczytała: bez ceny, czas trwania zostaje", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/variants")) throw new TypeError("Failed to fetch");
      if (url.startsWith("/api/services?")) return jsonResponse(200, { success: true, data: servicesList });
      return jsonResponse(200, { success: true, data: [] });
    });
    renderDialog("owner", { appointment: appointment({ variantId: "var-1" }) });
    await waitFor(() => expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h 30 min"));
    expect(screen.queryByTestId("edit-price-row")).toBeNull();
    expect(screen.queryByText("Cena:")).toBeNull();
  });

  it("wizyta bez wariantu: cena bazowa", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("owner", { appointment: appointment({ variantId: null }) });
    await waitFor(() => expect(screen.getByTestId("edit-price-row")).toHaveTextContent("100.00 PLN"));
  });

  it("„Wariant podstawowy” wybrany w oknie: cena bez dopłaty zapisanego wariantu", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    renderDialog("owner", { appointment: appointment({ variantId: "var-1" }) });
    await waitFor(() => expect(screen.getByTestId("edit-price-row")).toHaveTextContent("120.00 PLN"));
    pick("edit-variant-select", "none");
    await waitFor(() => expect(screen.getByTestId("edit-price-row")).toHaveTextContent("100.00 PLN"));
    expect(screen.getByTestId("edit-price-duration-summary")).toHaveTextContent("1h");
    expect(screen.getByTestId("edit-price-duration-summary")).not.toHaveTextContent("30 min");
  });
});

describe("nowy obiekt tej samej wizyty przy otwartym oknie: zmiany innej osoby zostają", () => {
  const ROLES: SalonRole[] = ["employee", "owner", "receptionist"];

  /** Wizyta po zmianie przez inną osobę: inny klient, usługa, pracownik, czas 45 min i notatka. */
  const CHANGED = appointment({
    clientId: "client-2",
    serviceId: "svc-2",
    employeeId: "emp-2",
    endTime: new Date(future.getTime() + 45 * MIN).toISOString(),
    notes: "Notatka recepcji",
    client: { id: "client-2", firstName: "Jan", lastName: "Wiśniewski", phone: null, email: "jan@example.invalid", allergies: null },
    service: { id: "svc-2", name: "Koloryzacja", basePrice: "200.00", baseDuration: 120 },
    employee: { id: "emp-2", firstName: "Ola", lastName: "Zielińska", color: null },
  });

  it.each(ROLES)("%s: inna osoba dopisała notatkę, okno przesuwa godzinę: notatka zostaje", async (role) => {
    const h = renderDialog(role);
    await moveTime();
    h.rerender({ appointment: appointment({ notes: "Notatka recepcji" }) });
    await waitFor(() => expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Notatka recepcji"));
    await save();
    expect(bodyOf(0)).not.toHaveProperty("notes");
    expect(bodyOf(0).startTime).toBe(MOVED.toISOString());
  });

  it.each(ROLES)("%s: notatka wpisana w oknie zostaje mimo notatki innej osoby", async (role) => {
    const h = renderDialog(role);
    fireEvent.change(await screen.findByTestId("edit-appointment-notes-input"), { target: { value: "Moja" } });
    h.rerender({ appointment: appointment({ notes: "Notatka recepcji" }) });
    expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Moja");
    await save();
    expect(bodyOf(0).notes).toBe("Moja");
  });

  it.each(ROLES)(
    "%s: klient, usługa i pracownik zmienione gdzie indziej: zapis z nowych, koniec z czasu nowej wizyty",
    async (role) => {
      const h = renderDialog(role);
      await moveTime();
      h.rerender({ appointment: CHANGED });
      await save();
      const body = bodyOf(0);
      expect(body.clientId).toBe("client-2");
      expect(body.serviceId).toBe("svc-2");
      expect(body.employeeId).toBe("emp-2");
      expect(body).not.toHaveProperty("notes");
      expect(body.startTime).toBe(MOVED.toISOString());
      expect(body.endTime).toBe(new Date(MOVED.getTime() + 45 * MIN).toISOString());
    }
  );

  it.each<SalonRole>(["owner", "receptionist"])("%s: listy przechodzą na nowe wartości", async (role) => {
    const h = renderDialog(role);
    await screen.findByTestId("edit-service-select");
    h.rerender({ appointment: CHANGED });
    await waitFor(() => expect(screen.getByTestId("edit-service-select")).toHaveAttribute("data-value", "svc-2"));
    expect(screen.getByTestId("edit-client-select")).toHaveAttribute("data-value", "client-2");
    expect(screen.getByTestId("edit-employee-select")).toHaveAttribute("data-value", "emp-2");
  });

  it.each(ROLES)("%s: wizyta zakończona przy otwartym oknie: pola pokazują zapisany termin, zapis go wysyła", async (role) => {
    const start = new Date(future);
    start.setHours(9, 0, 30, 0);
    const end = new Date(start.getTime() + 50 * MIN);
    const h = renderDialog(role);
    await moveTime();
    h.rerender({ appointment: appointment({ status: "completed", startTime: start.toISOString(), endTime: end.toISOString() }) });
    await waitFor(() => expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("09:00"));
    expect(screen.getByTestId("edit-appointment-time-input")).toBeDisabled();
    expect(screen.getByTestId("edit-term-locked-hint")).toBeInTheDocument();
    await save();
    expect(bodyOf(0).startTime).toBe(start.toISOString());
    expect(bodyOf(0).endTime).toBe(end.toISOString());
  });

  it("termin niezmieniony w oknie idzie za nową wizytą", async () => {
    const moved = new Date(future);
    moved.setHours(14, 0, 0, 0);
    const h = renderDialog("receptionist");
    fireEvent.change(await screen.findByTestId("edit-appointment-notes-input"), { target: { value: "Moja" } });
    h.rerender({
      appointment: appointment({ startTime: moved.toISOString(), endTime: new Date(moved.getTime() + 90 * MIN).toISOString() }),
    });
    await waitFor(() => expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("14:00"));
    await save();
    expect(bodyOf(0).startTime).toBe(moved.toISOString());
    expect(bodyOf(0).notes).toBe("Moja");
  });

  it("termin zmieniony w oknie zostaje, koniec z zapisanego czasu nowej wizyty", async () => {
    const other = new Date(future.getTime() + 24 * 3600 * 1000);
    const h = renderDialog("employee");
    await moveTime();
    h.rerender({
      appointment: appointment({ startTime: other.toISOString(), endTime: new Date(other.getTime() + 30 * MIN).toISOString() }),
    });
    await save();
    expect(bodyOf(0).startTime).toBe(MOVED.toISOString());
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 30 * MIN).toISOString());
  });

  it("właściciel zmienił klienta i usługę w oknie: jego wybór zostaje, reszta idzie za nową wizytą", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60, SERVICE_120];
    const h = renderDialog("owner");
    await screen.findByText(/Koloryzacja - 200.00 PLN/);
    pick("edit-client-select", "none");
    pick("edit-service-select", "svc-2");
    await moveTime();
    h.rerender({ appointment: { ...CHANGED, clientId: "client-3", serviceId: "svc-3" } });
    await waitFor(() => expect(screen.getByTestId("edit-employee-select")).toHaveAttribute("data-value", "emp-2"));
    expect(screen.getByTestId("edit-service-select")).toHaveAttribute("data-value", "svc-2");
    expect(screen.getByTestId("edit-client-select")).toHaveAttribute("data-value", "none");
    await save();
    const body = bodyOf(0);
    expect(body.clientId).toBeNull();
    expect(body.serviceId).toBe("svc-2");
    expect(body.employeeId).toBe("emp-2");
    expect(body.endTime).toBe(new Date(MOVED.getTime() + 120 * MIN).toISOString());
  });

  it("właściciel zmienił pracownika w oknie: jego wybór zostaje", async () => {
    salon.id = "salon-a";
    employeesList = [
      { id: "emp-1", firstName: "Anna", lastName: "Nowak", color: null, isActive: true },
      { id: "emp-3", firstName: "Iga", lastName: "Mazur", color: null, isActive: true },
    ];
    const h = renderDialog("owner");
    await screen.findByText(/Iga Mazur/);
    pick("edit-employee-select", "emp-3");
    h.rerender({ appointment: CHANGED });
    await waitFor(() => expect(screen.getByTestId("edit-service-select")).toHaveAttribute("data-value", "svc-2"));
    await save();
    expect(bodyOf(0).employeeId).toBe("emp-3");
  });

  it("recepcja wybrała wariant w oknie: usługa zostaje mimo zmiany gdzie indziej", async () => {
    salon.id = "salon-a";
    servicesList = [SERVICE_60];
    variantsList = [VARIANT_15];
    const h = renderDialog("receptionist");
    await screen.findByTestId("edit-variant-select");
    pick("edit-variant-select", "var-1");
    await moveTime();
    h.rerender({ appointment: CHANGED });
    await waitFor(() => expect(screen.getByTestId("edit-employee-select")).toHaveAttribute("data-value", "emp-2"));
    await save();
    expect(bodyOf(0).serviceId).toBe("svc-1");
    expect(bodyOf(0).endTime).toBe(new Date(MOVED.getTime() + 75 * MIN).toISOString());
  });

  it("nowy obiekt z tymi samymi danymi: formularz bez zmian", async () => {
    const h = renderDialog("owner");
    await moveTime();
    fireEvent.change(screen.getByTestId("edit-appointment-notes-input"), { target: { value: "Wpisana" } });
    h.rerender({ appointment: appointment() });
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("12:15");
    expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Wpisana");
  });

  it("zapis po nowym obiekcie kończy się błędem: okno zostaje, ponowny zapis dalej bez starej notatki", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(409, { success: false, error: "Termin zajęty" }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    const h = renderDialog("employee");
    await moveTime();
    h.rerender({ appointment: appointment({ notes: "Notatka recepcji" }) });
    await save();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(h.onOpenChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    await save(2);
    expect(bodyOf(0)).not.toHaveProperty("notes");
    expect(bodyOf(1)).not.toHaveProperty("notes");
  });

  it("ponowny odczyt z notatką innej osoby: drugi zapis bez notatki", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(403, ASSIGNMENT_403))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    appointmentGet = async () => jsonResponse(200, { success: true, data: { ...FRESH, notes: "Notatka recepcji" } });
    renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Notatka recepcji"));
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    await save(2);
    expect(bodyOf(1)).not.toHaveProperty("notes");
    expect(bodyOf(1).startTime).toBe(MOVED.toISOString());
  });

  it("po ponownym odczycie strona podaje nowszy obiekt: okno przechodzi na niego", async () => {
    mutationFetch
      .mockResolvedValueOnce(jsonResponse(403, ASSIGNMENT_403))
      .mockResolvedValueOnce(jsonResponse(200, { success: true }));
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    h.rerender({ appointment: { ...FRESH, notes: "Notatka recepcji" } });
    await waitFor(() => expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Notatka recepcji"));
    expect(screen.getByTestId("edit-appointment-time-input")).toHaveValue("12:15");
    await waitFor(() => expect(screen.getByTestId("save-edit-btn")).not.toBeDisabled());
    await save(2);
    expect(bodyOf(1)).not.toHaveProperty("notes");
    expect(bodyOf(1).serviceId).toBe("svc-2");
  });

  it("po ponownym odczycie strona podaje nowszy obiekt, „Anuluj”: bez drugiego odświeżenia strony", async () => {
    mutationFetch.mockImplementation(async () => jsonResponse(403, ASSIGNMENT_403));
    const h = renderDialog("employee");
    await moveTime();
    await save();
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    h.rerender({ appointment: { ...FRESH, notes: "Notatka recepcji" } });
    await waitFor(() => expect(screen.getByTestId("edit-appointment-notes-input")).toHaveValue("Notatka recepcji"));
    fireEvent.click(screen.getByTestId("cancel-edit-btn"));
    expect(h.onAppointmentUpdated).not.toHaveBeenCalled();
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });
});
