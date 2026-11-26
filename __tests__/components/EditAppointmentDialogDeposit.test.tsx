/**
 * Dialog edycji wizyty a wyłączony zadatek: body nie niesie pól zadatku,
 * a 409 DEPOSITS_DISABLED pokazuje komunikat z API zamiast ogólnego błędu.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditAppointmentDialog } from "@/components/appointments/edit-appointment-dialog";
import { DEPOSITS_DISABLED_MESSAGE } from "@/lib/features";

const mutationFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ mutationFetch: (...a: unknown[]) => mutationFetch(...a) }));
// Bez salonId dialog nie pobiera list (klienci, usługi, pracownicy).
vi.mock("@/hooks/use-salon-id", () => ({ useSalonId: () => ({ salonId: null }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
future.setHours(10, 0, 0, 0);

/** Wizyta zapisana przed wyłączeniem zadatku — z kwotą zadatku. */
const APPOINTMENT = {
  id: "appt-1",
  salonId: "salon-a",
  clientId: null,
  employeeId: "emp-1",
  serviceId: null,
  startTime: future.toISOString(),
  endTime: new Date(future.getTime() + 3600 * 1000).toISOString(),
  status: "scheduled",
  notes: null,
  depositAmount: "30.00",
  depositPaid: false,
  client: null,
  employee: { id: "emp-1", firstName: "Anna", lastName: "Nowak", color: null },
  service: null,
};

async function save() {
  render(
    <EditAppointmentDialog open onOpenChange={vi.fn()} appointment={APPOINTMENT} onAppointmentUpdated={vi.fn()} />
  );
  fireEvent.change(await screen.findByTestId("edit-appointment-time-input"), { target: { value: "11:30" } });
  fireEvent.click(screen.getByTestId("save-edit-btn"));
  await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
  const [, init] = mutationFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("EditAppointmentDialog — zadatek", () => {
  beforeEach(() => {
    mutationFetch.mockReset();
    vi.clearAllMocks();
  });

  it("wizyta z kwotą zadatku: body bez depositAmount", async () => {
    mutationFetch.mockResolvedValue({ json: async () => ({ success: true }) });
    const body = await save();
    expect(body).not.toHaveProperty("depositAmount");
    expect(body).not.toHaveProperty("depositPaid");
  });

  it("409 DEPOSITS_DISABLED: komunikat z API zamiast ogólnego błędu", async () => {
    mutationFetch.mockResolvedValue({
      status: 409,
      json: async () => ({ success: false, code: "DEPOSITS_DISABLED", error: DEPOSITS_DISABLED_MESSAGE }),
    });
    await save();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(DEPOSITS_DISABLED_MESSAGE));
    expect(toast.error).not.toHaveBeenCalledWith("Nie udalo sie zaktualizowac wizyty", expect.anything());
  });

  it("inny błąd: ogólny komunikat z opisem z API, jak dotąd", async () => {
    mutationFetch.mockResolvedValue({
      status: 409,
      json: async () => ({ success: false, error: "Termin zajety" }),
    });
    await save();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udalo sie zaktualizowac wizyty", { description: "Termin zajety" })
    );
  });
});
