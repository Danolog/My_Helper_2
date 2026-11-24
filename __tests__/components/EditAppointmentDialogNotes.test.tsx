/**
 * Dialog edycji wysyła `notes` tylko, gdy się zmieniły (#90, recenzja): wizyta
 * z notatkami ponad limit sprzed #71 musi dać się przesunąć bez 400.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditAppointmentDialog } from "@/components/appointments/edit-appointment-dialog";
import { APPOINTMENT_NOTES_MAX_LENGTH } from "@/lib/appointment-limits";

const mutationFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ mutationFetch: (...a: unknown[]) => mutationFetch(...a) }));
// Bez salonId dialog nie pobiera list (klienci, usługi, pracownicy).
vi.mock("@/hooks/use-salon-id", () => ({ useSalonId: () => ({ salonId: null }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
future.setHours(10, 0, 0, 0);

function appointment(notes: string | null) {
  return {
    id: "appt-1",
    salonId: "salon-a",
    clientId: null,
    employeeId: "emp-1",
    serviceId: null,
    startTime: future.toISOString(),
    endTime: new Date(future.getTime() + 3600 * 1000).toISOString(),
    status: "scheduled",
    notes,
    depositAmount: null,
    depositPaid: false,
    client: null,
    employee: { id: "emp-1", firstName: "Anna", lastName: "Nowak", color: null },
    service: null,
  };
}

async function save(notes: string | null, edit?: (input: HTMLElement) => void) {
  render(
    <EditAppointmentDialog
      open
      onOpenChange={vi.fn()}
      appointment={appointment(notes)}
      onAppointmentUpdated={vi.fn()}
    />
  );
  const input = await screen.findByTestId("edit-appointment-notes-input");
  if (edit) edit(input);
  // Zmiana godziny — scenariusz z przeglądu: tylko czas, notatki nietknięte.
  fireEvent.change(screen.getByTestId("edit-appointment-time-input"), { target: { value: "11:30" } });
  fireEvent.click(screen.getByTestId("save-edit-btn"));
  await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
  const [url, init] = mutationFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/appointments/appt-1");
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("EditAppointmentDialog — notatki tylko po zmianie (#90)", () => {
  beforeEach(() => {
    mutationFetch.mockReset();
    mutationFetch.mockResolvedValue({ json: async () => ({ success: true }) });
  });

  it("zmiana samej godziny przy notatkach ponad limit => body bez notes", async () => {
    const body = await save("x".repeat(APPOINTMENT_NOTES_MAX_LENGTH + 500));
    expect(body).not.toHaveProperty("notes");
    expect(body).toHaveProperty("startTime");
  });

  it("zmienione notatki => przycięta wartość w body", async () => {
    const body = await save("Stara", (input) =>
      fireEvent.change(input, { target: { value: " Nowa uwaga " } })
    );
    expect(body.notes).toBe("Nowa uwaga");
  });

  it("wyczyszczone notatki => null w body", async () => {
    const body = await save("Stara", (input) => fireEvent.change(input, { target: { value: "  " } }));
    expect(body.notes).toBeNull();
  });
});
