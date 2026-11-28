/**
 * Ekran Finansów — zapis stawki prowizji pracownika: polskie komunikaty
 * walidacji po stronie ekranu i odpowiedzi 400 z serwera (validateBody:
 * { success: false, error: "Validation failed", details: { pole: komunikat } }).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFinanceData } from "@/app/dashboard/finance/_hooks/use-finance-data";
import type { EmployeeRate } from "@/app/dashboard/finance/_types";

const { toastSuccess, toastError, mockMutationFetch, session } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  mockMutationFetch: vi.fn(),
  session: { data: { user: { id: "owner-user" } }, isPending: false },
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => session }));
vi.mock("@/lib/api-client", () => ({ mutationFetch: mockMutationFetch }));

const EMPLOYEE = {
  id: "emp-1",
  firstName: "Anna",
  lastName: "Nowak",
  role: "employee",
  color: null,
  commissionRate: "40.00",
  isActive: true,
} as unknown as EmployeeRate;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function saveRate(value: string) {
  const { result } = renderHook(() => useFinanceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.openRateEditor(EMPLOYEE));
  act(() => result.current.setNewRate(value));
  await act(async () => {
    await result.current.handleSaveRate();
  });
  return result;
}

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  mockMutationFetch.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ success: true, data: [] })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useFinanceData — zapis stawki prowizji", () => {
  it.each([["-1"], ["100.01"], ["abc"]])(
    "stawka %j poza zakresem: polski tekst, bez wywołania serwera",
    async (value) => {
      await saveRate(value);
      expect(toastError).toHaveBeenCalledWith("Prowizja musi być liczbą od 0 do 100.");
      expect(mockMutationFetch).not.toHaveBeenCalled();
    },
  );

  it.each([["0"], ["100"]])("stawka %j na granicy zakresu idzie do serwera", async (value) => {
    mockMutationFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, message: "Zapisano" }),
    );
    await saveRate(value);
    expect(mockMutationFetch).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("400 z details: pokazuje pierwszy komunikat serwera, nie „Validation failed”", async () => {
    mockMutationFetch.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: "Validation failed",
          details: { commissionRate: "Prowizja musi być liczbą od 0 do 100." },
        },
        400,
      ),
    );
    await saveRate("50");
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Prowizja musi być liczbą od 0 do 100.");
  });

  it("400 bez details: ogólny polski tekst", async () => {
    mockMutationFetch.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Validation failed" }, 400),
    );
    await saveRate("50");
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Nie udało się zapisać. Sprawdź wpisane wartości.");
  });

  it("400 z pustym details: ogólny polski tekst", async () => {
    mockMutationFetch.mockResolvedValueOnce(
      jsonResponse({ success: false, error: "Validation failed", details: {} }, 400),
    );
    await saveRate("50");
    expect(toastError).toHaveBeenCalledWith("Nie udało się zapisać. Sprawdź wpisane wartości.");
  });

  it("błąd sieci: polski tekst połączenia", async () => {
    mockMutationFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const result = await saveRate("50");
    expect(toastError).toHaveBeenCalledWith("Błąd połączenia z serwerem");
    expect(result.current.savingRate).toBe(false);
  });

  it("sukces: komunikat serwera, okno zamknięte, lista stawek odświeżona", async () => {
    mockMutationFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, message: "Prowizja dla Anna Nowak ustawiona na 50%" }),
    );
    const fetchMock = vi.mocked(globalThis.fetch);
    const result = await saveRate("50");
    expect(toastSuccess).toHaveBeenCalledWith("Prowizja dla Anna Nowak ustawiona na 50%");
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.editingRate).toBeNull();
    expect(mockMutationFetch).toHaveBeenCalledWith(
      "/api/employees/commission-rate",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ employeeId: "emp-1", commissionRate: 50 }),
      }),
    );
    const rateFetches = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/employees/commission-rate",
    );
    expect(rateFetches.length).toBeGreaterThanOrEqual(2);
  });
});
