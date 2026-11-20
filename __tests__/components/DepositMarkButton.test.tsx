import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppointmentDetail, RefundStatus } from "@/components/appointments/detail";
import { DepositMarkButton } from "@/components/appointments/detail/deposit-mark-button";
import { RoleProvider } from "@/components/dashboard/role-provider";
import type { SalonRole } from "@/lib/salon-context";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const DEPOSIT_URL = `/api/appointments/${APPOINTMENT_ID}/deposit`;
const ONLINE_PAYMENT_MESSAGE = "Zadatek oplacony online — oznaczenie reczne niedostepne";
const GENERIC_ERROR = "Nie udalo sie zmienic oznaczenia zadatku";

function makeAppointment(overrides: Partial<AppointmentDetail> = {}): AppointmentDetail {
  return {
    id: APPOINTMENT_ID,
    salonId: "salon-1",
    clientId: null,
    employeeId: "emp-1",
    serviceId: null,
    startTime: "2026-11-25T10:00:00.000Z",
    endTime: "2026-11-25T11:00:00.000Z",
    status: "scheduled",
    notes: null,
    depositAmount: "50.00",
    depositPaid: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    client: null,
    employee: null,
    service: null,
    ...overrides,
  };
}

function makeRefundStatus(overrides: Partial<RefundStatus> = {}): RefundStatus {
  return {
    appointmentId: APPOINTMENT_ID,
    hasDeposit: true,
    depositAmount: 50,
    depositPaid: false,
    paymentMethod: null,
    paymentStatus: null,
    refundStatus: "none",
    refundAmount: 0,
    forfeitedAmount: 0,
    settledOutsideApp: true,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

interface RenderOptions {
  role?: SalonRole;
  appointment?: AppointmentDetail;
  refundStatus?: RefundStatus | null;
}

function renderButton({
  role = "owner",
  appointment = makeAppointment(),
  refundStatus = makeRefundStatus(),
}: RenderOptions = {}) {
  const onChanged = vi.fn();
  const notifyChange = vi.fn();
  render(
    <RoleProvider role={role}>
      <DepositMarkButton
        appointment={appointment}
        refundStatus={refundStatus}
        onChanged={onChanged}
        notifyChange={notifyChange}
      />
    </RoleProvider>
  );
  return { onChanged, notifyChange };
}

function fetchMock(): ReturnType<typeof vi.fn> {
  return global.fetch as ReturnType<typeof vi.fn>;
}

describe("DepositMarkButton — widocznosc", () => {
  it.each<SalonRole>(["owner", "receptionist"])("widoczny dla roli %s", (role) => {
    renderButton({ role });
    expect(screen.getByTestId("deposit-mark-btn")).toBeInTheDocument();
  });

  it("widoczny przy statusie confirmed", () => {
    renderButton({ appointment: makeAppointment({ status: "confirmed" }) });
    expect(screen.getByTestId("deposit-mark-btn")).toBeInTheDocument();
  });

  it("niewidoczny dla roli employee", () => {
    renderButton({ role: "employee" });
    expect(screen.queryByTestId("deposit-mark-btn")).not.toBeInTheDocument();
  });

  it("niewidoczny przy platnosci online (settledOutsideApp: false)", () => {
    renderButton({ refundStatus: makeRefundStatus({ settledOutsideApp: false }) });
    expect(screen.queryByTestId("deposit-mark-btn")).not.toBeInTheDocument();
  });

  it("niewidoczny, gdy odpowiedz refund-status nie ma pola settledOutsideApp", () => {
    const legacyResponse = makeRefundStatus();
    delete legacyResponse.settledOutsideApp;
    renderButton({ refundStatus: legacyResponse });
    expect(screen.queryByTestId("deposit-mark-btn")).not.toBeInTheDocument();
  });

  it("niewidoczny bez zadatku (hasDeposit: false)", () => {
    renderButton({ refundStatus: makeRefundStatus({ hasDeposit: false }) });
    expect(screen.queryByTestId("deposit-mark-btn")).not.toBeInTheDocument();
  });

  it("niewidoczny, dopoki refund-status sie nie zaladowal", () => {
    renderButton({ refundStatus: null });
    expect(screen.queryByTestId("deposit-mark-btn")).not.toBeInTheDocument();
  });

  it.each(["cancelled", "completed"])("niewidoczny przy statusie %s", (status) => {
    renderButton({ appointment: makeAppointment({ status }) });
    expect(screen.queryByTestId("deposit-mark-btn")).not.toBeInTheDocument();
  });
});

describe("DepositMarkButton — dzialanie", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          success: true,
          data: { appointmentId: APPOINTMENT_ID, depositPaid: true, changed: true },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("niewplacony: etykieta oznaczenia i POST na trase deposit", async () => {
    const { onChanged, notifyChange } = renderButton();
    const button = screen.getByTestId("deposit-mark-btn");
    expect(button).toHaveTextContent("Oznacz zadatek jako wplacony");

    fireEvent.click(button);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEPOSIT_URL);
    expect(init.method).toBe("POST");
    expect(notifyChange).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Zadatek oznaczony jako wplacony");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("wplacony: etykieta cofniecia i DELETE na trase deposit", async () => {
    const { onChanged, notifyChange } = renderButton({
      refundStatus: makeRefundStatus({ depositPaid: true }),
    });
    const button = screen.getByTestId("deposit-mark-btn");
    expect(button).toHaveTextContent("Cofnij oznaczenie wplaty");

    fireEvent.click(button);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(url).toBe(DEPOSIT_URL);
    expect(init.method).toBe("DELETE");
    expect(notifyChange).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Cofnieto oznaczenie wplaty");
  });

  it("wylaczony w trakcie zadania; drugie klikniecie nie wysyla drugiego zadania", async () => {
    let release: (res: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          })
      )
    );
    const { onChanged } = renderButton();
    const button = screen.getByTestId("deposit-mark-btn");

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(jsonResponse(200, { success: true, data: { changed: true } }));
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("409 DEPOSIT_ONLINE_PAYMENT: komunikat o platnosci online, bez odswiezenia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(409, {
          success: false,
          code: "DEPOSIT_ONLINE_PAYMENT",
          error: "Zadatek tej wizyty obsługuje płatność online",
        })
      )
    );
    const { onChanged, notifyChange } = renderButton();

    fireEvent.click(screen.getByTestId("deposit-mark-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(ONLINE_PAYMENT_MESSAGE));
    expect(onChanged).not.toHaveBeenCalled();
    expect(notifyChange).not.toHaveBeenCalled();
  });

  it("400: komunikat z pola error odpowiedzi", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, { success: false, error: "Wizyta nie ma zadatku do oznaczenia" })
      )
    );
    const { onChanged } = renderButton();

    fireEvent.click(screen.getByTestId("deposit-mark-btn"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Wizyta nie ma zadatku do oznaczenia")
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each([403, 404])("%i: komunikat z pola error odpowiedzi", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(status, { success: false, error: "Brak uprawnien" }))
    );
    renderButton();

    fireEvent.click(screen.getByTestId("deposit-mark-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Brak uprawnien"));
  });

  it("500 bez pola error: komunikat ogolny", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { success: false })));
    const { onChanged } = renderButton();

    fireEvent.click(screen.getByTestId("deposit-mark-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("500 z pustym polem error: komunikat ogolny zamiast pustego", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(500, { success: false, error: "  " })));
    renderButton();

    fireEvent.click(screen.getByTestId("deposit-mark-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR));
  });

  it("odpowiedz bez JSON: komunikat ogolny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as unknown as Response
      )
    );
    renderButton();

    fireEvent.click(screen.getByTestId("deposit-mark-btn"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR));
  });

  it("blad sieci: komunikat ogolny i przycisk znow aktywny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const { onChanged } = renderButton();
    const button = screen.getByTestId("deposit-mark-btn");

    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR));
    expect(button).not.toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
