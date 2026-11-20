/**
 * Komunikat po anulowaniu wizyty w portalu klienta: zadatek rozliczany poza
 * MyHelper nie może dostać obietnicy zwrotu („zostanie zwrocony”) ani
 * przepadku („nie podlega zwrotowi”) — tylko informację, że zwrot ustala salon.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAppointmentDetail } from "@/app/(client)/appointments/[id]/_hooks/use-appointment-detail";

const { toastSuccess, toastError, mockMutationFetch, session, router } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  mockMutationFetch: vi.fn(),
  session: { data: { user: { id: "client-user" } }, isPending: false },
  router: { push: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ id: "appt-1" }),
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => session }));
vi.mock("@/lib/api-client", () => ({ mutationFetch: mockMutationFetch }));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function cancelWith(details: Record<string, unknown>): Promise<string> {
  mockMutationFetch.mockResolvedValue(
    jsonResponse({ success: true, message: "Wizyta zostala anulowana", cancellationDetails: details }),
  );
  const { result } = renderHook(() => useAppointmentDetail());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.handleCancelAppointment();
  });
  expect(toastSuccess).toHaveBeenCalledTimes(1);
  const [title, options] = toastSuccess.mock.calls[0] as [string, { description: string }];
  expect(title).toBe("Wizyta anulowana");
  return options.description;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ success: true, data: { id: "appt-1", status: "scheduled" } })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useAppointmentDetail — komunikat po anulowaniu", () => {
  it("zadatek rozliczany przez salon: zwrot ustala salon, bez obietnicy zwrotu", async () => {
    const description = await cancelWith({
      depositAmount: 50,
      depositRefunded: false,
      depositForfeited: false,
      depositSettledBySalon: true,
    });
    expect(description).toBe(
      "Twoja wizyta zostala pomyslnie anulowana. Zwrot zadatku ustala salon, poza MyHelper.",
    );
    expect(description).not.toMatch(/zostanie zwrocony|nie podlega zwrotowi/);
  });

  it("zwrot online: dotychczasowy tekst", async () => {
    const description = await cancelWith({
      depositAmount: 50,
      depositRefunded: true,
      depositForfeited: false,
      depositSettledBySalon: false,
    });
    expect(description).toBe("Twoja wizyta zostala pomyslnie anulowana. Zadatek 50.00 PLN zostanie zwrocony.");
  });

  it("zatrzymanie online: dotychczasowy tekst", async () => {
    const description = await cancelWith({
      depositAmount: 50,
      depositRefunded: false,
      depositForfeited: true,
      depositSettledBySalon: false,
    });
    expect(description).toBe("Twoja wizyta zostala pomyslnie anulowana. Zadatek 50.00 PLN nie podlega zwrotowi.");
  });

  it("bez zadatku: tylko potwierdzenie anulowania", async () => {
    const description = await cancelWith({ depositAmount: 0, depositRefunded: false, depositForfeited: false });
    expect(description).toBe("Twoja wizyta zostala pomyslnie anulowana.");
  });
});
