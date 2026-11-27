/**
 * Zapis karty zabiegu nie zamyka wizyty. Po sukcesie zapisu historia wizyt
 * klienta pokazuje status taki, jak zwrócił serwer, a nie „Zakonczona”.
 * Zakończenie (płatność, prowizja, zużycie materiałów) idzie tylko przez
 * osobną akcję zakończenia wizyty.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClientHistoryTab } from "@/components/clients/client-history-tab";

const mutationFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ mutationFetch: (...a: unknown[]) => mutationFetch(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function appointment(id: string, status: string) {
  return {
    id,
    salonId: "salon-a",
    clientId: "client-1",
    employeeId: "emp-1",
    serviceId: null,
    startTime: "2026-11-20T10:00:00.000Z",
    endTime: "2026-11-20T11:00:00.000Z",
    status,
    notes: null,
    depositAmount: null,
    depositPaid: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    employee: { id: "emp-1", firstName: "Anna", lastName: "Nowak", color: null },
    service: null,
    treatment: null,
    materials: [],
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

async function saveTreatmentFor(status: string) {
  const id = `appt-${status}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ success: true, data: [appointment(id, status)] }))
  );
  mutationFetch.mockResolvedValue(
    jsonResponse({
      success: true,
      data: {
        id: "treatment-1",
        recipe: "Receptura testowa",
        techniques: null,
        materialsJson: [],
        notes: null,
        createdAt: "2026-11-20T11:00:00.000Z",
      },
    })
  );

  render(<ClientHistoryTab clientId="client-1" />);
  fireEvent.click(await screen.findByTestId(`appointment-toggle-${id}`));
  fireEvent.click(screen.getByTestId(`edit-treatment-btn-${id}`));
  fireEvent.change(screen.getByTestId(`treatment-recipe-input-${id}`), {
    target: { value: "Receptura testowa" },
  });
  fireEvent.click(screen.getByTestId(`save-treatment-btn-${id}`));

  await screen.findByTestId(`treatment-recipe-${id}`);
  return id;
}

describe("ClientHistoryTab — zapis karty zabiegu nie zmienia statusu wizyty", () => {
  beforeEach(() => {
    mutationFetch.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["scheduled", "confirmed"])(
    "wizyta %s po zapisie karty nie jest pokazana jako zakończona",
    async (status) => {
      const id = await saveTreatmentFor(status);
      const item = screen.getByTestId(`appointment-item-${id}`);
      expect(item.textContent).not.toContain("Zakonczona");
      expect(mutationFetch).toHaveBeenCalledWith(
        `/api/appointments/${id}/treatment`,
        expect.objectContaining({ method: "POST" })
      );
    }
  );

  it("wizyta scheduled zachowuje etykietę „Zaplanowana” po zapisie karty", async () => {
    const id = await saveTreatmentFor("scheduled");
    await waitFor(() =>
      expect(screen.getByTestId(`appointment-item-${id}`).textContent).toContain("Zaplanowana")
    );
  });

  it("wizyta completed nadal pokazuje „Zakonczona” po zapisie karty", async () => {
    const id = await saveTreatmentFor("completed");
    expect(screen.getByTestId(`appointment-item-${id}`).textContent).toContain("Zakonczona");
  });
});
